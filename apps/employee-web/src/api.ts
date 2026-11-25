import type { AttendancePage, CurrentAttendance, Visit, VisitPage } from '@renuka/shared';

export type Employee = {
  id: string;
  fullName: string;
  employeeCode: string;
  role: 'EMPLOYEE';
  email?: string;
  phone?: string;
  department?: string;
  designation?: string;
};
type Grant = { user: Employee; accessToken: string };
let grant: Grant | undefined;
let refreshFlight: Promise<Employee | null> | undefined;
const expired = new Set<() => void>();

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function onExpired(listener: () => void) {
  expired.add(listener);
  return () => {
    expired.delete(listener);
  };
}
function clearSession() {
  grant = undefined;
  expired.forEach((listener) => listener());
}
async function send(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  let response: Response;
  const timeout = new AbortController();
  const timer = setTimeout(
    () => timeout.abort(),
    options.body instanceof FormData ? 65_000 : 20_000,
  );
  try {
    response = await fetch('/api/v1' + path, {
      ...options,
      headers,
      cache: 'no-store',
      credentials: 'same-origin',
      signal: options.signal ?? timeout.signal,
    });
  } catch {
    throw new ApiError(0, 'Could not reach Renuka. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(response.status, data?.message ?? 'The request could not be completed.');
  }
  return response;
}
async function json<T>(response: Response): Promise<T> {
  return (await response.json()).data as T;
}
function auth(path: string, body: object = {}) {
  return send(path, {
    method: 'POST',
    headers: { 'X-Auth-Transport': 'employee-web' },
    body: JSON.stringify(body),
  });
}
async function authLock<T>(work: () => Promise<T>): Promise<T> {
  return navigator.locks ? await navigator.locks.request('renuka-employee-session', work) : work();
}
export function restore() {
  if (!refreshFlight) {
    refreshFlight = authLock(async () => {
      const next = await json<Grant | { session: null }>(
        await auth('/auth/refresh?checkSession=true'),
      );
      if ('session' in next || next.user.role !== 'EMPLOYEE') {
        clearSession();
        return null;
      }
      grant = next;
      return next.user;
    }).finally(() => {
      refreshFlight = undefined;
    });
  }
  return refreshFlight;
}
export async function signIn(identifier: string, password: string) {
  await refreshFlight?.catch(() => undefined);
  return authLock(async () => {
    const next = await json<Grant>(await auth('/auth/login', { identifier, password }));
    if (next.user.role !== 'EMPLOYEE')
      throw new ApiError(403, 'Use an employee account to sign in.');
    grant = next;
    return next.user;
  });
}
export async function signOut() {
  await authLock(async () => {
    await auth('/auth/logout');
    clearSession();
  });
}
export async function setPassword(token: string, password: string) {
  await send('/auth/account-setup', { method: 'POST', body: JSON.stringify({ token, password }) });
}
async function authorized(path: string, options: RequestInit = {}) {
  if (!grant) throw new ApiError(401, 'Sign in to continue.');
  const initial = grant;
  const request = (token: string) =>
    send(path, { ...options, headers: { Authorization: 'Bearer ' + token } });
  try {
    return await request(initial.accessToken);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    if (grant === initial) await restore();
    if (!grant || grant.user.id !== initial.user.id)
      throw new ApiError(401, 'Sign in to continue.');
    return request(grant.accessToken);
  }
}
export async function api<T>(path: string, options?: RequestInit) {
  return json<T>(await authorized(path, options));
}
export const currentAttendance = () => api<CurrentAttendance>('/attendance/me/current');
export const attendanceHistory = (page = 1, limit = 20) =>
  api<AttendancePage>('/attendance/me/history?page=' + page + '&limit=' + limit);
export const visitHistory = (page = 1, limit = 20) =>
  api<VisitPage>('/visits/me?page=' + page + '&limit=' + limit);
export const visitDetail = (id: string) =>
  api<{ visit: Visit }>('/visits/' + encodeURIComponent(id)).then((data) => data.visit);
export async function visitImage(id: string) {
  return (await authorized('/evidence/' + encodeURIComponent(id) + '/view')).blob();
}
export const post = (body: object, method = 'POST'): RequestInit => ({
  method,
  body: JSON.stringify(body),
});
