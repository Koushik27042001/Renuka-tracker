import type {
  Employee,
  EmployeeInput,
  EmployeeList,
  EmployeeStats,
  EmployeeStatus,
} from '@renuka/shared';

declare const __VERCEL_API_PROXY__: boolean;
export const apiUrl = __VERCEL_API_PROXY__
  ? ''
  : (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const prefix = '/api/v1';
type Admin = { id: string; fullName: string; department: string; role: 'ADMIN' | 'SUPER_ADMIN' };
type Grant = { accessToken: string; user: Admin };
export type AuditEvent = {
  _id: string;
  action: string;
  createdAt: string;
  metadata?: { reason?: string; changedFields?: string[] };
};
export type SetupLink = { token: string; expiresAt: string };
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public errors: { field: string; message: string }[] = [],
  ) {
    super(message);
  }
}

let grant: Grant | null = null;
let refreshFlight: Promise<Grant | null> | undefined;
let sessionVersion = 0;
const listeners = new Set<(user: Admin | null) => void>();
function setGrant(next: Grant | null) {
  grant = next;
  listeners.forEach((listener) => listener(next?.user ?? null));
}
export function subscribeSession(listener: (user: Admin | null) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function send(path: string, options: RequestInit = {}, token?: string) {
  const headers = new Headers(options.headers);
  if (options.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', 'Bearer ' + token);
  const response = await fetch(apiUrl + prefix + path, { ...options, headers });
  if (!response.ok) {
    const info = await response.json().catch(() => ({}));
    throw new ApiError(
      response.status,
      info.message ?? 'The server could not complete the request.',
      info.errors,
    );
  }
  return response;
}
export async function data<T>(response: Response): Promise<T> {
  return (await response.json()).data;
}
function authOptions(body?: unknown): RequestInit {
  return {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-Auth-Transport': 'web' },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}
export function restoreSession(checkSession = false): Promise<Grant | null> {
  if (!refreshFlight) {
    const version = sessionVersion;
    const refresh = async () => {
      const result = await data<Grant | { session: null }>(
        await send(checkSession ? '/auth/refresh?checkSession=true' : '/auth/refresh', authOptions()),
      );
      const next = 'session' in result ? null : result;
      if (version === sessionVersion) setGrant(next);
      return next;
    };
    const run = async () =>
      navigator.locks
        ? await navigator.locks.request('renuka-admin-refresh', refresh)
        : await refresh();
    refreshFlight = run()
      .catch((error) => {
        if (version === sessionVersion && error instanceof ApiError && error.status === 401)
          setGrant(null);
        throw error;
      })
      .finally(() => {
        refreshFlight = undefined;
      });
  }
  return refreshFlight;
}
export async function signIn(identifier: string, password: string) {
  const next = await data<Grant>(await send('/auth/login', authOptions({ identifier, password })));
  sessionVersion++;
  setGrant(next);
}
export async function signOut() {
  if (refreshFlight) await refreshFlight.catch(() => undefined);
  await send('/auth/logout', authOptions());
  sessionVersion++;
  setGrant(null);
}
export async function authorized(path: string, options: RequestInit = {}) {
  const before = grant;
  const version = sessionVersion;
  try {
    return await send(path, options, before?.accessToken);
  } catch (error) {
    if (
      !(error instanceof ApiError) ||
      error.status !== 401 ||
      !before ||
      version !== sessionVersion
    )
      throw error;
    if (options.signal?.aborted) throw options.signal.reason;
    if (grant === before) await restoreSession();
    if (version !== sessionVersion || !grant) throw error;
    try {
      return await send(path, options, grant.accessToken);
    } catch (retryError) {
      if (version === sessionVersion && retryError instanceof ApiError && retryError.status === 401)
        setGrant(null);
      throw retryError;
    }
  }
}

export type Filters = {
  search?: string;
  department?: string;
  designation?: string;
  status?: EmployeeStatus;
  sortBy?: string;
  sortOrder?: string;
  page?: number;
  limit?: number;
};
function query(filters: Filters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    const normalized = value === undefined ? '' : String(value).trim();
    if (normalized) params.set(key, normalized);
  }
  return '?' + params;
}
const payload = (method: string, body?: unknown) => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});
export const employeeApi = {
  list: async (filters: Filters, signal?: AbortSignal) =>
    data<EmployeeList>(await authorized('/employees' + query(filters), { signal })),
  stats: async (signal?: AbortSignal) =>
    data<EmployeeStats>(await authorized('/employees/stats', { signal })),
  detail: async (id: string, signal?: AbortSignal) =>
    data<{ employee: Employee }>(await authorized('/employees/' + id, { signal })).then(
      (value) => value.employee,
    ),
  create: async (input: EmployeeInput) =>
    data<{ employee: Employee }>(await authorized('/employees', payload('POST', input))).then(
      (value) => value.employee,
    ),
  update: async (id: string, input: Partial<EmployeeInput> & { revision: number }) =>
    data<{ employee: Employee }>(
      await authorized('/employees/' + id, payload('PATCH', input)),
    ).then((value) => value.employee),
  status: async (
    id: string,
    input: { status: EmployeeStatus; reason?: string; revision: number },
  ) =>
    data<{ employee: Employee }>(
      await authorized('/employees/' + id + '/status', payload('PATCH', input)),
    ).then((value) => value.employee),
  issue: async (id: string) =>
    data<SetupLink>(await authorized('/employees/' + id + '/password-reset', payload('POST', {}))),
  audit: async (id: string, page: number, signal?: AbortSignal) =>
    data<{ events: AuditEvent[] }>(
      await authorized('/employees/' + id + '/audit-logs?page=' + page + '&limit=10', { signal }),
    ),
  export: async (filters: Filters) => {
    const url = URL.createObjectURL(
      await (await authorized('/employees/export' + query(filters))).blob(),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'employees.csv';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
export async function setupAccount(token: string, password: string) {
  await send('/auth/account-setup', payload('POST', { token, password }));
}
