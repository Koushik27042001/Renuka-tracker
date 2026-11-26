import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { readConfig, type Config } from '../src/config.js';
import { databaseReady, openDatabase, waitForDatabase } from '../src/config/database.js';
import { createLogger } from '../src/config/logger.js';
import { createIndexes, createModels, type Models } from '../src/models/index.js';
import { createPasswords } from '../src/modules/auth/password.js';
import { attendanceService } from '../src/modules/attendance/attendance.service.js';

const origin = 'http://localhost:5173';
const endpoint = '/api/v1/attendance';
const password = randomBytes(24).toString('base64url');
let mongo: MongoMemoryServer | undefined;
let db: ReturnType<typeof openDatabase> | undefined;
let app: ReturnType<typeof createApp>;
let options: Parameters<typeof createApp>[0];
let config: Config;
let models: Models;
const ids: Record<string, string> = {};
const tokens: Record<string, string> = {};

function payload(date = new Date()) {
  return {
    idempotencyKey: randomUUID(),
    location: { latitude: 22.57, longitude: 88.36, accuracy: 12, capturedAt: date.toISOString() },
  };
}
const call = (method: 'get' | 'post', path: string, identity: string) =>
  request(app)
    [method](endpoint + path)
    .auth(tokens[identity], { type: 'bearer' });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  config = readConfig({
    NODE_ENV: 'test',
    MONGODB_URI: mongo.getUri('renuka_attendance_test'),
    JWT_ACCESS_SECRET: randomBytes(48).toString('base64url'),
    LOG_LEVEL: 'silent',
  });
  const logger = createLogger(config);
  db = openDatabase(config, logger);
  await waitForDatabase(db.connection, db.ready);
  models = createModels(db.connection);
  await createIndexes(models);
  const passwords = createPasswords(config);
  const passwordHash = await passwords.hash(password);
  options = {
    config,
    models,
    logger,
    passwords,
    ready: () => databaseReady(db!.connection),
    connected: () => db!.connection.readyState === 1,
  };
  app = createApp(options);
  for (const [code, role, department] of [
    ['EMP0001', 'EMPLOYEE', 'Operations'],
    ['EMP0002', 'EMPLOYEE', 'Logistics'],
    ['EMP0003', 'EMPLOYEE', 'Operations'],
    ['EMP0004', 'EMPLOYEE', 'Operations'],
    ['MANAGER', 'ADMIN', 'Operations'],
    ['ROOTADMIN', 'SUPER_ADMIN', 'Management'],
  ] as const) {
    const person = await models.users.create({
      employeeCode: code,
      fullName: code === 'EMP0001' ? '=Ravi Worker' : code,
      email: code.toLowerCase() + '@example.test',
      phone: '+919876543210',
      designation: 'Test identity',
      department,
      role,
      passwordHash,
    });
    ids[code] = person.id;
    const login = request(app)
      .post('/api/v1/auth/login')
      .set('X-Auth-Transport', role === 'EMPLOYEE' ? 'mobile' : 'web')
      .send({ identifier: code, password });
    if (role !== 'EMPLOYEE') login.set('Origin', origin);
    tokens[code] = (await login.expect(200)).body.data.accessToken;
  }
}, 600_000);
afterAll(async () => {
  await db?.connection.close();
  await mongo?.stop();
});

let shiftId: string;
let input: ReturnType<typeof payload>;
it('atomically creates one active session and safely replays the same key', async () => {
  input = payload(new Date(Date.now() - 3000));
  const results = await Promise.all([
    call('post', '/check-in', 'EMP0001').send(input),
    call('post', '/check-in', 'EMP0001').send(input),
    call('post', '/check-in', 'EMP0001').send(payload()),
  ]);
  expect(results.map((reply) => reply.status).sort()).toEqual([200, 201, 409]);
  shiftId = results.find((reply) => reply.status === 201)?.body.data.attendance.id;
  const record = await models.attendance.findById(shiftId).lean().orFail();
  expect(record.checkInLocation.coordinates).toEqual([88.36, 22.57]);
  expect(record.checkInTime.getTime()).toBeGreaterThan(Date.parse(input.location.capturedAt));
  await call('post', '/check-in', 'EMP0001')
    .send({ ...input, location: { ...input.location, latitude: 2 } })
    .expect(409);
  await call('get', '/me/current', 'EMP0001')
    .expect(200)
    .expect(({ body }) => expect(body.data.attendance.id).toBe(shiftId));
});

it('validates fresh GPS accuracy, range, identity, and employee account access', async () => {
  for (const patch of [
    { latitude: 91 },
    { accuracy: 101 },
    { capturedAt: new Date(Date.now() - 31_000).toISOString() },
  ]) {
    const requestBody = payload();
    await call('post', '/check-in', 'EMP0002')
      .send({ ...requestBody, location: { ...requestBody.location, ...patch } })
      .expect(400);
  }
  await call('post', '/check-in', 'EMP0002')
    .send({ ...payload(), employeeId: ids.EMP0001 })
    .expect(400);
  await models.users.updateOne(
    { _id: ids.EMP0004 },
    { $set: { status: 'INACTIVE' }, $inc: { sessionVersion: 1 } },
  );
  await call('post', '/check-in', 'EMP0004').send(payload()).expect(401);
  await call('post', '/check-in', 'MANAGER').send(payload()).expect(403);
});

