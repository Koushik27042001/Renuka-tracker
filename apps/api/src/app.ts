import { releaseRoutes, installMonitoring } from './modules/releases.js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import swaggerUi from 'swagger-ui-express';
import { HEALTH_PATH, type Health } from '@renuka/shared';
import type { Config } from './config.js';
import type { Models } from './models/index.js';
import { authenticate } from './middleware/authenticate.js';
import { authorize } from './middleware/authorize.js';
import { AppError, errorHandler, unavailable } from './middleware/errors.js';
import { limiter } from './middleware/rateLimiter.js';
import { validateRequest } from './middleware/validateRequest.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { createAuthService } from './modules/auth/auth.service.js';
import { createPasswords, type Passwords } from './modules/auth/password.js';
import { createTokens } from './modules/auth/tokens.js';
import { success } from './modules/auth/auth.controller.js';
import { employeeRoutes, employeeAccountSetup } from './modules/employees/employee.routes.js';
import { employeeService } from './modules/employees/employee.service.js';
import { attendanceRoutes } from './modules/attendance/attendance.routes.js';
import { attendanceService } from './modules/attendance/attendance.service.js';
import { analyticsRoutes } from './modules/analytics/analytics.routes.js';
import { analyticsService } from './modules/analytics/analytics.service.js';
import { visitRoutes } from './modules/visits/visit.routes.js';
import { visitService } from './modules/visits/visit.service.js';
import { cloudinaryEvidence, type EvidenceStore } from './integrations/cloudinary.js';
import { reverseGeocoder } from './integrations/geocoding.js';
import { pagination } from './modules/users/user.validation.js';

export function createApp(dependencies: {
  config: Config;
  models: Models;
  logger: Logger;
  ready: () => Promise<boolean>;
  connected: () => boolean;
  passwords?: Passwords;
  evidenceStore?: EvidenceStore;
  geocoder?: ReturnType<typeof reverseGeocoder>;
}) {
  const { config, models, logger, ready, connected } = dependencies;
  const passwords = dependencies.passwords ?? createPasswords(config);
  const tokens = createTokens(config);
  const auth = createAuthService(models, config, passwords, tokens);
  const authenticated = authenticate(tokens, auth);
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUSTED_PROXY_CIDRS.length ? config.TRUSTED_PROXY_CIDRS : false);
  app.use(
    pinoHttp({
      logger,
      genReqId: (_req, res) => {
        const id = randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      serializers: {
        req: (req) => ({ id: req.id, method: req.method }),
        res: (res) => ({ statusCode: res.statusCode }),
        err: (err) => ({ type: err.type }),
      },
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, done) => done(null, !!origin && config.ADMIN_ORIGINS.includes(origin)),
      credentials: true,
      methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'X-Auth-Transport'],
      exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy', 'Retry-After'],
    }),
  );
  app.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  // Preserve the shared Phase 1 liveness contract used by both existing clients.
  app.get(HEALTH_PATH, (_req, res) => {
    const health: Health = { status: 'ok', service: 'renuka-api' };
    res.json(health);
  });
  app.get(HEALTH_PATH + '/live', (_req, res) =>
    res.json({
      success: true,
      status: 'live',
      timestamp: new Date().toISOString(),
    }),
  );
  app.get(HEALTH_PATH + '/ready', async (_req, res) => {
    const ok = await ready();
    res.status(ok ? 200 : 503).json({
      success: ok,
      status: ok ? 'ready' : 'unavailable',
      timestamp: new Date().toISOString(),
    });
  });

  installMonitoring(app, config);
  app.use(limiter(config.GLOBAL_RATE_LIMIT, 60_000));
  releaseRoutes(app, config);
  if (config.NODE_ENV === 'development') {
    const definition = JSON.parse(
      readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'),
    );
    app.get('/api/docs/openapi.json', (_req, res) => res.json(definition));
    app.use(
      '/api/docs',
      swaggerUi.serve,
      swaggerUi.setup(definition, {
        swaggerOptions: { persistAuthorization: false, validatorUrl: null },
      }),
    );
  }
  app.use('/api/v1', (_req, _res, next) => {
    if (!connected()) throw unavailable();
    next();
  });
  app.use(express.json({ limit: '16kb', strict: true, inflate: false }));
  app.use(
    express.urlencoded({ extended: false, limit: '8kb', parameterLimit: 20, inflate: false }),
  );
  app.use(cookieParser());
  const employees = employeeService(models, passwords);
  app.post('/api/v1/auth/account-setup', ...employeeAccountSetup(employees));
  app.use('/api/v1/attendance', attendanceRoutes(attendanceService(models, config), authenticated));
  const visits = visitService(
    models,
    config,
    dependencies.evidenceStore ?? cloudinaryEvidence(config),
    dependencies.geocoder ?? reverseGeocoder(config),
  );
  const field = visitRoutes(models, visits, authenticated);
  app.use('/api/v1/visits', field.routes);
  app.use('/api/v1/evidence', field.evidence);
  app.use(
    '/api/v1/analytics',
    analyticsRoutes(models, analyticsService(models, config), authenticated),
  );
  app.use('/api/v1/employees', employeeRoutes(employees, authenticated));
  app.use('/api/v1/auth', authRoutes(config, auth, authenticated));
  app.get('/api/v1/admin/access', authenticated, authorize('ADMIN', 'SUPER_ADMIN'), (_req, res) => {
    success(res, 'Administrative access granted');
  });
  app.get(
    '/api/v1/admin/audit-logs',
    authenticated,
    authorize('SUPER_ADMIN'),
    validateRequest({ query: pagination }, async ({ query }, _req, res) => {
      const events = await models.auditLogs
        .find()
        .sort({ createdAt: -1, _id: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .select(
          'actorId action entityType entityId requestId ipAddress userAgent metadata createdAt',
        )
        .lean();
      success(res, 'Audit events retrieved', { events, ...query });
    }),
  );
  app.use(() => {
    throw new AppError(404, 'Route not found');
  });
  app.use(errorHandler);
  return app;
}
