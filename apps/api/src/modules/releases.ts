import { createHash, timingSafeEqual } from 'node:crypto';
import type { Express } from 'express';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';
import qrcode from 'qrcode-generator';
import { z } from 'zod';
import type { Config } from '../config.js';
import { success } from './auth/auth.controller.js';
import { validateRequest } from '../middleware/validateRequest.js';

export const versionNumber = /^(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})$/;
export function compareVersions(left: string, right: string) {
  const other = right.split('.').map(Number);
  for (const [index, value] of left.split('.').map(Number).entries()) {
    const difference = value - other[index]!;
    if (difference) return difference;
  }
  return 0;
}

export function releaseRoutes(app: Express, config: Config) {
  app.get(
    '/api/v1/app/version',
    validateRequest(
      {
        query: z.strictObject({
          platform: z.enum(['android', 'ios']),
          version: z.string().regex(versionNumber),
        }),
      },
      ({ query }, _req, res) => {
        const android = query.platform === 'android';
        const latestVersion = android ? config.ANDROID_LATEST_VERSION : config.IOS_LATEST_VERSION;
        const minimumSupportedVersion = android
          ? config.ANDROID_MIN_VERSION
          : config.IOS_MIN_VERSION;
        const downloadUrl = android ? config.MOBILE_DOWNLOAD_PAGE_URL : config.IOS_INSTALL_URL;
        const configured = !!(latestVersion && minimumSupportedVersion && downloadUrl);
        success(res, 'Version policy retrieved', {
          platform: query.platform,
          configured,
          latestVersion,
          minimumSupportedVersion,
          updateRequired: configured && compareVersions(query.version, minimumSupportedVersion) < 0,
          updateAvailable: configured && compareVersions(query.version, latestVersion) < 0,
          downloadUrl: configured ? downloadUrl : undefined,
          timezone: config.BUSINESS_TIMEZONE,
          offlineEvidenceEnabled: config.OFFLINE_VISITS_ENABLED && config.OFFLINE_EVIDENCE_ENABLED,
          supportEmail: config.SUPPORT_EMAIL,
          offlineSyncMaxRetries: config.OFFLINE_SYNC_MAX_RETRIES,
        });
      },
    ),
  );

  app.get('/app/styles.css', (_req, res) => {
    res.type('css').send(`
      :root { color-scheme: light; font: 16px/1.6 system-ui, sans-serif; color: #22243b; background: #f6f5fc; }
      main { max-width: 40rem; margin: clamp(1rem, 8vw, 5rem) auto; padding: clamp(1.25rem, 5vw, 3rem); background: white; border-radius: 1rem; }
      h1 { color: #4927aa; line-height: 1.15; } h2 { line-height: 1.25; }
      a { color: #4927aa; font-weight: 650; } .download { display: inline-block; color: white; background: #4927aa; padding: .65rem 1rem; border-radius: .5rem; }
      code { overflow-wrap: anywhere; } svg { display: block; max-width: 100%; height: auto; }
    `);
  });
  app.get('/app', (_req, res) => {
    const {
      ANDROID_APK_URL: apk,
      ANDROID_APK_SHA256: hash,
      ANDROID_RELEASE_DATE: date,
      ANDROID_LATEST_VERSION: version,
      MOBILE_DOWNLOAD_PAGE_URL: page,
      SUPPORT_EMAIL: support,
    } = config;
    if (!apk || !hash || !date || !version || !page || !support) {
      res.status(503).type('text').send('The employee Android release has not been published.');
      return;
    }
    const escape = (value: string) =>
      value.replace(
        /[&<>"']/g,
        (match) =>
          ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
          })[match]!,
      );
    const qr = qrcode(0, 'M');
    qr.addData(page);
    qr.make();
    res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/app/styles.css"><title>Renuka Fire Service | Employee app</title></head><body><main>
<h1>Renuka Fire Service</h1><h2>Renuka Tracker for Android</h2>
<p>Version ${escape(version)} · Released ${escape(date)}</p>
<p><a class="download" href="${escape(apk)}" rel="noopener noreferrer">Download the employee APK</a></p>
<p>Open the downloaded APK and follow Android’s installation prompt. If your device is managed, contact your company administrator for installation access.</p>
<p>For updates, install the newer APK over your current app. Sync your queued visits first.</p>
<p>Scan to open this page on your phone.</p>${qr.createSvgTag({ scalable: false })}
<p>SHA-256 <code>${escape(hash)}</code></p>
<p><a href="mailto:${escape(support)}">Contact employee support</a></p></main></body></html>`);
  });
}

export function installMonitoring(app: Express, config: Config) {
  if (!config.METRICS_TOKEN) return;
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: 'renuka_' });
  const requests = new Histogram({
    name: 'renuka_http_request_seconds',
    help: 'HTTP request duration and count',
    labelNames: ['group', 'status'],
    registers: [registry],
  });
  const failures = new Counter({
    name: 'renuka_evidence_upload_failures_total',
    help: 'Evidence upload requests that failed',
    registers: [registry],
  });
  const syncFailures = new Counter({
    name: 'renuka_offline_sync_failures_total',
    help: 'Offline draft or checksum-bearing upload requests that failed',
    registers: [registry],
  });
  const token = createHash('sha256')
    .update('Bearer ' + config.METRICS_TOKEN)
    .digest();
  app.get('/internal/metrics', async (req, res) => {
    const presented = createHash('sha256')
      .update(req.get('authorization') ?? '')
      .digest();
    if (!timingSafeEqual(token, presented)) {
      res.status(404).end();
      return;
    }
    res.set('content-type', registry.contentType).send(await registry.metrics());
  });
  app.use((req, res, next) => {
    const upload =
      req.method === 'POST' && /^\/api\/v1\/visits\/[a-f0-9]{24}\/evidence$/.test(req.path);
    const draft = req.method === 'POST' && req.path === '/api/v1/visits';
    const group = upload ? 'upload' : (req.path.split('/')[3] ?? '');
    const boundedGroup = [
      'upload',
      'visits',
      'attendance',
      'auth',
      'analytics',
      'employees',
      'evidence',
      'admin',
      'app',
    ].includes(group)
      ? group
      : 'other';
    const end = requests.startTimer({ group: boundedGroup });
    res.once('finish', () => {
      end({ status: Math.floor(res.statusCode / 100) + 'xx' });
      if (res.statusCode < 400) return;
      if (upload) failures.inc();
      if (
        (draft && req.body?.offline) ||
        (upload &&
          typeof req.body?.metadata === 'string' &&
          req.body.metadata.includes('"originalSha256"'))
      )
        syncFailures.inc();
    });
    next();
  });
}
