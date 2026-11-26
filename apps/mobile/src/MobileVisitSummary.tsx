import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { subscribeApiReachability } from './apiReachability';
import { useQuery } from '@tanstack/react-query';
import type { VisitPage } from '@renuka/shared';
import { colors } from './theme';
import { authenticated } from './api';
import { offlineDrafts } from './offlineStore';
import { onOfflineQueueChanged } from './offlineQueueEvents';

export function MobileVisitSummary({ owner, open }: { owner: string; open: (id: string) => void }) {
  const [online, setOnline] = useState<boolean>();
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
    const connection = subscribeApiReachability((reachable) => {
      if (active) setOnline(reachable);
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
    enabled: online === true,
    queryFn: ({ signal }) =>
      authenticated<VisitPage>('/visits/me?page=1&limit=3', { owner, signal }),
  });
  const visits = activity.data?.visits ?? [];
  if (!visits.length && !pending && online !== false) return null;
  return (
    <View style={summary.card}>
      <Text accessibilityRole="header" style={summary.heading}>
        Recent visits
      </Text>
      {online === false && <Text style={summary.note}>Visit updates unavailable</Text>}
      {!!pending && <Text style={summary.note}>{pending} saved in the sync queue</Text>}
      {visits.map((visit) => (
        <Pressable
          accessibilityRole="button"
          key={visit.id}
          onPress={() => open(visit.id)}
          style={({ pressed }) => [summary.visit, pressed && summary.pressed]}
        >
          <Text style={summary.client}>{visit.clientName}</Text>
          <Text style={summary.status}>{visit.status.replaceAll('_', ' ').toLowerCase()}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const summary = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 20,
    gap: 6,
    padding: 16,
  },
  heading: { color: colors.forest, fontSize: 20, fontWeight: '800', marginBottom: 4 },
  note: { color: colors.muted, fontSize: 14 },
  visit: { minHeight: 52, borderRadius: 10, padding: 10, backgroundColor: colors.ivory, gap: 2 },
  pressed: { backgroundColor: colors.greenWash },
  client: { color: colors.forest, fontSize: 16, fontWeight: '700' },
  status: { color: colors.muted, fontSize: 13, textTransform: 'capitalize' },
});
