import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { captureForegroundLocation } from '../src/foregroundLocation';
import { elapsedClock } from '../src/attendanceTime';
import { loginEmployee, mobileAttendance, restoreMobileSession, logoutEmployee } from '../src/api';
import type { AttendanceSubmission } from '@renuka/shared';

const bridge = vi.hoisted(() => ({
  state: { currentState: 'active', addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
  permissions: vi.fn(),
  position: vi.fn(),
  configure: vi.fn(),
  credentials: { current: '' },
}));
vi.mock('react-native', () => ({
  AppState: bridge.state,
  Platform: { OS: 'android' },
  PermissionsAndroid: {
    PERMISSIONS: { ACCESS_FINE_LOCATION: 'fine', ACCESS_COARSE_LOCATION: 'coarse' },
    RESULTS: { GRANTED: 'granted' },
    requestMultiple: bridge.permissions,
  },
}));
vi.mock('@react-native-community/geolocation', () => ({
  default: {
    getCurrentPosition: bridge.position,
    setRNConfiguration: bridge.configure,
  },
}));
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

const limits = { maximumAccuracy: 100, maximumAgeSeconds: 30 };
const fallbackFix = { coords: { latitude: 22.57, longitude: 88.36, accuracy: 18 } };
beforeEach(() => {
  bridge.state.currentState = 'active';
  bridge.permissions.mockReset().mockResolvedValue({ fine: 'granted', coarse: 'granted' });
  bridge.position.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

it('requires foreground permission and never starts capture in the background', async () => {
  bridge.state.currentState = 'background';
  await expect(captureForegroundLocation(limits)).rejects.toThrow('Keep the app open');
  expect(bridge.permissions).not.toHaveBeenCalled();
  bridge.state.currentState = 'active';
  bridge.permissions.mockResolvedValue({ fine: 'denied', coarse: 'granted' });
  await expect(captureForegroundLocation(limits)).rejects.toThrow('precise location');
  bridge.permissions.mockResolvedValue({ fine: 'denied', coarse: 'denied' });
  await expect(captureForegroundLocation(limits)).rejects.toThrow('permission was denied');
  expect(bridge.position).not.toHaveBeenCalled();
});

it('accepts a fresh GPS reading and handles timeout, unavailable, stale, and inaccurate readings', async () => {
  bridge.position.mockImplementationOnce((success) =>
    success({ ...fallbackFix, timestamp: Date.now() }),
  );
  await expect(captureForegroundLocation(limits)).resolves.toMatchObject({
    latitude: 22.57,
    accuracy: 18,
  });
  expect(bridge.configure).toHaveBeenCalledWith(
    expect.objectContaining({ enableBackgroundLocationUpdates: false }),
  );
  expect(bridge.position.mock.calls[0][2]).toMatchObject({
    maximumAge: 0,
    enableHighAccuracy: true,
  });
  bridge.position.mockImplementationOnce((_success, failure) => failure({ code: 3 }));
  await expect(captureForegroundLocation(limits)).rejects.toThrow('GPS timed out');
  bridge.position.mockImplementationOnce((_success, failure) => failure({ code: 2 }));
  await expect(captureForegroundLocation(limits)).rejects.toThrow('Location Services');
  bridge.position.mockImplementationOnce((success) =>
    success({ ...fallbackFix, timestamp: Date.now() - 45_000 }),
  );
  await expect(captureForegroundLocation(limits)).rejects.toThrow('old reading');
  bridge.position.mockImplementationOnce((success) =>
    success({
      timestamp: Date.now(),
      coords: { ...fallbackFix.coords, accuracy: 101 },
    }),
  );
  await expect(captureForegroundLocation(limits)).rejects.toThrow('accuracy is too low');
});

it('computes an elapsed clock from the server times across midnight', () => {
  expect(elapsedClock('2026-11-24T18:01:00Z', Date.parse('2026-11-25T01:05:07Z'))).toBe('07:04:07');
  expect(elapsedClock('2026-11-24T18:01:00Z', Date.parse('2026-11-24T18:00:00Z'))).toBe('00:00:00');
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
  expect(JSON.parse(bridge.credentials.current)).toEqual({ token: 'initial', user: session.user });
  await restoreMobileSession();
  expect(JSON.parse(bridge.credentials.current).token).toBe('rotated');
  await expect(mobileAttendance.current()).resolves.toMatchObject({ attendance: { id: 'shift' } });
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
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValueOnce(reply({ attendance: { status: 'CHECKED_IN' } }))
    .mockResolvedValueOnce(reply({ attendance: { status: 'CHECKED_OUT', workingMinutes: 32 } }));
  vi.stubGlobal('fetch', fetcher);
  const input: AttendanceSubmission = {
    idempotencyKey: 'b75d50f4-b642-4aa0-a5e4-71123e32dd42',
    location: { ...fallbackFix.coords, capturedAt: '2026-11-24T10:00:00Z' },
  };
  await expect(mobileAttendance.submit('check-in', input)).rejects.toThrow('Could not confirm');
  await expect(mobileAttendance.submit('check-in', input)).resolves.toMatchObject({
    status: 'CHECKED_IN',
  });
  expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
  await expect(
    mobileAttendance.submit('check-out', { ...input, attendanceId: '0123456789abcdef01234567' }),
  ).resolves.toMatchObject({ status: 'CHECKED_OUT', workingMinutes: 32 });
  expect(fetcher.mock.calls[2][0]).toContain('/check-out');
});
