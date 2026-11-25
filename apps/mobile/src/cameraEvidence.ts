import { AppState, PermissionsAndroid, Platform } from 'react-native';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import ReactNativeBlobUtil from 'react-native-blob-util';
import type { CurrentAttendance } from '@renuka/shared';
import { captureForegroundLocation } from './foregroundLocation';
import { uniqueId } from './requestId';

export type Capture = {
  uri: string;
  type: string;
  metadata: {
    capturedAt: string;
    location: Awaited<ReturnType<typeof captureForegroundLocation>>;
    key: string;
    mockLocation: boolean;
    source?: 'gallery';
  };
};
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
  source: 'camera' | 'gallery' = 'camera',
): Promise<Capture | undefined> {
  if (AppState.currentState !== 'active') throw new Error('Open the app before adding a photo.');
  if (source === 'camera' && Platform.OS === 'android') {
    const permission = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
    if (permission !== PermissionsAndroid.RESULTS.GRANTED)
      throw new Error('Allow camera access in Settings to take a selfie.');
  }
  const options = {
    mediaType: 'photo' as const,
    maxWidth: 1280,
    maxHeight: 1280,
    quality: 0.8 as const,
    assetRepresentationMode: 'compatible' as const,
  };
  const result =
    source === 'gallery'
      ? await launchImageLibrary({ ...options, selectionLimit: 1 })
      : await launchCamera({
          ...options,
          cameraType: 'front',
          saveToPhotos: false,
        });
  if (result.didCancel) return;
  if (source === 'camera' && result.errorCode === 'permission')
    throw new Error('Allow camera access in Settings to take a selfie.');
  const photo = result.assets?.[0];
  if (result.errorCode || !photo?.uri)
    throw new Error(
      source === 'gallery'
        ? 'Could not open the selected photo.'
        : 'A camera selfie could not be captured.',
    );
  const capturedAt = new Date().toISOString();
  try {
    if (source === 'gallery' && photo.type !== 'image/jpeg' && photo.type !== 'image/png')
      throw new Error('Choose a JPEG or PNG photo from your gallery.');
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
      metadata: {
        location,
        capturedAt,
        key: uniqueId(),
        mockLocation,
        ...(source === 'gallery' && { source }),
      },
    };
  } catch (error) {
    cleanCapture(photo.uri);
    throw error;
  }
}
