import { AppState, PermissionsAndroid, Platform } from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import { attendanceLocation, type AttendanceLocation } from '@renuka/shared';

type Limits = { preferredAccuracy: number; maximumAccuracy: number; maximumAgeSeconds: number };
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
    const maxAge = limits.maximumAgeSeconds * 1000;
    const target = Math.min(limits.preferredAccuracy, limits.maximumAccuracy);
    let best: { location: AttendanceLocation; timestamp: number; mocked: boolean } | undefined;
    let sawStale = false;
    let sawInaccurate = false;
    let finished = false;
    let watch: number | undefined;

    function finish(error?: Error) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      subscription.remove();
      if (watch !== undefined) Geolocation.clearWatch(watch);
      if (error) {
        reject(error);
      } else if (best && Date.now() - best.timestamp <= maxAge) {
        onMocked?.(best.mocked);
        resolve(best.location);
      } else if (sawInaccurate) {
        reject(new Error('Location accuracy is too low. Move to an open area and retry.'));
      } else if (sawStale || best) {
        reject(new Error('GPS returned an old reading. Capture again.'));
      } else {
        reject(gpsError(3));
      }
    }

    const timer = setTimeout(() => finish(), Math.min(15_000, maxAge));
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active')
        finish(new Error('Location capture stopped. Open the app and try again.'));
    });
    watch = Geolocation.watchPosition(
      (position) => {
        if (finished) return;
        if (AppState.currentState !== 'active') {
          finish(new Error('Location capture stopped. Open the app and try again.'));
          return;
        }
        const age = Date.now() - position.timestamp;
        if (!Number.isFinite(age) || age > maxAge || age < -5000) {
          sawStale = true;
          return;
        }
        const result = attendanceLocation.safeParse({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          capturedAt: new Date(position.timestamp).toISOString(),
        });
        if (!result.success || result.data.accuracy > limits.maximumAccuracy) {
          sawInaccurate = true;
          return;
        }
        if (
          !best ||
          Date.now() - best.timestamp > maxAge ||
          result.data.accuracy < best.location.accuracy ||
          (result.data.accuracy === best.location.accuracy && position.timestamp > best.timestamp)
        ) {
          best = {
            location: result.data,
            timestamp: position.timestamp,
            mocked: (position as { mocked?: boolean }).mocked === true,
          };
        }
        if (result.data.accuracy <= target) finish();
      },
      (error) => {
        if (error.code === 1) finish(gpsError(1));
        else if (error.code === 3 || best || sawInaccurate || sawStale) finish();
        else finish(gpsError(error.code));
      },
      { enableHighAccuracy: true, maximumAge: 0, distanceFilter: 0, interval: 1000 },
    );
    if (finished) Geolocation.clearWatch(watch);
  });
}
