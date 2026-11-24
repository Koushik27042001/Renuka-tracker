import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { databaseReady, openDatabase, waitForDatabase } from '../src/config/database.js';
import { createLogger } from '../src/config/logger.js';
import { createIndexes, createModels } from '../src/models/index.js';
import { createPasswords } from '../src/modules/auth/password.js';

const origin = 'http://localhost:5173';
const base = '/api/v1/employees';
const auth = '/api/v1/auth';
const password = randomBytes(20).toString('base64url');
let server: MongoMemoryServer | undefined;
let database: ReturnType<typeof openDatabase> | undefined;
let models: ReturnType<typeof createModels>;
let app: ReturnType<typeof createApp>;
let superToken: string;
let adminToken: string;
let adminId: string;
let firstId: string;
let otherId: string;
let employeeAccess: string;
let employeeRefresh: string;

const sample = {
  fullName: 'Ravi Worker',
  email: 'ravi@example.test',
  phone: '9876543210',
  department: 'Operations',
  designation: 'Associate',
  dateOfJoining: '2026-11-24',
};
const agent = () => request(app);
const admin = (method: 'get' | 'post' | 'patch', path = '', token = superToken) =>
  agent()
    [method](base + path)
    .auth(token, { type: 'bearer' });
const login = (identifier: string, password: string, mode: 'web' | 'mobile') => {
  const call = agent()
    .post(auth + '/login')
    .set('X-Auth-Transport', mode)
    .send({ identifier, password });
  return mode === 'web' ? call.set('Origin', origin) : call;
};
const redeem = (token: string) =>
  agent()
    .post(auth + '/account-setup')
    .send({ token, password });

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  const config = readConfig({
    NODE_ENV: 'test',
    JWT_ACCESS_SECRET: randomBytes(48).toString('base64url'),
    MONGODB_URI: server.getUri('renuka_employees_test'),
    LOG_LEVEL: 'silent',
    LOGIN_RATE_LIMIT: '100',
  });
  const logger = createLogger(config);
  const opened = openDatabase(config, logger);
  database = opened;
  await waitForDatabase(opened.connection, opened.ready);
  models = createModels(opened.connection);
  await createIndexes(models);
  const passwords = createPasswords(config);
  const passwordHash = await passwords.hash(password);
  for (const [role, employeeCode] of [
    ['SUPER_ADMIN', 'MASTER'],
    ['ADMIN', 'OPSADMIN'],
    ['EMPLOYEE', 'EMP0999'],
  ] as const) {
    const user = await models.users.create({
      employeeCode,
      fullName: employeeCode,
      email: employeeCode.toLowerCase() + '@example.test',
      phone: '+919876543210',
      department: 'Operations',
      designation: 'Test account',
      passwordHash,
      role,
    });
    if (role === 'ADMIN') adminId = user.id;
  }
  app = createApp({
    config,
    models,
    logger,
    passwords,
    ready: () => databaseReady(opened.connection),
    connected: () => true,
  });
  superToken = (await login('MASTER', password, 'web').expect(200)).body.data.accessToken;
  adminToken = (await login('OPSADMIN', password, 'web').expect(200)).body.data.accessToken;
}, 600_000);
afterAll(async () => {
  await database?.connection.close();
  await server?.stop();
});

it('creates employees with concurrency-safe codes and validates identities', async () => {
  const replies = await Promise.all([
    admin('post')
      .send({ ...sample, email: ' RAVI@EXAMPLE.TEST ' })
      .expect(201),
    admin('post')
      .send({ ...sample, fullName: '=Other', email: 'other@example.test', department: 'Logistics' })
      .expect(201),
  ]);
  const [first, other] = replies.map((reply) => reply.body.data.employee);
  firstId = first.id;
  otherId = other.id;
  expect([first.employeeCode, other.employeeCode].sort()).toEqual(['EMP1000', 'EMP1001']);
  expect(first).toMatchObject({
    email: sample.email,
    phone: '+919876543210',
    dateOfJoining: '2026-11-24',
    status: 'INACTIVE',
    onboardingPending: true,
  });
  expect(first).not.toHaveProperty('passwordHash');
  expect(replies[0].body.data).not.toHaveProperty('token');
  await admin('post').send(sample).expect(409);
  await admin('post')
    .send({ ...sample, phone: 'invalid' })
    .expect(400);
  await admin('post')
    .send({ ...sample, role: 'ADMIN' })
    .expect(400);
});

