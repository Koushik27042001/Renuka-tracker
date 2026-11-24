import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useQuery } from '@tanstack/react-query';
import type { VisitPage } from '@renuka/shared';
import { Action, styles } from './attendanceScreens';
import { authenticated } from './api';
import { offlineDrafts } from './offlineStore';
import { onOfflineQueueChanged } from './offlineQueueEvents';

export function MobileVisitSummary({ owner, open }: { owner: string; open: (id: string) => void }) {
  const [online, setOnline] = useState(false);
  const [pending, setPending] = useState<number>();
  useEffect(() => {
    let active = true;
    const refresh = () =>
      void offlineDrafts(owner)
        .then((rows) => {
          if (active) setPending(rows.length);
        })
        .catch(() => undefined);
    const sync = onOfflineQueueChanged(refresh);
    const connection = NetInfo.addEventListener((state) => {
      if (active) setOnline(state.isConnected === true && state.isInternetReachable !== false);
    });
    refresh();
    return () => {
      active = false;
      sync();
      connection();
    };
  }, [owner]);
  const activity = useQuery({
    queryKey: ['visits', 'home', owner],
    enabled: online,
    queryFn: ({ signal }) =>
      authenticated<VisitPage>('/visits/me?page=1&limit=3', { owner, signal }),
  });
  return (
    <View style={styles.card}>
      <Text style={styles.label}>Field visits</Text>
      {!online && <Text style={styles.muted}>Offline. Attendance requires a connection.</Text>}
      {pending !== undefined && (
        <Text style={styles.muted}>{pending} saved in the visit sync queue</Text>
      )}
      {activity.data && <Text style={styles.muted}>{activity.data.total} field visits</Text>}
      {activity.data?.visits.map((visit) => (
        <Action
          title={visit.clientName + ' · ' + visit.status.replaceAll('_', ' ').toLowerCase()}
          key={visit.id}
          secondary
          onPress={() => open(visit.id)}
        />
      ))}
    </View>
  );
}
