import { beforeEach, expect, it, vi } from 'vitest';
import { captureVisitPhoto, cleanCapture } from '../src/cameraEvidence';
const mock = vi.hoisted(() => ({
  state: { currentState: 'active' },
  camera: vi.fn(),
  GPS: vi.fn(),
  permission: vi.fn(),
  unlink: vi.fn(),
}));
vi.mock('react-native', () => ({
  AppState: mock.state,
  Platform: { OS: 'android' },
  PermissionsAndroid: {
    PERMISSIONS: { CAMERA: 'camera' },
    RESULTS: { GRANTED: 'granted' },
    request: mock.permission,
  },
}));
vi.mock('react-native-image-picker', () => ({ launchCamera: mock.camera }));
vi.mock('react-native-blob-util', () => ({ default: { fs: { unlink: mock.unlink } } }));
vi.mock('../src/foregroundLocation', () => ({ captureForegroundLocation: mock.GPS }));
vi.mock('../src/requestId', () => ({ uniqueId: () => 'b75d50f4-b642-4aa0-a5e4-71123e32dd42' }));

const limits = { preferredAccuracy: 50, maximumAccuracy: 100, maximumAgeSeconds: 30 };
beforeEach(() => {
  mock.state.currentState = 'active';
  mock.camera.mockReset();
  mock.GPS.mockReset();
  mock.unlink.mockReset().mockResolvedValue(undefined);
  mock.permission.mockReset().mockResolvedValue('granted');
});
it('only starts on explicit foreground camera permission and stops for denied permission', async () => {
  mock.state.currentState = 'background';
  await expect(captureVisitPhoto(limits)).rejects.toThrow('Open the app');
  expect(mock.permission).not.toHaveBeenCalled();
  mock.state.currentState = 'active';
  mock.permission.mockResolvedValue('denied');
  await expect(captureVisitPhoto(limits)).rejects.toThrow('Allow camera access');
  expect(mock.camera).not.toHaveBeenCalled();
  expect(mock.GPS).not.toHaveBeenCalled();
});
it('captures front camera evidence and one new GPS fix for each retake', async () => {
  mock.camera
    .mockResolvedValueOnce({ assets: [{ uri: 'file:///capture-1.jpg', type: 'image/jpeg' }] })
    .mockResolvedValueOnce({ assets: [{ uri: 'file:///capture-2.jpg', type: 'image/jpeg' }] });
  mock.GPS.mockImplementation(async (_limits, flag) => {
    flag(true);
    return { latitude: 22, longitude: 88, accuracy: 15, capturedAt: new Date().toISOString() };
  });
  const first = await captureVisitPhoto(limits);
  const second = await captureVisitPhoto(limits);
  expect(first).toMatchObject({
    uri: 'file:///capture-1.jpg',
    metadata: { mockLocation: true, location: { latitude: 22, accuracy: 15 } },
  });
  expect(second?.uri).toBe('file:///capture-2.jpg');
  expect(mock.GPS).toHaveBeenCalledTimes(2);
  expect(mock.camera).toHaveBeenCalledWith(
    expect.objectContaining({ cameraType: 'front', saveToPhotos: false }),
  );
  cleanCapture(first?.uri);
  expect(mock.unlink).toHaveBeenCalledWith('/capture-1.jpg');
});
it('leaves GPS untouched on camera cancellation and deletes temporary photos on GPS failure', async () => {
  mock.camera
    .mockResolvedValueOnce({ didCancel: true })
    .mockResolvedValueOnce({ assets: [{ uri: 'file:///temporary.jpg' }] });
  await expect(captureVisitPhoto(limits)).resolves.toBeUndefined();
  expect(mock.GPS).not.toHaveBeenCalled();
  mock.GPS.mockRejectedValue(new Error('GPS timed out'));
  await expect(captureVisitPhoto(limits)).rejects.toThrow('GPS timed out');
  expect(mock.unlink).toHaveBeenCalledWith('/temporary.jpg');
});
