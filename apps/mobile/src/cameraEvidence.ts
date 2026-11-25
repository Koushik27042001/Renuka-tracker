import { AppState } from 'react-native';
import { launchCamera } from 'react-native-image-picker';
import { requestCameraPermission } from './devicePermissions';
import ReactNativeBlobUtil from 'react-native-blob-util';
import type { CurrentAttendance } from '@renuka/shared';
import { captureForegroundLocation } from './foregroundLocation';
import { uniqueId } from './requestId';

export type Capture = { uri: string; type: string; metadata: object };
export function cleanCapture(uri?: string) {
  if (uri?.startsWith('file://'))
    void ReactNativeBlobUtil.fs.unlink(uri.slice(7)).catch(() => undefined);
}
function waitForForeground() {
  if (AppState.currentState === 'active') return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      listener.remove();
      reject(new Error('Return to Renuka Tracker and try again.'));
    }, 3000);
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        clearTimeout(timer);
        listener.remove();
        resolve();
      }
    });
  });
}
export async function captureVisitPhoto(
  limits: CurrentAttendance['limits'],
  isOpen = () => true,
): Promise<Capture | undefined> {
  if (AppState.currentState !== 'active') throw new Error('Open the app before taking a selfie.');
  await requestCameraPermission();
  const result = await launchCamera({
    mediaType: 'photo',
    cameraType: 'front',
    saveToPhotos: false,
    maxWidth: 1280,
    maxHeight: 1280,
    quality: 0.8,
    assetRepresentationMode: 'compatible',
  });
  if (result.didCancel) return;
  if (result.errorCode === 'permission')
    throw new Error('Allow camera access in Settings to take a selfie.');
  const photo = result.assets?.[0];
  if (result.errorCode || !photo?.uri) throw new Error('A camera selfie could not be captured.');
  const capturedAt = new Date().toISOString();
  try {
    await waitForForeground();
    if (!isOpen()) {
      cleanCapture(photo.uri);
      return;
    }
    let mockLocation = false;
    const location = await captureForegroundLocation(limits, (value) => {
      mockLocation = value;
    });
    if (!isOpen()) {
      cleanCapture(photo.uri);
      return;
    }
    return {
      uri: photo.uri,
      type: photo.type ?? 'image/jpeg',
      metadata: { location, capturedAt, key: uniqueId(), mockLocation },
    };
  } catch (error) {
    cleanCapture(photo.uri);
    throw error;
  }
}
