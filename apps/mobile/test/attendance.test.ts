import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { captureForegroundLocation } from '../src/foregroundLocation';
import { elapsedClock } from '../src/attendanceTime';
import {
  loginEmployee,
  mobileAttendance,
  restoreMobileSession,
  logoutEmployee,
  request,
} from '../src/api';
import type { AttendanceSubmission } from '@renuka/shared';

const bridge = vi.hoisted(() => ({
  state: {
    currentState: 'active',
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
  },
  permissions: vi.fn(),
  position: vi.fn(),
  cancel: vi.fn(),
  cached: vi.fn(),
  enabled: vi.fn(),
  check: vi.fn(),

  credentials: { current: '' },
}));
vi.mock('react-native', () => ({
  AppState: bridge.state,
  Platform: { OS: 'android' },
  NativeModules: {
    RenukaForegroundLocation: {
      capture: bridge.position,
      cancel: bridge.cancel,
      cached: bridge.cached,
      ensureEnabled: bridge.enabled,
    },
  },
  PermissionsAndroid: {
    PERMISSIONS: {
      ACCESS_FINE_LOCATION: 'fine',
      ACCESS_COARSE_LOCATION: 'coarse',
    },
    RESULTS: { GRANTED: 'granted' },
    requestMultiple: bridge.permissions,
    check: bridge.check,
  },
}));
vi.mock('@react-native-community/geolocation', () => ({ default: {} }));
vi.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' },
  getGenericPassword: async () =>
    bridge.credentials.current ? { password: bridge.credentials.current } : false,
  setGenericPassword: async (_name: string, value: string) => {
    bridge.credentials.current = value;
    return {};
  },
  resetGenericPassword: async () => {
    bridge.credentials.current = '';
    return true;
  },
}));
vi.mock('../config', () => ({ apiUrl: 'https://api.example.test' }));

const limits = {
  preferredAccuracy: 20,
  maximumAccuracy: 100,
  maximumAgeSeconds: 30,
};
const fallbackFix = {
  coords: { latitude: 22.57, longitude: 88.36, accuracy: 18 },
};
beforeEach(() => {
  bridge.state.currentState = 'active';
  bridge.permissions.mockReset().mockResolvedValue({ fine: 'granted', coarse: 'granted' });
  bridge.position.mockReset();
  bridge.cancel.mockClear();
  bridge.check.mockReset().mockResolvedValue(false);
  bridge.enabled.mockReset().mockResolvedValue(true);
  bridge.cached.mockReset().mockResolvedValue([]);
  bridge.state.addEventListener.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

it('checks the foreground, permission and location services before starting', async () => {
  bridge.state.currentState = 'background';
  await expect(captureForegroundLocation(limits)).rejects.toThrow('Keep the app open');
  expect(bridge.permissions).not.toHaveBeenCalled();
  bridge.state.currentState = 'active';
  bridge.permissions.mockResolvedValueOnce({
    fine: 'denied',
    coarse: 'denied',
  });
  await expect(captureForegroundLocation(limits)).rejects.toThrow('permission was denied');
  bridge.enabled.mockResolvedValueOnce(false);
  await expect(captureForegroundLocation(limits)).rejects.toThrow('Location Services are off');
  expect(bridge.position).not.toHaveBeenCalled();
});

it('accepts a fresh balanced fix without turning on high accuracy', async () => {
  bridge.position.mockResolvedValueOnce({
    ...fallbackFix,
    timestamp: Date.now(),
    mocked: true,
  });
  const mocked = vi.fn();
  await expect(captureForegroundLocation(limits, mocked)).resolves.toMatchObject({ accuracy: 18 });
  expect(bridge.position).toHaveBeenCalledExactlyOnceWith(expect.any(Number), false, 15_000, 20);
  expect(bridge.cancel).toHaveBeenCalledExactlyOnceWith(bridge.position.mock.calls[0][0]);
  expect(mocked).toHaveBeenCalledExactlyOnceWith(true);
});

it('falls back to high accuracy after a balanced timeout and accepts a slow GPS fix', async () => {
  vi.useFakeTimers();
  try {
    bridge.position.mockReturnValueOnce(new Promise(() => {}));
    bridge.position.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ ...fallbackFix, timestamp: Date.now() }), 32_000);
        }),
    );
    const progress = vi.fn();
    const result = captureForegroundLocation(limits, undefined, {
      onProgress: progress,
    });
    await vi.advanceTimersByTimeAsync(48_000);
    await expect(result).resolves.toMatchObject({ accuracy: 18 });
    expect(bridge.position.mock.calls[1]).toEqual([expect.any(Number), true, 35_000, 20]);
    expect(bridge.cancel).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenCalledWith('Improving location accuracy');
    expect(bridge.cached).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it('uses the original timestamp when recovering from recent device cache', async () => {
  const timestamp = Date.now() - 10_000;
  bridge.position.mockRejectedValue({ code: 'timeout' });
  bridge.cached.mockResolvedValueOnce([
    { ...fallbackFix, timestamp: Date.now() - 31_000 },
    { coords: { ...fallbackFix.coords, accuracy: 110 }, timestamp },
    { coords: { ...fallbackFix.coords, accuracy: 60 }, timestamp },
  ]);
  await expect(captureForegroundLocation(limits)).resolves.toMatchObject({
    accuracy: 60,
    capturedAt: new Date(timestamp).toISOString(),
  });
});

