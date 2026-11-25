import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { databaseReady, openDatabase, waitForDatabase } from '../src/config/database.js';
import { createLogger } from '../src/config/logger.js';
import { createModels, createIndexes, type Models } from '../src/models/index.js';
import { createPasswords } from '../src/modules/auth/password.js';
import { imageHash, watermarkImage } from '../src/integrations/evidenceImage.js';
import { reverseGeocoder } from '../src/integrations/geocoding.js';
import type { EvidenceStore } from '../src/integrations/cloudinary.js';
import { dayFormat } from '../src/modules/visits/visit.service.js';

let mongo: MongoMemoryServer | undefined;
let db: ReturnType<typeof openDatabase> | undefined;
let models: Models;
let app: ReturnType<typeof createApp>;
let jpeg: Buffer;
const tokens: Record<string, string> = {};
const vault = new Map<string, Buffer>();
let fail = false;
const store: EvidenceStore = {
  async upload(publicId, image) {
    if (fail) throw new Error('Test storage interruption');
    if (vault.has(publicId)) throw new Error('Unexpected overwrite');
    vault.set(publicId, image);
    return { publicId, assetId: 'isolated-storage' };
  },
  async read(publicId) {
    const bytes = vault.get(publicId);
    return bytes ? new Response(new Uint8Array(bytes)) : new Response(null, { status: 404 });
  },
  async remove(publicId) {
    vault.delete(publicId);
  },
};
const api = '/api/v1';
const call = (method: 'get' | 'post' | 'patch' | 'delete', path: string, actor = 'WORKER') =>
  request(app)
    [method](api + path)
    .auth(tokens[actor], { type: 'bearer' });
const config = () =>
  readConfig({
    NODE_ENV: 'test',
    MONGODB_URI: 'mongodb://localhost/test_dummy',
    JWT_ACCESS_SECRET: randomBytes(48).toString('base64url'),
    LOG_LEVEL: 'silent',
  });
const date = () => dayFormat('Asia/Kolkata').format(new Date());
const position = () => ({
  latitude: 22.5726,
  longitude: 88.3639,
  accuracy: 14,
  capturedAt: new Date().toISOString(),
});
const metadata = () => ({
  location: position(),
  capturedAt: new Date().toISOString(),
  key: randomUUID(),
});
const newVisit = (clientName = '=Test outlet') => ({
  clientName,
  purpose: 'Inspect product display',
  visitDate: date(),
  key: randomUUID(),
});
const upload = (
  id: string,
  input: ReturnType<typeof metadata> & { originalSha256?: string } = metadata(),
  actor = 'WORKER',
  bytes = jpeg,
) =>
  call('post', '/visits/' + id + '/evidence', actor)
    .field('metadata', JSON.stringify(input))
    .attach('image', bytes, { filename: 'fixture.jpg', contentType: 'image/jpeg' });
let id: string;
let evidenceId: string;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 30000 } });
  const settings = { ...config(), MONGODB_URI: mongo.getUri('renuka_field_visits_test') };
  const logger = createLogger(settings);
  const opened = openDatabase(settings, logger);
  db = opened;
  await waitForDatabase(opened.connection, opened.ready);
  models = createModels(opened.connection);
  await createIndexes(models);
  const passwords = createPasswords(settings);
  const password = randomBytes(21).toString('base64url');
  const passwordHash = await passwords.hash(password);
  app = createApp({
    config: settings,
    models,
    logger,
    passwords,
    evidenceStore: store,
    geocoder: async () => ({ address: 'Fixture locality', provider: 'isolated-test' }),
    ready: () => databaseReady(opened.connection),
    connected: () => opened.connection.readyState === 1,
  });
  for (const [code, department, role] of [
    ['WORKER', 'Operations', 'EMPLOYEE'],
    ['OTHER', 'Logistics', 'EMPLOYEE'],
    ['MANAGER', 'Operations', 'ADMIN'],
    ['OUTSIDE', 'Logistics', 'ADMIN'],
  ] as const) {
    await models.users.create({
      employeeCode: code,
      department,
      role,
      fullName: code,
      email: code.toLowerCase() + '@example.test',
      phone: '+919876543210',
      designation: 'Test fixture',
      passwordHash,
    });
    const login = request(app)
      .post(api + '/auth/login')
      .set('X-Auth-Transport', role === 'EMPLOYEE' ? 'mobile' : 'web');
    if (role !== 'EMPLOYEE') login.set('Origin', 'http://localhost:5173');
    tokens[code] = (
      await login.send({ identifier: code, password }).expect(200)
    ).body.data.accessToken;
  }
  jpeg = await sharp({ create: { width: 420, height: 300, channels: 3, background: '#e61e37' } })
    .jpeg()
    .toBuffer();
}, 600000);
afterAll(async () => {
  await db?.connection.close();
  await mongo?.stop();
});

