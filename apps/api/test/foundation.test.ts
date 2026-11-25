import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { SignJWT } from 'jose';
import { gpsFixSchema } from '@renuka/shared';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { databaseReady, openDatabase, waitForDatabase } from '../src/config/database.js';
import { createLogger } from '../src/config/logger.js';
import { createIndexes, createModels } from '../src/models/index.js';
import { createPasswords } from '../src/modules/auth/password.js';
import { bootstrapAdmin } from '../src/scripts/createAdmin.js';

const origin = 'https://admin.example.test';
const employeeOrigin = 'https://employee.example.test';
const secret = randomBytes(48).toString('base64url');
const password = randomBytes(20).toString('base64url');
const credentials = { identifier: 'emp001', password };
const authPath = '/api/v1/auth';
const header = 'X-Auth-Transport';
const settings = {
  NODE_ENV: 'test',
  ADMIN_ORIGINS: origin,
  EMPLOYEE_WEB_ORIGINS: employeeOrigin,
  COOKIE_SECURE: 'true',
  JWT_ACCESS_SECRET: secret,
  LOG_LEVEL: 'silent',
  LOGIN_RATE_LIMIT: '100',
};
let db: MongoMemoryServer | undefined;
let database: ReturnType<typeof openDatabase> | undefined;
let models: ReturnType<typeof createModels>;
let dependencies: Parameters<typeof createApp>[0];
let app: ReturnType<typeof createApp>;
let employeeId: string;

beforeAll(async () => {
  db = await MongoMemoryServer.create();
  const config = readConfig({ ...settings, MONGODB_URI: db.getUri('renuka_isolated_test') });
  const logger = createLogger(config);
  const opened = openDatabase(config, logger);
  database = opened;
  await waitForDatabase(opened.connection, opened.ready);
  models = createModels(opened.connection);
  await createIndexes(models);
  const passwords = createPasswords(config);
  await passwords.ready;
  const passwordHash = await passwords.hash(password);
  const user = await models.users.create({
    employeeCode: 'EMP001',
    fullName: 'Test Employee',
    email: 'employee@example.test',
    phone: '+919999999999',
    department: 'Field Operations',
    designation: 'Associate',
    passwordHash,
  });
  employeeId = user._id.toString();
  dependencies = {
    config,
    models,
    logger,
    passwords,
    ready: () => databaseReady(opened.connection),
    connected: () => opened.connection.readyState === 1,
  };
  app = createApp(dependencies);
}, 600_000);

afterAll(async () => {
  await database?.connection.close();
  await db?.stop();
});

const agent = () => request(app);
const login = (body = credentials) =>
  agent()
    .post(authPath + '/login')
    .set(header, 'mobile')
    .send(body);
const refresh = (refreshToken: string) =>
  agent()
    .post(authPath + '/refresh')
    .set(header, 'mobile')
    .send({ refreshToken });
const me = (accessToken: string) =>
  agent()
    .get(authPath + '/me')
    .auth(accessToken, { type: 'bearer' });