it('keeps a still-fresh acceptable balanced reading if high accuracy fails', async () => {
  const position = {
    coords: { ...fallbackFix.coords, accuracy: 65 },
    timestamp: Date.now(),
  };
  bridge.position.mockResolvedValueOnce(position).mockRejectedValueOnce({ code: 'timeout' });
  await expect(captureForegroundLocation(limits)).resolves.toMatchObject({
    accuracy: 65,
    capturedAt: new Date(position.timestamp).toISOString(),
  });
  expect(bridge.position).toHaveBeenCalledTimes(2);
  expect(bridge.cached).not.toHaveBeenCalled();
});

it('rejects stale, inaccurate and invalid fixes and explains insufficient approximate accuracy', async () => {
  bridge.position.mockRejectedValue({ code: 'timeout' });
  bridge.cached.mockResolvedValueOnce([{ ...fallbackFix, timestamp: Date.now() - 45_000 }]);
  await expect(captureForegroundLocation(limits)).rejects.toThrow('too old');
  const invalid = {
    coords: { ...fallbackFix.coords, latitude: 150 },
    timestamp: Date.now(),
  };
  bridge.cached.mockResolvedValueOnce([invalid]);
  await expect(captureForegroundLocation(limits)).rejects.toThrow('accuracy is too low');
  bridge.permissions.mockResolvedValueOnce({
    fine: 'denied',
    coarse: 'granted',
  });
  bridge.cached.mockResolvedValueOnce([
    { coords: { ...fallbackFix.coords, accuracy: 101 }, timestamp: Date.now() },
  ]);
  await expect(captureForegroundLocation(limits)).rejects.toThrow('Approximate location');
});

it('cancels the native request and skips retries when leaving the screen', async () => {
  bridge.position.mockImplementationOnce(() => new Promise(() => {}));
  const controller = new AbortController();
  const capture = captureForegroundLocation(limits, undefined, {
    signal: controller.signal,
  });
  const assertion = expect(capture).rejects.toThrow('Location capture stopped');
  await vi.waitFor(() => expect(bridge.position).toHaveBeenCalledTimes(1));
  controller.abort();
  await assertion;
  expect(bridge.cancel).toHaveBeenCalledExactlyOnceWith(bridge.position.mock.calls[0][0]);
  expect(bridge.cached).not.toHaveBeenCalled();
});
it('computes an elapsed clock from the server times across midnight', () => {
  expect(elapsedClock('2026-11-24T18:01:00Z', Date.parse('2026-11-25T01:05:07Z'))).toBe('07:04:07');
  expect(elapsedClock('2026-11-24T18:01:00Z', Date.parse('2026-11-24T18:00:00Z'))).toBe('00:00:00');
});