it('renders permanent high-contrast watermark pixels, wraps long addresses, and strips orientation metadata', async () => {
  const rotated = await sharp(jpeg).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const result = await watermarkImage(rotated, [
    'FIELDFORCE CRM',
    'Emp & <WORKER>',
    'A very long address '.repeat(15),
    'GPS ±14 m',
    'VIS TEST',
  ]);
  const image = await sharp(result.bytes).metadata();
  const pixels = await sharp(result.bytes)
    .extract({ left: 0, top: 420, width: result.width, height: result.height - 420 })
    .removeAlpha()
    .raw()
    .toBuffer();
  expect(image.width).toBe(300);
  expect(image.height).toBeGreaterThan(500);
  expect(image.exif).toBeUndefined();
  expect(pixels.some((value) => value > 210)).toBe(true);
  expect(result.sha256).toBe(imageHash(result.bytes));
  await expect(watermarkImage(Buffer.from('not a picture'), ['Example'])).rejects.toMatchObject({
    status: 422,
  });
});

it('uses configured geocoding, caches successful responses and falls back without inventing addresses', async () => {
  const fullAddress = '12 Example Road, ' + 'Detailed locality, '.repeat(20) + '700001, India';
  const lookup = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ display_name: '  ' + fullAddress + '  ' })),
    )
    .mockRejectedValueOnce(new Error('Offline'));
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  vi.stubGlobal('fetch', lookup);
  try {
    const reverse = reverseGeocoder({
      ...config(),
      GEOCODING_REVERSE_URL: 'https://geo.example.test/reverse',
      GEOCODING_USER_AGENT: 'FieldForce test client',
    });
    await expect(reverse(22.57, 88.36, 15)).resolves.toEqual({
      address: fullAddress,
      provider: 'geo.example.test',
    });
    await expect(reverse(22.57, 88.36, 15)).resolves.toMatchObject({ address: fullAddress });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup.mock.calls[0][0].searchParams.get('zoom')).toBe('18');
    expect(lookup.mock.calls[0][0].searchParams.get('addressdetails')).toBe('1');
    clock.mockReturnValue(now + 1200);
    await expect(reverse(22.58, 88.36, 55)).resolves.toEqual({ address: null, provider: null });
    expect(lookup.mock.calls[1][0].searchParams.get('zoom')).toBe('14');
  } finally {
    vi.unstubAllGlobals();
    clock.mockRestore();
  }
});

it('reserves an owned draft during attendance and rejects invalid or missing evidence', async () => {
  await call('post', '/visits').send(newVisit()).expect(409);
  await call('post', '/attendance/check-in')
    .send({ location: position(), idempotencyKey: randomUUID() })
    .expect(201);
  const input = newVisit();
  const [first, second] = await Promise.all([
    call('post', '/visits').send(input),
    call('post', '/visits').send(input),
  ]);
  expect(first.status).toBe(201);
  expect(second.body.data.visit.id).toBe(first.body.data.visit.id);
  id = first.body.data.visit.id;
  await call('patch', '/visits/me/' + id)
    .send({ visitDate: date(), clientName: input.clientName, purpose: 'Updated display check' })
    .expect(200);
  await call('get', '/visits/me/' + id, 'OTHER').expect(404);
  await call('get', '/visits/' + id, 'MANAGER').expect(404);
  await call('post', '/visits/me/' + id + '/submit').expect(409);
  await upload(id, metadata(), 'MANAGER').expect(403);
  await upload(id, metadata(), 'OTHER').expect(404);
  const bad = metadata();
  bad.location.latitude = 93;
  await upload(id, bad).expect(400);
  const stale = metadata();
  stale.location.capturedAt = new Date(Date.now() - 90_000).toISOString();
  await upload(id, stale).expect(422);
  await upload(id, metadata(), 'WORKER', Buffer.from('invalid')).expect(422);
});

