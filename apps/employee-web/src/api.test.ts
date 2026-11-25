import { afterEach, expect, it, vi } from 'vitest';

const employee = { id: '1', fullName: 'Test Employee', employeeCode: 'EMP001', role: 'EMPLOYEE' };
const response = (data: object) => Response.json({ data });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('uses a separate cookie transport and never requests a raw refresh token', async () => {
  vi.stubGlobal('navigator', {});
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response({ user: employee, accessToken: 'access-one' }))
    .mockResolvedValueOnce(response({}));
  vi.stubGlobal('fetch', fetcher);
  const { signIn, signOut } = await import('./api');
  await expect(signIn('EMP001', 'test-password')).resolves.toEqual(employee);
  await signOut();
  const [path, options] = fetcher.mock.calls[0];
  expect(path).toBe('/api/v1/auth/login');
  expect(options.credentials).toBe('same-origin');
  expect(options.cache).toBe('no-store');
  expect(options.headers.get('X-Auth-Transport')).toBe('employee-web');
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({});
});

it('rotates the secure session on expiration and retries the identical request', async () => {
  vi.stubGlobal('navigator', {});
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response({ user: employee, accessToken: 'access-one' }))
    .mockResolvedValueOnce(Response.json({ message: 'Expired' }, { status: 401 }))
    .mockResolvedValueOnce(response({ user: employee, accessToken: 'access-two' }))
    .mockResolvedValueOnce(response({ result: 'saved' }));
  vi.stubGlobal('fetch', fetcher);
  const { api, post, signIn } = await import('./api');
  await signIn('EMP001', 'test-password');
  await expect(
    api('/attendance/check-in', post({ idempotencyKey: 'stable-key' })),
  ).resolves.toEqual({ result: 'saved' });
  expect(fetcher.mock.calls[2][0]).toBe('/api/v1/auth/refresh?checkSession=true');
  expect(fetcher.mock.calls[3][1].body).toBe(fetcher.mock.calls[1][1].body);
  expect(fetcher.mock.calls[3][1].headers.get('Authorization')).toBe('Bearer access-two');
});
