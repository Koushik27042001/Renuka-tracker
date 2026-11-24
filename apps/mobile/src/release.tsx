import { useQuery } from '@tanstack/react-query';
import { Linking, Platform, ScrollView, Text, View } from 'react-native';
import { apiUrl, appVersion } from '../config';
import { Action, Problem, styles } from './attendanceScreens';

type ReleasePolicy = {
  updateRequired: boolean;
  updateAvailable: boolean;
  downloadUrl?: string;
  latestVersion?: string;
  supportEmail?: string;
  timezone: string;
  offlineEvidenceEnabled?: boolean;
  offlineSyncMaxRetries?: number;
};
export function useReleasePolicy() {
  return useQuery({
    queryKey: ['app-version', Platform.OS, appVersion],
    enabled: !!apiUrl,
    refetchInterval: 300_000,
    queryFn: async ({ signal }): Promise<ReleasePolicy> => {
      const response = await fetch(
        apiUrl +
          '/api/v1/app/version?platform=' +
          Platform.OS +
          '&version=' +
          encodeURIComponent(appVersion),
        { signal },
      );
      if (!response.ok) throw new Error('Could not check for an app update.');
      return (await response.json()).data;
    },
  });
}
export function UpdateNotice({
  policy,
  required = false,
}: {
  policy: ReleasePolicy;
  required?: boolean;
}) {
  const url = policy.downloadUrl;
  return (
    <View style={styles.card}>
      <Text style={styles.label}>{required ? 'Update required' : 'Update available'}</Text>
      <Text style={styles.muted}>Renuka Tracker {policy.latestVersion} is available.</Text>
      {url && /^https:\/\/[^/\s@]+(?:\/|$)/i.test(url) && (
        <Action
          title="Open official download page"
          onPress={() => {
            void Linking.openURL(url).catch(() => undefined);
          }}
        />
      )}
    </View>
  );
}
export function MobileProfile({
  employee,
  onLogout,
}: {
  employee: { fullName: string; employeeCode: string; department?: string; designation?: string };
  onLogout: () => Promise<void>;
}) {
  const policy = useReleasePolicy();
  const logout = useQuery({
    queryKey: ['profile-logout'],
    enabled: false,
    queryFn: async () => {
      await onLogout();
      return true;
    },
  });
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.title}>Profile and settings</Text>
      <View style={styles.card}>
        <Text style={styles.label}>{employee.fullName}</Text>
        <Text style={styles.muted}>{employee.employeeCode}</Text>
        {!!employee.department && <Text style={styles.muted}>{employee.department}</Text>}
        {!!employee.designation && <Text style={styles.muted}>{employee.designation}</Text>}
        <Text style={styles.muted}>App version {appVersion}</Text>
        {policy.data?.timezone && (
          <Text style={styles.muted}>Business timezone {policy.data.timezone}</Text>
        )}
        {policy.data?.supportEmail && (
          <Text style={styles.muted}>Support {policy.data.supportEmail}</Text>
        )}
      </View>
      {policy.data?.updateAvailable && <UpdateNotice policy={policy.data} />}
      {logout.isError && <Problem message="Could not sign out. Try again while connected." />}
      <Action title="Sign out" disabled={logout.isFetching} onPress={() => void logout.refetch()} />
    </ScrollView>
  );
}