it('stores a single authenticated original and verifies its hash', async () => {
  const input = metadata();
  const saved = await upload(id, input).expect(200);
  evidenceId = saved.body.data.visit.evidence.id;
  const info = saved.body.data.visit.evidence;
  expect(info.address).toBe('Fixture locality');
  expect(info.height).toBeGreaterThan(300);
  expect(info).not.toHaveProperty('publicId');
  await upload(id, input).expect(200);
  expect(vault.size).toBe(1);
  await upload(id).expect(409);
  await call('get', '/evidence/' + evidenceId + '/view', 'OTHER').expect(404);
  await call('get', '/evidence/' + evidenceId + '/view', 'MANAGER').expect(404);
  const photo = await call('get', '/evidence/' + evidenceId + '/view')
    .expect(200)
    .expect('Cache-Control', 'no-store');
  expect(imageHash(photo.body)).toBe(info.sha256);
  await call('post', '/evidence/' + evidenceId + '/verify-integrity')
    .expect(200)
    .expect(({ body }) => expect(body.data.matches).toBe(true));
});

it('submits idempotently and records one scoped review without replacing the evidence', async () => {
  const [a, b] = await Promise.all([
    call('post', '/visits/me/' + id + '/submit'),
    call('post', '/visits/me/' + id + '/submit'),
  ]);
  expect([a.status, b.status]).toEqual([200, 200]);
  expect(a.body.data.visit.status).toBe('PENDING_REVIEW');
  await call('patch', '/visits/me/' + id)
    .send({ visitDate: date(), clientName: 'Changed', purpose: 'Changed' })
    .expect(404);
  await call('post', '/visits/' + id + '/approve', 'WORKER').expect(403);
  await call('get', '/evidence/' + evidenceId + '/view', 'MANAGER').expect(200);
  await call('get', '/evidence/' + evidenceId + '/view', 'OUTSIDE').expect(404);
  await call('post', '/visits/' + id + '/reject', 'OUTSIDE')
    .send({ reason: 'Missing proof' })
    .expect(404);
  await call('post', '/visits/' + id + '/reject', 'MANAGER')
    .send({ reason: '' })
    .expect(400);
  const decisions = await Promise.all([
    call('post', '/visits/' + id + '/approve', 'MANAGER'),
    call('post', '/visits/' + id + '/reject', 'MANAGER').send({ reason: 'Insufficient evidence' }),
  ]);
  expect(decisions.map((value) => value.status).sort()).toEqual([200, 409]);
  expect(
    await models.auditLogs.countDocuments({
      entityId: id,
      action: { $in: ['VISIT_APPROVED', 'VISIT_REJECTED'] },
    }),
  ).toBe(1);
  await call('get', '/visits?client=%3DTest&limit=1', 'MANAGER')
    .expect(200)
    .expect(({ body }) => expect(body.data.total).toBe(1));
  await call('get', '/visits/export', 'MANAGER')
    .expect(200)
    .expect(({ text }) => expect(text).toContain("'=Test outlet"));
});

it('holds an interrupted upload for cleanup and leaves the visit unsubmitted', async () => {
  const result = await call('post', '/visits').send(newVisit('Interrupted draft')).expect(201);
  const draft = result.body.data.visit.id;
  fail = true;
  try {
    await upload(draft).expect(500);
  } finally {
    fail = false;
  }
  await call('post', '/visits/me/' + draft + '/submit').expect(409);
  const row = await models.visits.findById(draft).lean().orFail();
  expect(row.uploadClaim).toBeTruthy();
  expect(row.evidence).toBeUndefined();
  await call('get', '/visits?client=Interrupted', 'MANAGER')
    .expect(200)
    .expect(({ body }) => expect(body.data.total).toBe(0));
});

it('aggregates scoped attendance and visits, provides marker pages and restricts reports and exports', async () => {
  await call('get', '/analytics/overview').expect(403);
  await call('get', '/analytics/overview?from=2020-01-01&to=2026-01-01', 'MANAGER').expect(400);
  await call('get', '/analytics/overview', 'MANAGER')
    .expect(200)
    .expect(({ body }) =>
      expect(body.data).toMatchObject({ totalEmployees: 1, totalVisits: 1, currentlyCheckedIn: 1 }),
    );
  await call('get', '/analytics/attendance?interval=week', 'MANAGER')
    .expect(200)
    .expect(({ body }) => expect(body.data.trend).toHaveLength(1));
  await call('get', '/analytics/visits', 'MANAGER')
    .expect(200)
    .expect(({ body }) => expect(body.data.total.visits).toBe(1));
  await call('get', '/analytics/reviews', 'MANAGER')
    .expect(200)
    .expect(({ body }) => expect(body.data.approved + body.data.rejected).toBe(1));
  await call('get', '/analytics/locations?limit=1', 'MANAGER')
    .expect(200)
    .expect(({ body }) => expect(body.data.markers[0]).toMatchObject({ id, latitude: 22.5726 }));
  await call('get', '/analytics/locations?department=Operations', 'OUTSIDE')
    .expect(200)
    .expect(({ body }) => expect(body.data.markers).toEqual([]));
  await call('get', '/analytics/export?report=employees', 'MANAGER')
    .expect(200)
    .expect(({ text }) => {
      expect(text).toContain('WORKER');
      expect(text).not.toContain('OTHER');
    });
});

