import { AppState, PermissionsAndroid, Platform } from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import { attendanceLocation, type AttendanceLocation } from '@renuka/shared';

type Limits = { maximumAccuracy: number; maximumAgeSeconds: number };
function gpsError(code: number) {
  if (code === 1)
    return new Error(
      'Location permission was denied. Allow location while using the app in Settings.',
    );
  if (code === 3) return new Error('GPS timed out. Move outdoors and try again.');
  return new Error('Location is unavailable. Turn on Location Services and try again.');
}
export async function captureForegroundLocation(
  limits: Limits,
  onMocked?: (mocked: boolean) => void,
): Promise<AttendanceLocation> {
  if (AppState.currentState !== 'active')
    throw new Error('Keep the app open to capture your location.');
  Geolocation.setRNConfiguration({
    skipPermissionRequests: true,
    authorizationLevel: 'whenInUse',
    enableBackgroundLocationUpdates: false,
  });
  if (Platform.OS === 'android') {
    const fine = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
    const coarse = PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION;
    const grants = await PermissionsAndroid.requestMultiple([fine, coarse]);
    if (grants[fine] !== PermissionsAndroid.RESULTS.GRANTED) {
      if (grants[coarse] === PermissionsAndroid.RESULTS.GRANTED)
        throw new Error('Enable precise location in Settings and try again.');
      throw gpsError(1);
    }
  } else {
    await new Promise<void>((resolve, reject) =>
      Geolocation.requestAuthorization(resolve, (error) => reject(gpsError(error.code))),
    );
  }
  if (AppState.currentState !== 'active')
    throw new Error('Keep the app open to capture your location.');
  return new Promise<AttendanceLocation>((resolve, reject) => {
    const timer = setTimeout(() => {
      subscription.remove();
      reject(gpsError(3));
    }, 16000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        clearTimeout(timer);
        subscription.remove();
        reject(new Error('Location capture stopped. Open the app and try again.'));
      }
    });
    const finish = () => {
      clearTimeout(timer);
      subscription.remove();
    };
    const deadline = Date.now() + 16000;
    Geolocation.getCurrentPosition(
      (position) => {
        finish();
        if (AppState.currentState !== 'active' || Date.now() > deadline) {
          reject(gpsError(3));
          return;
        }
        const age = Date.now() - position.timestamp;
        if (!Number.isFinite(age) || age > limits.maximumAgeSeconds * 1000 || age < -5000) {
          reject(new Error('GPS returned an old reading. Capture again.'));
          return;
        }
        const result = attendanceLocation.safeParse({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          capturedAt: new Date(position.timestamp).toISOString(),
        });
        if (!result.success || result.data.accuracy > limits.maximumAccuracy) {
          reject(new Error('Location accuracy is too low. Move to an open area and retry.'));
          return;
        }
        onMocked?.((position as { mocked?: boolean }).mocked === true);
        resolve(result.data);
      },
      (error) => {
        finish();
        reject(gpsError(error.code));
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      },
    );
  });
}