it('checks out once, reconciles retries and keeps history and locations private', async () => {
  await call('post', '/check-out', 'EMP0002').send(payload()).expect(409);
  const checkout = { ...payload(), attendanceId: shiftId };
  const [first, second] = await Promise.all([
    call('post', '/check-out', 'EMP0001').send(checkout),
    call('post', '/check-out', 'EMP0001').send(checkout),
  ]);
  expect([first.status, second.status]).toEqual([200, 200]);
  expect(first.body.data.attendance).toMatchObject({
    id: shiftId,
    status: 'CHECKED_OUT',
    workingMinutes: 0,
  });
  expect([first.body.data.replayed, second.body.data.replayed].sort()).toEqual([false, true]);
  await call('post', '/check-out', 'EMP0001').send(payload()).expect(409);
  await call('get', '/me/history?limit=1', 'EMP0001')
    .expect(200)
    .expect(({ body }) => {
      expect(body.data.pagination.total).toBe(1);
      expect(body.data.records[0]).not.toHaveProperty('checkInLocation');
    });
  await call('get', '/me/' + shiftId, 'EMP0002').expect(404);
  await call('get', '/me/' + shiftId, 'EMP0001')
    .expect(200)
    .expect(({ body }) => expect(body.data.attendance.checkInLocation.latitude).toBe(22.57));
  await call('get', '/', 'EMP0001').expect(403);
});

it('supports overnight shifts and replays a saved request after its GPS fix has aged', async () => {
  const actor = ids.EMP0002;
  let now = new Date('2026-11-23T17:45:00Z');
  const service = attendanceService(models, config, () => now);
  const context = { requestId: 'overnight-test' };
  const first = payload(now);
  const { attendance } = await service.checkIn(actor, first, context);
  expect(attendance.attendanceDate).toBe('2026-11-23');
  now = new Date('2026-11-23T23:15:00Z');
  const current = await service.current(actor);
  expect(current.attendanceDate).toBe('2026-11-24');
  expect(current.attendance?.id).toBe(attendance.id);
  expect(current.checkoutDeadline).toBe('2026-11-24T13:45:00.000Z');
  expect((await service.checkIn(actor, first, context)).replayed).toBe(true);
  now = new Date('2026-11-24T13:44:59.999Z');
  const result = await service.checkOut(
    actor,
    { ...payload(now), attendanceId: attendance.id },
    context,
  );
  expect(result.attendance.workingMinutes).toBe(1199);
  expect(result.attendance.attendanceDate).toBe('2026-11-23');
});

it('counts incomplete shifts, keeps scope consistent and exports safe CSV', async () => {
  const before = new Date(Date.now() - 25 * 3600_000);
  await attendanceService(models, config, () => before).checkIn(ids.EMP0003, payload(before), {
    requestId: 'old-shift-test',
  });
  await call('get', '/?status=INCOMPLETE&department=Operations', 'MANAGER')
    .expect(200)
    .expect(({ body }) => {
      expect(body.data.pagination.total).toBe(1);
      expect(body.data.records[0].status).toBe('INCOMPLETE');
    });
  await call('get', '/stats', 'MANAGER')
    .expect(200)
    .expect(({ body }) => {
      expect(body.data).toMatchObject({
        totalEmployees: 3,
        incompleteSessions: 1,
        currentlyOnDuty: 0,
        checkedOutToday: 1,
        notCheckedInToday: 1,
      });
    });
  const other = await models.attendance.findOne({ employeeId: ids.EMP0002 }).lean().orFail();
  await call('get', '/' + other._id, 'MANAGER').expect(404);
  await call('get', '/' + other._id, 'ROOTADMIN').expect(200);
  const result = await call('get', '/export?search=EMP0001', 'MANAGER')
    .expect(200)
    .expect('Content-Disposition', /attendance.csv/);
  expect(result.text).toContain("'=Ravi Worker");
  expect(result.text).not.toContain('22.57');
  expect(await models.auditLogs.exists({ action: 'ATTENDANCE_EXPORTED' })).toBeTruthy();
  expect(await models.auditLogs.exists({ action: 'ATTENDANCE_DUPLICATE' })).toBeTruthy();
  expect(
    await models.auditLogs.exists({ action: 'ATTENDANCE_CHECKED_OUT', entityId: shiftId }),
  ).toBeTruthy();
  expect(await models.auditLogs.exists({ action: 'ATTENDANCE_VIEWED' })).toBeTruthy();
});

it('returns a safe 503 when database access is unavailable', async () => {
  await request(createApp({ ...options, connected: () => false }))
    .get(endpoint + '/me/current')
    .auth(tokens.EMP0001, { type: 'bearer' })
    .expect(503)
    .expect(({ body }) => {
      expect(body).toMatchObject({ success: false, message: 'Service temporarily unavailable' });
      expect(body).not.toHaveProperty('stack');
    });
});

it('expires checkout at exactly 20 hours and permits a new check-in', async () => {
  const actor = ids.EMP0004;
  let now = new Date('2026-11-25T10:00:00Z');
  const service = attendanceService(models, config, () => now);
  const context = { requestId: 'shift-expiry-test' };
  const { attendance } = await service.checkIn(actor, payload(now), context);

  now = new Date('2026-11-26T06:00:00Z');
  const current = await service.current(actor);
  expect(current.attendance?.status).toBe('INCOMPLETE');
  expect(current.checkoutDeadline).toBeUndefined();
  await expect(
    service.checkOut(actor, { ...payload(now), attendanceId: attendance.id }, context),
  ).rejects.toMatchObject({ status: 409 });

  const next = await service.checkIn(actor, payload(now), context);
  expect(next.attendance.status).toBe('CHECKED_IN');
  expect(next.attendance.id).not.toBe(attendance.id);
  expect((await service.ownDetail(actor, attendance.id)).status).toBe('INCOMPLETE');
});
