import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { MongoMemoryServer } from 'mongodb-memory-server';

const adminDir = fileURLToPath(new URL('..', import.meta.url));
const apiDir = fileURLToPath(new URL('../../api', import.meta.url));
const require = createRequire(import.meta.url);
const processes = [];
const temporaryRoot = await realpath(tmpdir());

async function freePort() {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function launch(script, cwd, env, args = []) {
  const process = spawn(globalThis.process.execPath, [script, ...args], {
    cwd,
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
    windowsHide: true,
  });
  processes.push(process);
  return process;
}

async function run(script, env) {
  const task = launch(script, apiDir, env);
  const [code] = await once(task, 'exit');
  assert.equal(code, 0, script + ' failed');
}

async function waitForUrl(url) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(1500),
    }).catch(() => undefined);
    if (response?.ok) return;
    await wait(300);
  }
  throw new Error('Server did not start at ' + url);
}

const mongo = await MongoMemoryServer.create({
  instance: { launchTimeout: 60_000 },
});
let browser;
let buildDir;
try {
  const apiPort = await freePort();
  const adminPort = await freePort();
  const api = 'http://127.0.0.1:' + apiPort;
  const origin = 'http://127.0.0.1:' + adminPort;
  const password = randomBytes(25).toString('base64url');
  const adminEmail = 'admin@example.test';
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: String(apiPort),
    MONGODB_URI: mongo.getUri('renuka_browser_test'),
    ADMIN_ORIGINS: origin,
    COOKIE_SECURE: 'false',
    JWT_ACCESS_SECRET: randomBytes(48).toString('base64url'),
    LOG_LEVEL: 'silent',
    BOOTSTRAP_ADMIN_EMAIL: adminEmail,
    BOOTSTRAP_ADMIN_NAME: 'Browser Test Admin',
    BOOTSTRAP_ADMIN_PASSWORD: password,
    BOOTSTRAP_ADMIN_PHONE: '+919999999999',
  };
  await run('dist/scripts/createIndexes.js', env);
  await run('dist/scripts/createAdmin.js', env);
  launch('test/browser-server.mjs', apiDir, env);
  await waitForUrl(api + '/api/health/ready');
  const vite = join(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
  buildDir = await mkdtemp(join(temporaryRoot, 'renuka-browser-'));
  const dashboardEnv = { ...process.env, VERCEL: '1', RENDER_API_ORIGIN: api };
  const build = launch(vite, adminDir, dashboardEnv, ['build', '--outDir', buildDir]);
  const [buildCode] = await once(build, 'exit');
  assert.equal(buildCode, 0, 'Building the dashboard fixture failed');
  launch(vite, adminDir, dashboardEnv, [
    'preview',
    '--outDir',
    buildDir,
    '--host',
    '127.0.0.1',
    '--port',
    String(adminPort),
    '--strictPort',
  ]);
  await waitForUrl(origin);
  await waitForUrl(origin + '/api/health/ready');
  browser = await chromium.launch({
    args: ['--no-proxy-server'],
    channel:
      process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined),
  });
  const page = await browser.newPage({
    viewport: { width: 1400, height: 850 },
  });
  page.setDefaultTimeout(60_000);
  await page.goto(origin + '/employees', {
    waitUntil: 'domcontentloaded',
    timeout: 90_000,
  });
  await page.getByLabel('Email or employee code').fill(adminEmail);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { name: 'Employee Management' }).waitFor();
  await page.getByText('No employees found').waitFor();
  await page.getByRole('link', { name: 'Add Employee' }).click();
  const email = 'field-worker@example.test';
  for (const [label, value] of [
    ['Full name', 'Ravi Worker'],
    ['Email address', email],
    ['Phone number', '9876543210'],
    ['Department', 'Operations'],
    ['Designation', 'Technician'],
  ])
    await page.getByLabel(label).fill(value);
  await page.getByRole('button', { name: 'Create employee' }).click();
  await page.getByRole('heading', { name: 'Employee profile' }).waitFor();
  await page.getByRole('button', { name: 'Issue activation link' }).click();
  await page.getByRole('button', { name: 'Issue one-time link' }).click();
  const link = await page.getByLabel('One-time link').inputValue();
  await page.getByRole('button', { name: 'Done' }).click();
  const setup = await browser.newPage();
  setup.setDefaultTimeout(60_000);
  await setup.goto(link, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await setup.getByLabel('New password').fill(password);
  await setup.getByLabel('Confirm password').fill(password);
  await setup.getByRole('button', { name: 'Set password' }).click();
  await setup.getByText('Password set. You can now sign in to the employee app.').waitFor();
  await setup.close();
  const login = await fetch(api + '/api/v1/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Auth-Transport': 'mobile',
    },
    body: JSON.stringify({ identifier: email, password }),
  });
  assert.equal(login.status, 200);
  const { data } = await login.json();

  const employeeProfile = page.url();
  const submit = (action, attendanceId) =>
    fetch(api + '/api/v1/attendance/' + action, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + data.accessToken,
      },
      body: JSON.stringify({
        idempotencyKey: randomUUID(),
        attendanceId,
        location: {
          latitude: 22.57,
          longitude: 88.36,
          accuracy: 18,
          capturedAt: new Date().toISOString(),
        },
      }),
    });
  const checkIn = await submit('check-in');
  assert.equal(checkIn.status, 201);
  const active = (await checkIn.json()).data.attendance;
  const bearer = { Authorization: 'Bearer ' + data.accessToken };
  const request = (path, method = 'GET', json) =>
    fetch(api + '/api/v1' + path, {
      method,
      headers: {
        ...bearer,
        ...(json ? { 'Content-Type': 'application/json' } : {}),
      },
      body: json ? JSON.stringify(json) : undefined,
    });
  const draftResponse = await request('/visits', 'POST', {
    visitDate: active.attendanceDate,
    clientName: 'Browser Test Client',
    purpose: 'Verify product display',
    key: randomUUID(),
  });
  assert.equal(draftResponse.status, 201);
  const { visit: draft } = (await draftResponse.json()).data;
  const image = await sharp({
    create: { width: 400, height: 320, channels: 3, background: '#ba1735' },
  })
    .jpeg()
    .toBuffer();
  const capturedAt = new Date().toISOString();
  const imageForm = new FormData();
  imageForm.append(
    'metadata',
    JSON.stringify({
      key: randomUUID(),
      capturedAt,
      location: { latitude: 22.57, longitude: 88.36, accuracy: 18, capturedAt },
    }),
  );
  imageForm.append('image', new Blob([image], { type: 'image/jpeg' }), 'test-fixture.jpg');
  const evidence = await fetch(api + '/api/v1/visits/' + draft.id + '/evidence', {
    method: 'POST',
    headers: bearer,
    body: imageForm,
  });
  assert.equal(evidence.status, 200);
  assert.equal((await request('/visits/' + draft.id + '/submit', 'POST')).status, 200);

  await page.route('https://tile.openstreetmap.org/**', (route) => route.abort());
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Field Visits' })
    .click();
  await page
    .getByRole('row')
    .filter({ hasText: 'Browser Test Client' })
    .getByRole('link', { name: 'View' })
    .click();
  await page.getByRole('img', { name: 'Submitted GPS selfie with permanent watermark' }).waitFor();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await page.getByText('Approved', { exact: true }).waitFor();
  const review = await request('/visits/me/' + draft.id);
  assert.equal((await review.json()).data.visit.status, 'APPROVED');
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Reports' })
    .click();
  await page.getByRole('heading', { name: 'Operations analytics' }).waitFor();
  await page.getByText('Approved visits', { exact: true }).waitFor();
  await page.getByRole('link', { name: 'Recorded locations' }).click();
  await page.getByRole('region', { name: 'Map of recorded visits' }).waitFor();

  const checkout = await submit('check-out', active.id);
  assert.equal(checkout.status, 200);
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Attendance' })
    .click();
  await page.getByRole('heading', { name: 'Attendance Management' }).waitFor();
  await page.getByRole('region', { name: 'Attendance table' }).getByText('Ravi Worker').waitFor();
  await page.getByRole('link', { name: 'View attendance for Ravi Worker' }).click();
  await page.getByRole('heading', { name: 'Attendance details' }).waitFor();
  await page
    .getByText(/22\.570000, 88\.360000/)
    .first()
    .waitFor();
  await page.goto(employeeProfile, {
    waitUntil: 'domcontentloaded',
    timeout: 90_000,
  });
  await page.getByRole('button', { name: 'Suspend account' }).click();
  await page.getByRole('dialog').getByLabel('Reason').fill('Browser verification');
  await page.getByRole('button', { name: 'Confirm' }).click();
  await page.getByText('Account status updated.').waitFor();
  const profile = await fetch(api + '/api/v1/auth/me', {
    headers: { Authorization: 'Bearer ' + data.accessToken },
  });
  assert.equal(profile.status, 401);

  await page.getByRole('link', { name: 'Back to employees' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('searchbox').fill('ravi');
  const table = page.getByRole('region', { name: 'Employee table' });
  await table.getByText('Ravi Worker').waitFor();
  assert(await table.evaluate((node) => node.scrollWidth > node.clientWidth));
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  const downloadPending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const download = await downloadPending;
  assert.equal(download.suggestedFilename(), 'employees.csv');
  const stream = await download.createReadStream();
  let csv = '';
  for await (const chunk of stream) csv += chunk.toString();
  assert.match(csv, /EMP0001.*Ravi Worker/);
  console.log(
    'Browser workflow passed: admin login, employee creation, activation, session restoration, suspension, token revocation, mobile-width table, CSV export, attendance check-in, checkout, admin list and GPS detail, watermarked visit upload, private preview, review, analytics and recorded map.',
  );
} finally {
  await browser?.close();
  for (const child of processes.reverse()) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  }
  await mongo.stop();
  if (buildDir) {
    const output = await realpath(buildDir);
    if (dirname(output) === temporaryRoot && basename(output).startsWith('renuka-browser-'))
      await rm(output, { recursive: true, force: true, maxRetries: 3 });
  }
}