describe('Phase 2 backend', () => {
  it('isolates employee browser sessions from admin and native auth', async () => {
    const webPost = (path: string, allowedOrigin = employeeOrigin) =>
      agent()
        .post(authPath + path)
        .set('Origin', allowedOrigin)
        .set(header, 'employee-web');
    await webPost('/login', origin).send(credentials).expect(403);
    await webPost('/login', 'https://other.example.test').send(credentials).expect(403);
    const login = await webPost('/login').send(credentials).expect(200);
    expect(login.body.data.user.role).toBe('EMPLOYEE');
    expect(login.body.data.refreshToken).toBeUndefined();
    const setCookie = String(login.headers['set-cookie']?.[0]);
    expect(setCookie).toMatch(/^__Host-renuka_employee_refresh=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    const cookie = setCookie.split(';')[0];
    await agent()
      .post(authPath + '/refresh')
      .set('Origin', origin)
      .set(header, 'web')
      .set('Cookie', cookie)
      .send({})
      .expect(401);
    await refresh(cookie.split('=')[1]).expect(401);
    const rotated = await webPost('/refresh').set('Cookie', cookie).send({}).expect(200);
    const nextCookie = String(rotated.headers['set-cookie']?.[0]).split(';')[0];
    expect(nextCookie).not.toBe(cookie);
    await webPost('/logout').set('Cookie', nextCookie).send({}).expect(200);
    await webPost('/refresh?checkSession=true')
      .set('Cookie', nextCookie)
      .send({})
      .expect(200)
      .expect(({ body }) => expect(body.data.session).toBeNull());
  });

  it('preserves legacy health, checks MongoDB readiness, and returns 503 on loss', async () => {
    await agent().get('/api/health').expect(200, { status: 'ok', service: 'renuka-api' });
    await agent()
      .get('/api/health/live')
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('live');
        expect(Date.parse(body.timestamp)).toBeGreaterThan(0);
      });
    await agent()
      .get('/api/health/ready')
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('ready'));
    const offline = request(
      createApp({ ...dependencies, ready: async () => false, connected: () => false }),
    );
    await offline.get('/api/health/ready').expect(503);
    await offline.get(authPath + '/me').expect(503);
  });

  it('logs in by code or normalized email and returns a safe profile', async () => {
    const reply = await login().expect(200);
    expect(reply.body.data.user).toMatchObject({
      id: employeeId,
      role: 'EMPLOYEE',
      employeeCode: 'EMP001',
    });
    expect(reply.body.data.user).not.toHaveProperty('passwordHash');
    expect(reply.headers['set-cookie']).toBeUndefined();
    await login({ identifier: ' EMPLOYEE@EXAMPLE.TEST ', password }).expect(200);
    await me(reply.body.data.accessToken)
      .expect(200)
      .expect(({ body }) => expect(body.data.user.email).toBe('employee@example.test'));
    const session = await models.sessions
      .findById(reply.body.data.refreshToken.split('.')[0])
      .select('+currentHash')
      .lean();
    expect(session?.currentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(session?.currentHash).not.toBe(reply.body.data.refreshToken);
  });

  it('rejects invalid credentials, unknown users, and suspended accounts uniformly', async () => {
    const bad = await login({ ...credentials, password: 'incorrect' }).expect(401);
    const unknown = await login({ ...credentials, identifier: 'MISSING' }).expect(401);
    const active = await login().expect(200);
    await models.users.updateOne({ _id: employeeId }, { $set: { status: 'SUSPENDED' } });
    try {
      const suspended = await login().expect(401);
      expect([unknown.body.message, suspended.body.message]).toEqual([
        bad.body.message,
        bad.body.message,
      ]);
      await me(active.body.data.accessToken).expect(401);
      await refresh(active.body.data.refreshToken).expect(401);
    } finally {
      await models.users.updateOne(
        { _id: employeeId },
        { $set: { status: 'ACTIVE' }, $inc: { sessionVersion: 1 } },
      );
    }
  });

  it('rejects missing, expired, and wrongly signed JWTs', async () => {
    await agent()
      .get(authPath + '/me')
      .expect(401);
    const { body } = await login().expect(200);
    const sid = body.data.refreshToken.split('.')[0];
    const user = await models.users.findById(employeeId).lean().orFail();
    const sign = (key: string, lifetime: string) =>
      new SignJWT({
        sub: employeeId,
        sid,
        ver: user.sessionVersion,
        role: 'EMPLOYEE',
        type: 'access',
      })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setIssuer(dependencies.config.JWT_ISSUER)
        .setAudience(dependencies.config.JWT_AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(lifetime)
        .sign(new TextEncoder().encode(key));
    await me(await sign(secret, '1s ago')).expect(401);
    await me(await sign(randomBytes(48).toString('base64url'), '5m')).expect(401);
  });

  it('rejects employee access to administration', async () => {
    const { body } = await login().expect(200);
    for (const path of ['/api/v1/admin/access', '/api/v1/admin/audit-logs']) {
      await agent().get(path).auth(body.data.accessToken, { type: 'bearer' }).expect(403);
    }
  });

  it('rotates refresh tokens and revokes a family when an old token is replayed', async () => {
    const { body } = await login().expect(200);
    const rotated = await refresh(body.data.refreshToken).expect(200);
    expect(rotated.body.data.refreshToken).not.toBe(body.data.refreshToken);
    expect(rotated.body.data.accessToken).not.toBe(body.data.accessToken);
    await refresh(body.data.refreshToken).expect(401);
    await refresh(rotated.body.data.refreshToken).expect(401);
    await me(rotated.body.data.accessToken).expect(401);
    expect(
      await models.auditLogs.exists({
        action: 'REFRESH_REUSED',
        entityId: body.data.refreshToken.split('.')[0],
      }),
    ).toBeTruthy();
  });

  it('does not create two valid grants when refresh requests race', async () => {
    const { body } = await login().expect(200);
    const replies = await Promise.all([
      refresh(body.data.refreshToken),
      refresh(body.data.refreshToken),
    ]);
    expect(replies.map((reply) => reply.status).sort()).toEqual([200, 401]);
    const winner = replies.find((reply) => reply.status === 200);
    await me(winner?.body.data.accessToken).expect(401);
  });

  it('revokes one session on logout and all prior sessions on logout-all', async () => {
    const a = (await login().expect(200)).body.data;
    const b = (await login().expect(200)).body.data;
    await agent()
      .post(authPath + '/logout')
      .set(header, 'mobile')
      .send({ refreshToken: a.refreshToken })
      .expect(200);
    await me(a.accessToken).expect(401);
    await refresh(a.refreshToken).expect(401);
    await me(b.accessToken).expect(200);
    const c = (await login().expect(200)).body.data;
    await agent()
      .post(authPath + '/logout-all')
      .set(header, 'mobile')
      .auth(b.accessToken, { type: 'bearer' })
      .expect(200);
    await me(b.accessToken).expect(401);
    await refresh(c.refreshToken).expect(401);
    await login().expect(200);
  });

  it('enforces database uniqueness on normalized email and employee code', async () => {
    const user = await models.users.findById(employeeId).select('+passwordHash').lean().orFail();
    const fields = {
      employeeCode: user.employeeCode,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      department: user.department,
      designation: user.designation,
      passwordHash: user.passwordHash,
    };
    await expect(
      models.users.create({ ...fields, employeeCode: 'EMP002', email: ' EMPLOYEE@EXAMPLE.TEST ' }),
    ).rejects.toMatchObject({ code: 11000 });
    await expect(
      models.users.create({ ...fields, email: 'other@example.test' }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('validates strict requests, malformed JSON, body size and the Phase 1 GPS contract', async () => {
    await login({ ...credentials, role: 'SUPER_ADMIN' } as typeof credentials).expect(400);
    await agent()
      .post(authPath + '/login')
      .set(header, 'mobile')
      .type('json')
      .send('{bad')
      .expect(400);
    await login({ ...credentials, password: 'x'.repeat(17000) }).expect(413);
    await refresh('invalid').expect(400);
    expect(
      gpsFixSchema.safeParse({
        latitude: 91,
        longitude: 0,
        accuracyMeters: 12,
        capturedAt: '2026-04-07T08:00:00Z',
      }).success,
    ).toBe(false);
  });

  it('rate limits failed login attempts despite changing spoofed forwarding headers', async () => {
    const limited = request(
      createApp({
        ...dependencies,
        config: { ...dependencies.config, LOGIN_RATE_LIMIT: 1 },
      }),
    );
    const attempt = (ip: string) =>
      limited
        .post(authPath + '/login')
        .set(header, 'mobile')
        .set('X-Forwarded-For', ip)
        .send({ ...credentials, password: 'wrong' });
    await attempt('203.0.113.11').expect(401);
    await attempt('203.0.113.12').expect(429).expect('Retry-After', /\d+/);
  });

  it('sets security headers and hides unexpected error details', async () => {
    const broken = request(
      createApp({
        ...dependencies,
        ready: async () => {
          throw new Error('secret detail');
        },
      }),
    );
    const response = await broken
      .get('/api/health/ready')
      .expect(500)
      .expect('X-Content-Type-Options', 'nosniff');
    expect(response.text).not.toContain('secret detail');
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
    await agent().get('/missing').expect(404);
    await agent().get('/api/docs').expect(404);
  });

  it('handles real connection establishment failures and validates startup configuration', async () => {
    const config = readConfig({
      ...settings,
      MONGODB_URI: 'mongodb://127.0.0.1:1/test',
      MONGODB_CONNECT_TIMEOUT_MS: '250',
    });
    const failed = openDatabase(config, createLogger(config));
    await expect(waitForDatabase(failed.connection, failed.ready)).rejects.toThrow(
      'Could not connect to MongoDB',
    );
    expect(await databaseReady(failed.connection)).toBe(false);
    expect(() => readConfig({ MONGODB_URI: config.MONGODB_URI })).toThrow('JWT_ACCESS_SECRET');
    expect(() =>
      readConfig({
        ...settings,
        MONGODB_URI: config.MONGODB_URI,
        TRUSTED_PROXY_CIDRS: '0.0.0.0/0',
      }),
    ).toThrow('TRUSTED_PROXY_CIDRS');
  });

  it('bootstraps exactly one super admin and protects web refresh cookies with Origin checks', async () => {
    const env = {
      BOOTSTRAP_ADMIN_EMAIL: 'Admin@Example.Test',
      BOOTSTRAP_ADMIN_NAME: 'Test Admin',
      BOOTSTRAP_ADMIN_PASSWORD: password,
      BOOTSTRAP_ADMIN_PHONE: '+918888888888',
    };
    await expect(
      bootstrapAdmin(models, dependencies.config, { ...env, BOOTSTRAP_ADMIN_PASSWORD: 'short' }),
    ).rejects.toThrow();
    const outcomes = await Promise.allSettled([
      bootstrapAdmin(models, dependencies.config, env),
      bootstrapAdmin(models, dependencies.config, {
        ...env,
        BOOTSTRAP_ADMIN_EMAIL: 'other-admin@example.test',
        BOOTSTRAP_ADMIN_CODE: 'ROOT2',
      }),
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const user = await models.users
      .findOne({ role: 'SUPER_ADMIN' })
      .select('+passwordHash')
      .lean()
      .orFail();
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    const webLogin = (from?: string) => {
      const attempt = agent()
        .post(authPath + '/login')
        .set(header, 'web')
        .send({ identifier: user.email, password });
      if (from) attempt.set('Origin', from);
      return attempt;
    };
    await webLogin().expect(403);
    const crossSite = await webLogin('https://other.example.test').expect(403);
    expect(crossSite.headers['access-control-allow-origin']).toBeUndefined();
    await login({ identifier: user.email, password }).expect(401);
    const loggedIn = await webLogin(origin)
      .expect(200)
      .expect('Access-Control-Allow-Origin', origin)
      .expect('Access-Control-Allow-Credentials', 'true');
    expect(loggedIn.body.data).not.toHaveProperty('refreshToken');
    const cookie = loggedIn.headers['set-cookie'][0];
    for (const attr of ['__Host-renuka_refresh=', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) {
      expect(cookie).toContain(attr);
    }
    const cookieHeader = cookie.split(';')[0];
    await agent()
      .post(authPath + '/refresh')
      .set(header, 'web')
      .set('Cookie', cookieHeader)
      .expect(403);
    await agent()
      .post(authPath + '/refresh')
      .set(header, 'mobile')
      .set('Cookie', cookieHeader)
      .expect(403);
    await agent()
      .post(authPath + '/refresh')
      .set(header, 'web')
      .set('Origin', origin)
      .set('Cookie', cookieHeader)
      .expect(200);
    await agent()
      .get('/api/v1/admin/access')
      .auth(loggedIn.body.data.accessToken, { type: 'bearer' })
      .expect(200);
    await agent()
      .get('/api/v1/admin/audit-logs?limit=2')
      .auth(loggedIn.body.data.accessToken, { type: 'bearer' })
      .expect(200)
      .expect(({ body }) => expect(body.data.events).toHaveLength(2));
  });
});
