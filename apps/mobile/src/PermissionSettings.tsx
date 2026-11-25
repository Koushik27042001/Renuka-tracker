import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, ScrollView, Text, View } from 'react-native';
import { Action, Problem, styles } from './attendanceScreens';
import {
  permissionStatus,
  requestCameraPermission,
  requestLocationPermission,
  type PermissionKind,
  type PermissionStatus,
} from './devicePermissions';

const permissions = [
  {
    kind: 'location',
    title: 'Precise location',
    detail: 'Used during check-in, checkout, and visit selfie verification.',
  },
  { kind: 'camera', title: 'Camera', detail: 'Used when you take a field-visit selfie.' },
] as const;

export function PermissionSettings() {
  const [statuses, setStatuses] = useState<Partial<Record<PermissionKind, PermissionStatus>>>({});
  const [busy, setBusy] = useState<PermissionKind>();
  const [error, setError] = useState('');
  const active = useRef(false);
  const requestPending = useRef(false);
  const refresh = useCallback(async () => {
    const [location, camera] = await Promise.all([
      permissionStatus('location'),
      permissionStatus('camera'),
    ]);
    if (active.current) setStatuses({ location, camera });
  }, []);
  useEffect(() => {
    active.current = true;
    const update = () =>
      void refresh().catch(() => {
        if (active.current) setError('Could not read permissions. Check the device settings.');
      });
    update();
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') update();
    });
    return () => {
      active.current = false;
      listener.remove();
    };
  }, [refresh]);
  async function request(kind: PermissionKind) {
    if (requestPending.current) return;
    requestPending.current = true;
    setBusy(kind);
    setError('');
    try {
      await (kind === 'camera' ? requestCameraPermission() : requestLocationPermission());
    } catch (error) {
      if (active.current)
        setError(error instanceof Error ? error.message : 'Could not request permission.');
    } finally {
      requestPending.current = false;
      if (active.current) {
        setBusy(undefined);
        await refresh().catch(() => undefined);
      }
    }
  }
  return (
    <ScrollView contentContainerStyle={styles.page}>
      {permissions.map(({ kind, title, detail }) => (
        <View key={kind} style={styles.card}>
          <Text accessibilityRole="header" style={styles.label}>
            {title}
          </Text>
          <Text style={styles.muted}>{detail}</Text>
          <Text style={styles.muted}>
            {Platform.OS === 'android'
              ? 'Status: ' + (statuses[kind] ?? 'checking…')
              : kind === 'camera'
                ? 'iOS asks when you first take a selfie.'
                : 'Review current access in iOS Settings.'}
          </Text>
          {(Platform.OS === 'android' ? statuses[kind] !== 'allowed' : kind === 'location') && (
            <Action
              title={
                busy === kind
                  ? 'Requesting…'
                  : 'Request ' + (kind === 'location' ? 'precise location' : 'camera access')
              }
              disabled={!!busy}
              onPress={() => void request(kind)}
            />
          )}
        </View>
      ))}
      {error && <Problem message={error} />}
      <Action
        title="Open app settings"
        secondary
        onPress={() => {
          void Linking.openSettings().catch(() =>
            setError('Open Settings on your device and select Rss hrms desk.'),
          );
        }}
      />
    </ScrollView>
  );
}
