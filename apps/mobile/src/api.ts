import * as Keychain from 'react-native-keychain';
import type {
  AttendancePage,
  AttendanceRecord,
  AttendanceSubmission,
  CurrentAttendance,
} from '@renuka/shared';
import { apiUrl } from '../config';

type Employee = {
  fullName: string;
  id: string;
  employeeCode: string;
  department?: string;
  designation?: string;
};
type Session = { accessToken: string; refreshToken: string; user: Employee };
const keychain = { service: 'com.renukatracker.session' };
let activeOwner: string | undefined;
let accessToken: string | undefined;
let refreshFlight: Promise<Session | null> | undefined;
const subscribers = new Set<() => void>();

export class MobileApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfterMs?: number,
  ) {
    super(message);
  }
}
export function onSessionInvalid(listener: () => void) {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}
async function storedToken() {
  const value = await Keychain.getGenericPassword(keychain);
  return value ? unpack(value.password).token : undefined;
}
function unpack(value: string): { token: string; user?: Employee } {
  return value.startsWith('{') ? JSON.parse(value) : { token: value };
}
export async function cachedEmployee() {
  const saved = await Keychain.getGenericPassword(keychain);
  return saved ? unpack(saved.password).user : undefined;
}
async function forget() {
  activeOwner = undefined;
  accessToken = undefined;
  await Keychain.resetGenericPassword(keychain);
  subscribers.forEach((listener) => listener());
}
async function store(session: Session) {
  const { id, fullName, employeeCode, department, designation } = session.user;
  const profile = { id, fullName, employeeCode, department, designation };
  const saved = await Keychain.setGenericPassword(
    'refresh',
    JSON.stringify({ token: session.refreshToken, user: profile }),
    {
      ...keychain,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    },
  );
  if (!saved) throw new Error('The device could not save a secure sign-in session.');
  activeOwner = session.user.id;
  accessToken = session.accessToken;
  return session;
}

async function request<T>(
  path: string,
  options: {
    body?: unknown;
    mode?: 'mobile';
    bearer?: string;
    method?: string;
    form?: FormData;
    binary?: boolean;
    owner?: string;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  if (!apiUrl) throw new MobileApiError(0, 'The API address is missing from this build.');
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort);
  if (options.signal?.aborted) abort();
  const timeout = setTimeout(abort, options.form ? 55_000 : 12_000);
  try {
    const response = await fetch(apiUrl + '/api/v1' + path, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      credentials: 'omit',
      signal: controller.signal,
      headers: {
        ...(options.mode ? { 'X-Auth-Transport': options.mode } : {}),
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(options.bearer ? { Authorization: 'Bearer ' + options.bearer } : {}),
      },
      body: options.form ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
    });
    if (response.ok && options.binary) return response as unknown as T;
    const result = await response.json();
    if (!response.ok) {
      const retryAfter = response.headers.get('Retry-After');
      const retryAfterMs = retryAfter && /^\d+$/.test(retryAfter)
        ? Number(retryAfter) * 1000
        : undefined;
      throw new MobileApiError(
        response.status,
        result.message ?? 'The request failed.',
        Number.isFinite(retryAfterMs) ? retryAfterMs : undefined,
      );
    }
    return result.data as T;
  } catch (error) {
    if (error instanceof MobileApiError) throw error;
    throw new MobileApiError(
      0,
      'Could not confirm the request. Check your connection and try again.',
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}
export function restoreMobileSession() {
  if (!refreshFlight)
    refreshFlight = (async () => {
      const token = await storedToken();
      if (!token) return null;
      try {
        const session = await request<Session>('/auth/refresh', {
          mode: 'mobile',
          body: { refreshToken: token },
        });
        return await store(session);
      } catch (error) {
        if (error instanceof MobileApiError && error.status === 401) {
          await forget();
          return null;
        }
        throw error;
      }
    })().finally(() => {
      refreshFlight = undefined;
    });
  return refreshFlight;
}
export async function loginEmployee(identifier: string, password: string) {
  return (
    await store(
      await request<Session>('/auth/login', { mode: 'mobile', body: { identifier, password } }),
    )
  ).user;
}
export async function logoutEmployee() {
  if (refreshFlight) await refreshFlight.catch(() => undefined);
  const token = await storedToken();
  if (token) await request('/auth/logout', { mode: 'mobile', body: { refreshToken: token } });
  await forget();
}
export async function authenticated<T>(
  path: string,
  options: {
    body?: unknown;
    signal?: AbortSignal;
    method?: string;
    form?: FormData;
    binary?: boolean;
    owner?: string;
  } = {},
) {
  if (options.owner && !activeOwner) await restoreMobileSession();
  const checkOwner = () => {
    if (options.owner && activeOwner !== options.owner)
      throw new MobileApiError(401, 'Sign in as the employee who captured this visit.');
  };
  checkOwner();
  const before = accessToken;
  try {
    return await request<T>(path, { ...options, bearer: before });
  } catch (error) {
    if (!(error instanceof MobileApiError) || error.status !== 401 || options.signal?.aborted)
      throw error;
    if (accessToken === before) await restoreMobileSession();
    checkOwner();
    if (!accessToken) throw error;
    try {
      return await request<T>(path, { ...options, bearer: accessToken });
    } catch (retry) {
      if (retry instanceof MobileApiError && retry.status === 401) await forget();
      throw retry;
    }
  }
}
export const mobileAttendance = {
  current: (signal?: AbortSignal) =>
    authenticated<CurrentAttendance>('/attendance/me/current', { signal }),
  history: (page: number, from?: string, to?: string, signal?: AbortSignal) =>
    authenticated<AttendancePage>(
      '/attendance/me/history?page=' +
        page +
        (from ? '&from=' + encodeURIComponent(from) : '') +
        (to ? '&to=' + encodeURIComponent(to) : ''),
      { signal },
    ),
  detail: (id: string, signal?: AbortSignal) =>
    authenticated<{ attendance: AttendanceRecord }>('/attendance/me/' + encodeURIComponent(id), {
      signal,
    }).then((result) => result.attendance),
  submit: (mode: 'check-in' | 'check-out', body: AttendanceSubmission) =>
    authenticated<{ attendance: AttendanceRecord }>('/attendance/' + mode, { body }).then(
      (result) => result.attendance,
    ),
};
