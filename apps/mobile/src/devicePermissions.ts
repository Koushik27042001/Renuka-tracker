import { PermissionsAndroid, Platform } from 'react-native';

export type PermissionKind = 'location' | 'camera';
export type PermissionStatus = 'allowed' | 'approximate' | 'not granted' | 'check settings';

export async function permissionStatus(kind: PermissionKind): Promise<PermissionStatus> {
  if (Platform.OS !== 'android') return 'check settings';
  const permissions = PermissionsAndroid.PERMISSIONS;
  if (kind === 'camera')
    return (await PermissionsAndroid.check(permissions.CAMERA)) ? 'allowed' : 'not granted';
  if (await PermissionsAndroid.check(permissions.ACCESS_FINE_LOCATION)) return 'allowed';
  return (await PermissionsAndroid.check(permissions.ACCESS_COARSE_LOCATION))
    ? 'approximate'
    : 'not granted';
}

export async function requestLocationPermission() {
  const { default: Geolocation } = await import('@react-native-community/geolocation');
  Geolocation.setRNConfiguration({
    skipPermissionRequests: true,
    authorizationLevel: 'whenInUse',
    enableBackgroundLocationUpdates: false,
  });
  const denied = () =>
    new Error('Location permission was denied. Allow location while using the app in Settings.');
  if (Platform.OS === 'android') {
    const { ACCESS_FINE_LOCATION: fine, ACCESS_COARSE_LOCATION: coarse } =
      PermissionsAndroid.PERMISSIONS;
    const grants = await PermissionsAndroid.requestMultiple([fine, coarse]);
    if (grants[fine] === PermissionsAndroid.RESULTS.GRANTED) return;
    if (grants[coarse] === PermissionsAndroid.RESULTS.GRANTED)
      throw new Error('Enable precise location in Settings and try again.');
    throw denied();
  }
  await new Promise<void>((resolve, reject) =>
    Geolocation.requestAuthorization(resolve, () => reject(denied())),
  );
}

export async function requestCameraPermission() {
  if (Platform.OS !== 'android') return;
  const permission = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
  if (permission !== PermissionsAndroid.RESULTS.GRANTED)
    throw new Error('Allow camera access in Settings to take a selfie.');
}