it('paginates, searches case-insensitively, filters, and scopes administrative access', async () => {
  await agent().get(base).expect(401);
  const paged = await admin('get', '?limit=1&page=2').expect(200);
  expect(paged.body.data.pagination).toEqual({ page: 2, limit: 1, total: 3, totalPages: 3 });
  const listed = await admin('get', '?search=rAVI&department=Operations&status=INACTIVE').expect(
    200,
  );
  expect(listed.body.data.employees.map((employee: { id: string }) => employee.id)).toEqual([
    firstId,
  ]);
  await admin('get', '?search=.*')
    .expect(200)
    .expect(({ body }) => expect(body.data.employees).toHaveLength(0));
  await admin('get', '?sortBy=passwordHash').expect(400);
  await admin('get', '/' + otherId, adminToken).expect(404);
  await admin('get', '/' + adminId).expect(404);
  await admin('get', '/invalid').expect(400);
  await admin('post', '', adminToken)
    .send({ ...sample, department: 'Logistics' })
    .expect(403);
  await admin('get', '/stats', adminToken)
    .expect(200)
    .expect(({ body }) => expect(body.data.totalEmployees).toBe(2));
});

it('updates only allowed fields and detects conflicting edits', async () => {
  const path = '/' + firstId;
  const { body } = await admin('get', path, adminToken).expect(200);
  const revision = body.data.employee.revision;
  await admin('patch', path).send({ revision, status: 'ACTIVE' }).expect(400);
  await admin('patch', path, adminToken).send({ revision, department: 'Logistics' }).expect(403);
  await admin('patch', path)
    .send({ revision, designation: 'Technician', dateOfJoining: '' })
    .expect(200)
    .expect(({ body }) =>
      expect(body.data.employee).toMatchObject({ designation: 'Technician', dateOfJoining: null }),
    );
  await admin('patch', path).send({ revision, designation: 'Stale update' }).expect(409);
  await admin('get', path + '/audit-logs', adminToken).expect(403);
  await admin('get', path + '/audit-logs')
    .expect(200)
    .expect(({ body }) => {
      expect(body.data.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'EMPLOYEE_UPDATED',
            metadata: { changedFields: expect.arrayContaining(['designation', 'dateOfJoining']) },
          }),
        ]),
      );
    });
});

it('redeems onboarding once, rotates reset links and revokes sessions on password change', async () => {
  const path = '/' + firstId;
  const oldLink = (await admin('post', path + '/password-reset').expect(200)).body.data.token;
  const current = (await admin('post', path + '/password-reset').expect(200)).body.data.token;
  const stored = await models.users.findById(firstId).select('+accountSetupHash').lean().orFail();
  expect(stored.accountSetupHash).toMatch(/^[a-f0-9]{64}$/);
  expect(stored.accountSetupHash).not.toBe(current);
  await redeem(oldLink).expect(400);
  const results = await Promise.all([redeem(current), redeem(current)]);
  expect(results.map((reply) => reply.status).sort()).toEqual([200, 400]);
  const grant = (await login(sample.email, password, 'mobile').expect(200)).body.data;
  await admin('get', '', grant.accessToken).expect(403);
  const reset = (await admin('post', path + '/password-reset', adminToken).expect(200)).body.data
    .token;
  await redeem(reset).expect(200);
  await agent()
    .get(auth + '/me')
    .auth(grant.accessToken, { type: 'bearer' })
    .expect(401);
  const active = (await login(sample.email, password, 'mobile').expect(200)).body.data;
  employeeAccess = active.accessToken;
  employeeRefresh = active.refreshToken;
});

it('requires status reasons, revokes access and refresh on deactivation, and audits suspension', async () => {
  const path = '/' + firstId;
  const current = (await admin('get', path).expect(200)).body.data.employee;
  await admin('patch', path + '/status')
    .send({ status: 'INACTIVE', revision: current.revision })
    .expect(400);
  const inactive = (
    await admin('patch', path + '/status', adminToken)
      .send({
        status: 'INACTIVE',
        revision: current.revision,
        reason: 'Offboarded employee',
      })
      .expect(200)
  ).body.data.employee;
  await agent()
    .get(auth + '/me')
    .auth(employeeAccess, { type: 'bearer' })
    .expect(401);
  await agent()
    .post(auth + '/refresh')
    .set('X-Auth-Transport', 'mobile')
    .send({ refreshToken: employeeRefresh })
    .expect(401);
  await admin('patch', path + '/status')
    .send({
      status: 'SUSPENDED',
      revision: inactive.revision,
      reason: 'Account review',
    })
    .expect(200);
  expect(
    await models.auditLogs.exists({ action: 'EMPLOYEE_SUSPENDED', entityId: firstId }),
  ).toBeTruthy();
});

it('exports scoped CSV safely and calculates employee-only statistics', async () => {
  const stats = await admin('get', '/stats').expect(200);
  expect(stats.body.data).toMatchObject({
    totalEmployees: 3,
    activeEmployees: 1,
    inactiveEmployees: 1,
    suspendedEmployees: 1,
  });
  const csv = await admin('get', '/export?department=Logistics')
    .expect(200)
    .expect('Content-Disposition', /employees.csv/);
  expect(csv.text).toContain('"\'=Other"');
  expect(csv.text).not.toContain(sample.email);
  const scoped = await admin('get', '/export', adminToken).expect(200);
  expect(scoped.text).not.toContain('other@example.test');
  expect(await models.auditLogs.exists({ action: 'EMPLOYEES_EXPORTED' })).toBeTruthy();
});
