import { randomBytes } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { expect, it, vi } from 'vitest';
import { readConfig } from '../src/config.js';
import type { Models } from '../src/models/index.js';
import { releaseRoutes, installMonitoring } from '../src/modules/releases.js';
import { offlineShift } from '../src/modules/visits/offlinePolicy.js';
import { errorHandler } from '../src/middleware/errors.js';

const env = {
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://localhost/isolated_test',
  JWT_ACCESS_SECRET: randomBytes(48).toString('base64url'),
};

it('checks ownership, the historical interval and the independent delayed capture window', async () => {
  const checkInTime = new Date('2026-11-24T03:00:00Z');
  const checkOutTime = new Date('2026-11-24T04:00:00Z');
  const findOne = vi.fn().mockReturnValue({
    select: () => ({ lean: async () => ({ checkInTime, checkOutTime, timezone: 'Asia/Kolkata' }) }),
  });
  const models = { attendance: { findOne } } as unknown as Models;
  const config = readConfig(env);
  const now = new Date('2026-11-24T12:00:00Z');
  await expect(
    offlineShift(models, config, 'employee', 'shift', new Date('2026-11-24T03:10:00Z'), now),
  ).resolves.toMatchObject({ checkOutTime });
  expect(findOne).toHaveBeenCalledWith(
    expect.objectContaining({ employeeId: 'employee', _id: 'shift' }),
  );
  await expect(
    offlineShift(models, config, 'employee', 'shift', new Date('2026-11-24T04:00:01Z'), now),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    offlineShift(
      models,
      config,
      'employee',
      'shift',
      checkInTime,
      new Date('2026-11-26T00:00:00Z'),
    ),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    offlineShift(
      models,
      { ...config, OFFLINE_EVIDENCE_ENABLED: false },
      'employee',
      'shift',
      checkInTime,
      now,
    ),
  ).rejects.toMatchObject({ status: 403 });
});

it('rejects unapproved release origins and reports version compatibility without exposing metrics', async () => {
  expect(() =>
    readConfig({ ...env, MOBILE_DOWNLOAD_PAGE_URL: 'https://release.example.test/app' }),
  ).toThrow('approved HTTPS origins');
  const token = randomBytes(48).toString('base64url');
  const config = readConfig({
    ...env,
    METRICS_TOKEN: token,
    MOBILE_RELEASE_APPROVED_ORIGINS: 'https://release.example.test',
    MOBILE_DOWNLOAD_PAGE_URL: 'https://release.example.test/app',
    ANDROID_LATEST_VERSION: '2.10.0',
    ANDROID_MIN_VERSION: '2.3.0',
  });
  const app = express();
  installMonitoring(app, config);
  releaseRoutes(app, config);
  app.use(errorHandler);
  const old = await request(app)
    .get('/api/v1/app/version?platform=android&version=2.2.9')
    .expect(200);
  expect(old.body.data).toMatchObject({ updateRequired: true, updateAvailable: true });
  const current = await request(app)
    .get('/api/v1/app/version?platform=android&version=2.10.0')
    .expect(200);
  expect(current.body.data).toMatchObject({ updateRequired: false, updateAvailable: false });
  await request(app).get('/api/v1/app/version?platform=bad&version=1.0.0').expect(400);
  await request(app).get('/internal/metrics').expect(404);
  const metrics = await request(app)
    .get('/internal/metrics')
    .auth(token, { type: 'bearer' })
    .expect(200);
  expect(metrics.text).toContain('renuka_http_request_seconds');
  await request(app).get('/app').expect(503);
  const published = express();
  releaseRoutes(published, {
    ...config,
    ANDROID_APK_URL: 'https://release.example.test/files/tracker.apk',
    ANDROID_APK_SHA256: 'a'.repeat(64),
    ANDROID_RELEASE_DATE: '2026-11-24',
    SUPPORT_EMAIL: 'support@example.test',
  });
  const html = await request(published).get('/app').expect(200);
  expect(html.text).toContain('<svg');
  expect(html.text).toContain('Renuka Fire Service');
  expect(html.text).toContain('a'.repeat(64));
});
