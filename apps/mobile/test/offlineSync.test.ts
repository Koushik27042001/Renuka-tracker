import { beforeEach, expect, it, vi } from 'vitest';
import { syncOfflineDrafts } from '../src/offlineSync';
import { MobileApiError } from '../src/api';

const mock = vi.hoisted(() => ({
  state: { currentState: 'active' },
  load: vi.fn(),
  persist: vi.fn(),
  request: vi.fn(),
  capture: vi.fn(),
}));
vi.mock('react-native', () => ({ AppState: mock.state }));
vi.mock('../src/api', () => ({
  authenticated: mock.request,
  MobileApiError: class extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock('../src/offlineStore', () => ({
  offlineDrafts: mock.load,
  saveOfflineDraft: mock.persist,
  withOfflineCapture: mock.capture,
}));
const fixture = {
  id: 'local',
  input: { clientName: 'Client', purpose: 'Inspect', visitDate: '2026-11-24' },
  metadata: { key: 'upload-key' },
  capturedAt: '2026-11-24T10:00:00Z',
  attendanceId: 'shift',
  checksum: 'checksum',
  imageType: 'image/jpeg',
};
beforeEach(() => {
  vi.clearAllMocks();
  mock.state.currentState = 'active';
  mock.load.mockResolvedValue([fixture]);
  mock.capture.mockImplementation(async () => {
    throw new MobileApiError(503, 'Storage unavailable');
  });
  mock.request.mockResolvedValue({ visit: { id: 'server' } });
});

it('stores the server ID before sending evidence and resumes with the same capture on retry', async () => {
  const signal = new AbortController().signal;
  await syncOfflineDrafts('owner', signal);
  expect(mock.request).toHaveBeenCalledWith(
    '/visits',
    expect.objectContaining({
      owner: 'owner',
      body: expect.objectContaining({
        key: 'local',
        offline: { attendanceId: 'shift', capturedAt: fixture.capturedAt },
      }),
    }),
  );
  expect(mock.persist.mock.calls[0][1]).toMatchObject({ serverId: 'server' });
  const retry = mock.persist.mock.calls[1][1];
  expect(retry).toMatchObject({ serverId: 'server', problem: 'Storage unavailable', attempts: 1 });
  expect(retry.retryAt).toBeGreaterThan(Date.now());
  mock.load.mockResolvedValue([retry]);
  await syncOfflineDrafts('owner', signal);
  expect(mock.capture).toHaveBeenCalledTimes(1);
  mock.capture.mockResolvedValue(undefined);
  await syncOfflineDrafts('owner', signal, true);
  expect(mock.request).toHaveBeenCalledTimes(1);
  expect(mock.persist.mock.calls.at(-1)?.[1]).toMatchObject({ serverId: 'server', uploaded: true });
});

it('avoids requests in the background and pauses when the original owner cannot authenticate', async () => {
  mock.state.currentState = 'background';
  const signal = new AbortController().signal;
  await syncOfflineDrafts('owner', signal);
  expect(mock.request).not.toHaveBeenCalled();
  mock.state.currentState = 'active';
  mock.request.mockRejectedValueOnce(new MobileApiError(401, 'Different owner'));
  await syncOfflineDrafts('owner', signal);
  expect(mock.persist).not.toHaveBeenCalled();
  expect(mock.capture).not.toHaveBeenCalled();
});