it('paginates and aggregates more than one thousand isolated fixture visits', async () => {
  const source = await models.visits.findById(id).lean().orFail();
  const count = 1050;
  await models.visits.insertMany(
    Array.from({ length: count }, (_, index) => ({
      employeeId: source.employeeId,
      attendanceId: source.attendanceId,
      draftKey: randomUUID(),
      status: 'PENDING_REVIEW',
      visitDate: date(),
      clientName: 'Pagination fixture ' + index,
      purpose: 'Scoped reporting',
      submittedAt: new Date(),
    })),
  );
  await call('get', '/visits?page=21&limit=50', 'MANAGER')
    .expect(200)
    .expect(({ body }) => {
      expect(body.data.total).toBe(count + 1);
      expect(body.data.visits).toHaveLength(50);
    });
  await call('get', '/analytics/visits', 'MANAGER')
    .expect(200)
    .expect(({ body }) => {
      expect(body.data.total.visits).toBe(count + 1);
    });
  await call('get', '/analytics/locations?limit=10', 'MANAGER')
    .expect(200)
    .expect(({ body }) => {
      expect(body.data.markers).toHaveLength(1);
    });
});

it('replays a delayed visit after checkout and submits without creating another attendance record', async () => {
  const worker = await models.users.findOne({ employeeCode: 'OTHER' }).orFail().lean();
  const capture = new Date(Date.now() - 12 * 60_000);
  const shift = await models.attendance.create({
    employeeId: worker._id,
    attendanceDate: dayFormat('Asia/Kolkata').format(capture),
    timezone: 'Asia/Kolkata',
    status: 'CHECKED_OUT',
    checkInTime: new Date(capture.getTime() - 60_000),
    checkOutTime: new Date(capture.getTime() + 60_000),
    checkInLocation: { type: 'Point', coordinates: [88.36, 22.57] },
    checkInAccuracy: 14,
    checkInCapturedAt: capture,
    checkInFingerprint: 'isolated-check-in',
    checkInKey: randomUUID(),
    checkOutKey: randomUUID(),
  });
  const draft = {
    ...newVisit('Delayed example'),
    visitDate: dayFormat('Asia/Kolkata').format(capture),
    offline: { attendanceId: shift.id, capturedAt: capture.toISOString() },
  };
  const created = await call('post', '/visits', 'OTHER').send(draft).expect(201);
  const visitId = created.body.data.visit.id;
  const replay = await call('post', '/visits', 'OTHER').send(draft).expect(201);
  expect(replay.body.data.visit.id).toBe(visitId);
  await call('post', '/visits', 'OTHER')
    .send({ ...draft, purpose: 'Changed' })
    .expect(409);
  await call('post', '/visits', 'WORKER').send(draft).expect(422);
  const input = {
    ...metadata(),
    capturedAt: capture.toISOString(),
    location: { ...position(), capturedAt: capture.toISOString() },
    originalSha256: imageHash(jpeg),
  };
  await upload(visitId, { ...input, originalSha256: '0'.repeat(64) }, 'OTHER').expect(422);
  const stored = await upload(visitId, input, 'OTHER').expect(200);
  expect(stored.body.data.visit.evidence).toMatchObject({ delayed: true, enhancedReview: true });
  await upload(visitId, input, 'OTHER').expect(200);
  await call('post', '/visits/' + visitId + '/submit', 'OTHER')
    .send({})
    .expect(200);
  await call('post', '/visits/' + visitId + '/submit', 'OTHER')
    .send({})
    .expect(200);
  expect(await models.attendance.countDocuments({ employeeId: worker._id })).toBe(1);
});