it('allows slow API responses and preserves a non-JSON proxy error status', async () => {
  vi.useFakeTimers();
  try {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementationOnce(async (_url, { signal }) => {
        await new Promise<void>((resolve) => setTimeout(resolve, 20_000));
          if (signal.aborted) throw new Error('Aborted early');
          return Response.json({ data: { ok: true } });
        })
        .mockResolvedValueOnce(
          new Response('<html>Busy</html>', {
            status: 503,
            headers: { 'Retry-After': '8' },
          }),
        ),
    );
    const slow = request('/example');
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(slow).resolves.toEqual({ ok: true });
    await expect(request('/example')).rejects.toMatchObject({ status: 503, retryAfterMs: 8000 });
  } finally {
    vi.useRealTimers();
  }
});

it('stores the rotating credential securely and restores an active shift from the server', async () => {
  const reply = (data: unknown) => new Response(JSON.stringify({ data }));
  const session = {
    user: { id: 'id', fullName: 'Employee', employeeCode: 'EMP0001' },
    accessToken: 'bearer',
  };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply({ ...session, refreshToken: 'initial' }))
    .mockResolvedValueOnce(reply({ ...session, refreshToken: 'rotated' }))
    .mockResolvedValueOnce(reply({ attendance: { id: 'shift', status: 'CHECKED_IN' } }))
    .mockResolvedValueOnce(reply({ records: [], pagination: { total: 0 } }))
    .mockResolvedValueOnce(reply({}));
  vi.stubGlobal('fetch', fetcher);
  await loginEmployee('EMP0001', 'password');
  expect(JSON.parse(bridge.credentials.current)).toEqual({
    token: 'initial',
    user: session.user,
  });
  await restoreMobileSession();
  expect(JSON.parse(bridge.credentials.current).token).toBe('rotated');
  await expect(mobileAttendance.current()).resolves.toMatchObject({
    attendance: { id: 'shift' },
  });
  expect(fetcher.mock.calls[2][1].headers.Authorization).toBe('Bearer bearer');
  await mobileAttendance.history(2, '2026-11-01', '2026-11-24');
  expect(fetcher.mock.calls[3][0]).toContain('page=2&from=2026-11-01&to=2026-11-24');
  await logoutEmployee();
  expect(bridge.credentials.current).toBe('');
});

it('preserves the request key and coordinates on a network retry and submits checkout separately', async () => {
  const reply = (data: unknown) => new Response(JSON.stringify({ data }));
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply({
      user: { id: 'id', fullName: 'Employee', employeeCode: 'EMP0001' },
      accessToken: 'bearer',
      refreshToken: 'refresh',
    }))
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValueOnce(reply({ attendance: { status: 'CHECKED_IN' } }))
    .mockResolvedValueOnce(reply({ attendance: { status: 'CHECKED_OUT', workingMinutes: 32 } }));
  vi.stubGlobal('fetch', fetcher);
  await loginEmployee('EMP0001', 'password');
  const input: AttendanceSubmission = {
    idempotencyKey: 'b75d50f4-b642-4aa0-a5e4-71123e32dd42',
    location: { ...fallbackFix.coords, capturedAt: '2026-11-24T10:00:00Z' },
  };
  await expect(mobileAttendance.submit('check-in', input)).rejects.toThrow('Could not confirm');
  await expect(mobileAttendance.submit('check-in', input)).resolves.toMatchObject({
    status: 'CHECKED_IN',
  });
  expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[2][1].body);
  await expect(
    mobileAttendance.submit('check-out', {
      ...input,
      attendanceId: '0123456789abcdef01234567',
    }),
  ).resolves.toMatchObject({ status: 'CHECKED_OUT', workingMinutes: 32 });
  expect(fetcher.mock.calls[3][0]).toContain('/check-out');
});
