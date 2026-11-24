import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AttendanceLocation,
  AttendanceRecord,
  AttendanceSubmission,
  CurrentAttendance,
} from '@renuka/shared';
import { MobileApiError, mobileAttendance } from './api';

import { MobileVisitSummary } from './MobileVisitSummary';
import { cacheOfflineShift } from './offlineStore';
import { uniqueId } from './requestId';
import { captureForegroundLocation } from './foregroundLocation';
import { elapsedClock, formatShiftTime } from './attendanceTime';

export type AttendanceStack = {
  Attendance: undefined;
  CheckIn: { limits: CurrentAttendance['limits'] };
  CheckOut: { limits: CurrentAttendance['limits']; id: string };
  History: undefined;
  Visits: undefined;
  OfflineQueue: undefined;
  Profile: undefined;
  VisitDraft: { id?: string };
  VisitCamera: { id: string; limits: CurrentAttendance['limits'] };
  VisitDetail: { id: string };
  Details: { id: string };
};

export function Action({
  title,
  onPress,
  disabled,
  secondary,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, secondary && styles.secondary, disabled && styles.disabled]}
    >
      <Text style={[styles.buttonText, secondary && styles.secondaryText]}>{title}</Text>
    </Pressable>
  );
}
export function Problem({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <View style={styles.warning}>
      <Text accessibilityRole="alert" style={styles.error}>
        {message}
      </Text>
      {retry && <Action title="Retry" onPress={retry} secondary />}
    </View>
  );
}
export const statusNames = {
  CHECKED_IN: 'On duty',
  CHECKED_OUT: 'Checked out',
  INCOMPLETE: 'Incomplete',
};
function minutesText(minutes: number | null) {
  return minutes === null ? '—' : Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm';
}

export function WorkingTimer({
  checkIn,
  serverTime,
  verifiedAt,
}: {
  checkIn: string;
  serverTime: string;
  verifiedAt: number;
}) {
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) =>
      setActive(state === 'active'),
    );
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!focused || !active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active, focused]);
  return (
    <Text style={styles.timer}>
      {elapsedClock(checkIn, Date.parse(serverTime) + now - verifiedAt)}
    </Text>
  );
}

export function AttendanceHome({
  navigation,
  employee,
  onLogout,
}: NativeStackScreenProps<AttendanceStack, 'Attendance'> & {
  employee: { id: string; fullName: string; employeeCode: string };
  onLogout: () => Promise<void>;
}) {
  const [logoutError, setLogoutError] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const current = useQuery({
    queryKey: ['attendance', 'current'],
    queryFn: ({ signal }) => mobileAttendance.current(signal),
  });
  const refetch = current.refetch;
  useFocusEffect(
    useCallback(() => {
      void refetch();
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') void refetch();
      });
      return () => subscription.remove();
    }, [refetch]),
  );
  const data = current.data;
  useEffect(() => {
    if (data) void cacheOfflineShift(employee.id, data).catch(() => undefined);
  }, [employee.id, data]);
  const row = data?.attendance;
  const checkedIn = row?.status === 'CHECKED_IN';
  async function logout() {
    setLogoutError('');
    setSigningOut(true);
    try {
      await onLogout();
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : 'Sign-out failed');
    } finally {
      setSigningOut(false);
    }
  }
  return (
    <ScrollView
      contentContainerStyle={styles.page}
      refreshControl={
        <RefreshControl refreshing={current.isRefetching} onRefresh={() => void refetch()} />
      }
    >
      <Text style={styles.title}>{employee.fullName}</Text>
      <Text style={styles.muted}>
        {employee.employeeCode} · {data?.attendanceDate ?? 'Attendance'}
      </Text>
      {current.isPending ? (
        <ActivityIndicator accessibilityLabel="Loading attendance" />
      ) : current.error ? (
        <Problem message={current.error.message} retry={() => void refetch()} />
      ) : (
        data && (
          <View style={styles.card}>
            <Text style={styles.label}>{row ? statusNames[row.status] : 'Not checked in'}</Text>
            {checkedIn && row ? (
              <WorkingTimer
                checkIn={row.checkInTime}
                serverTime={data.serverTime}
                verifiedAt={current.dataUpdatedAt}
              />
            ) : (
              <Text style={styles.timer}>{row ? minutesText(row.workingMinutes) : '—'}</Text>
            )}
            <Text style={styles.muted}>
              Check-in {formatShiftTime(row?.checkInTime ?? null, row?.timezone ?? data.timezone)}
            </Text>
            <Text style={styles.muted}>
              Checkout {formatShiftTime(row?.checkOutTime ?? null, row?.timezone ?? data.timezone)}
            </Text>
            {checkedIn && row ? (
              <Action
                title="Check out"
                onPress={() => navigation.navigate('CheckOut', { limits: data.limits, id: row.id })}
              />
            ) : (
              <Action
                title="Check in"
                onPress={() => navigation.navigate('CheckIn', { limits: data.limits })}
              />
            )}
          </View>
        )
      )}
      <MobileVisitSummary
        owner={employee.id}
        open={(id) => navigation.navigate('VisitDetail', { id })}
      />
      <Action title="Field visits" secondary onPress={() => navigation.navigate('Visits')} />
      <Action
        title="Profile and settings"
        secondary
        onPress={() => navigation.navigate('Profile')}
      />
      <Action
        title="Visit sync queue"
        secondary
        onPress={() => navigation.navigate('OfflineQueue')}
      />
      <Action title="Attendance history" secondary onPress={() => navigation.navigate('History')} />
      {logoutError && <Problem message={logoutError} />}
      <Action
        title={signingOut ? 'Signing out…' : 'Sign out'}
        secondary
        disabled={signingOut}
        onPress={() => void logout()}
      />
    </ScrollView>
  );
}

export function ShiftScreen(
  props:
    | NativeStackScreenProps<AttendanceStack, 'CheckIn'>
    | NativeStackScreenProps<AttendanceStack, 'CheckOut'>,
) {
  const checkout = props.route.name === 'CheckOut';
  const attendanceId = props.route.name === 'CheckOut' ? props.route.params.id : undefined;
  const { limits } = props.route.params;
  const query = useQueryClient();
  const lock = useRef(false);
  const [fix, setFix] = useState<AttendanceLocation>();
  const [pending, setPending] = useState<AttendanceSubmission>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState<AttendanceRecord>();
  const title = checkout ? 'checkout' : 'check-in';

  async function capture() {
    if (lock.current || pending) return;
    lock.current = true;
    setBusy(true);
    setFix(undefined);
    setMessage('');
    try {
      setFix(await captureForegroundLocation(limits));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not obtain a location.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function submit() {
    if (lock.current || !fix) return;
    const payload: AttendanceSubmission = pending ?? {
      location: fix,
      idempotencyKey: uniqueId(),
      ...(attendanceId ? { attendanceId } : {}),
    };
    lock.current = true;
    setPending(payload);
    setBusy(true);
    setMessage('');
    try {
      const saved = await mobileAttendance.submit(checkout ? 'check-out' : 'check-in', payload);
      setConfirmed(saved);
      setPending(undefined);
    } catch (error) {
      if (error instanceof MobileApiError && [400, 409].includes(error.status)) {
        setPending(undefined);
        setFix(undefined);
      }
      setMessage(error instanceof Error ? error.message : 'Attendance could not be confirmed.');
    } finally {
      lock.current = false;
      setBusy(false);
      void query.invalidateQueries({ queryKey: ['attendance'] });
    }
  }
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.title}>{checkout ? 'Check out' : 'Check in'}</Text>
      {confirmed ? (
        <View style={styles.card}>
          <Text style={styles.label}>{checkout ? 'Checkout confirmed' : 'Check-in confirmed'}</Text>
          <Text style={styles.muted}>
            {formatShiftTime(
              checkout ? confirmed.checkOutTime : confirmed.checkInTime,
              confirmed.timezone,
            )}
          </Text>
          {checkout && (
            <Text style={styles.muted}>Working time {minutesText(confirmed.workingMinutes)}</Text>
          )}
          <Action title="Done" onPress={() => props.navigation.goBack()} />
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.muted}>Your current location is attached to this {title}.</Text>
          {fix && (
            <View>
              <Text style={styles.label}>
                {fix.latitude.toFixed(6)}, {fix.longitude.toFixed(6)}
              </Text>
              <Text style={styles.muted}>Accuracy ±{Math.round(fix.accuracy)} m</Text>
              {fix.accuracy > limits.preferredAccuracy && (
                <Text style={styles.muted}>You can capture again for a more precise reading.</Text>
              )}
            </View>
          )}
          {message && <Problem message={message} />}
          {pending && !busy && (
            <Text accessibilityLiveRegion="polite" style={styles.muted}>
              Confirmation pending. Retry this submission to reconcile it with the server.
            </Text>
          )}
          {busy && (
            <ActivityIndicator
              accessibilityLabel={pending ? 'Submitting attendance' : 'Capturing location'}
            />
          )}
          {!pending && (
            <Action
              title={fix ? 'Capture again' : 'Capture location'}
              onPress={() => void capture()}
              disabled={busy}
              secondary={!!fix}
            />
          )}
          {!!fix && (
            <Action
              title={pending ? 'Retry submission' : 'Confirm ' + title}
              onPress={() => void submit()}
              disabled={busy}
            />
          )}
          {!fix && message && (
            <Action
              title="Open settings"
              onPress={() => void Linking.openSettings().catch(() => undefined)}
              secondary
            />
          )}
        </View>
      )}
    </ScrollView>
  );
}

export function AttendanceHistory({
  navigation,
}: NativeStackScreenProps<AttendanceStack, 'History'>) {
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [range, setRange] = useState({ from: '', to: '' });
  const [filterError, setFilterError] = useState('');
  const history = useQuery({
    queryKey: ['attendance', 'history', page, range],
    queryFn: ({ signal }) => mobileAttendance.history(page, range.from, range.to, signal),
  });
  function filter() {
    const valid = (value: string) =>
      !value ||
      (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(Date.parse(value)) &&
        new Date(value).toISOString().slice(0, 10) === value);
    if (!valid(from) || !valid(to) || (!!from && !!to && from > to)) {
      setFilterError('Enter a valid date range in YYYY-MM-DD format.');
      return;
    }
    setFilterError('');
    setRange({ from, to });
    setPage(1);
  }
  return (
    <ScrollView
      contentContainerStyle={styles.page}
      refreshControl={
        <RefreshControl
          refreshing={history.isRefetching}
          onRefresh={() => void history.refetch()}
        />
      }
    >
      <View style={styles.card}>
        <Text style={styles.label}>Date range</Text>
        <TextInput
          accessibilityLabel="From date"
          placeholder="From YYYY-MM-DD"
          style={styles.input}
          value={from}
          onChangeText={setFrom}
        />
        <TextInput
          accessibilityLabel="To date"
          placeholder="To YYYY-MM-DD"
          style={styles.input}
          value={to}
          onChangeText={setTo}
        />
        {filterError && <Problem message={filterError} />}
        <Action title="Apply dates" onPress={filter} secondary />
      </View>
      {history.isPending ? (
        <ActivityIndicator accessibilityLabel="Loading history" />
      ) : history.error ? (
        <Problem message={history.error.message} retry={() => void history.refetch()} />
      ) : history.data?.records.length ? (
        history.data.records.map((row) => (
          <Pressable
            key={row.id}
            accessibilityRole="button"
            style={styles.card}
            onPress={() => navigation.navigate('Details', { id: row.id })}
          >
            <Text style={styles.label}>
              {row.attendanceDate} · {statusNames[row.status]}
            </Text>
            <Text style={styles.muted}>
              Check-in {formatShiftTime(row.checkInTime, row.timezone)}
            </Text>
            <Text style={styles.muted}>
              Checkout {formatShiftTime(row.checkOutTime, row.timezone)}
            </Text>
            <Text style={styles.muted}>Working time {minutesText(row.workingMinutes)}</Text>
          </Pressable>
        ))
      ) : (
        <Text style={styles.muted}>No attendance sessions in this date range.</Text>
      )}
      <View style={styles.row}>
        <Action
          title="Previous"
          disabled={page === 1 || history.isFetching}
          onPress={() => setPage(page - 1)}
          secondary
        />
        <Text style={styles.muted}>Page {page}</Text>
        <Action
          title="Next"
          disabled={page >= (history.data?.pagination.totalPages ?? 1) || history.isFetching}
          onPress={() => setPage(page + 1)}
          secondary
        />
      </View>
    </ScrollView>
  );
}

function Point({ label, location }: { label: string; location?: AttendanceLocation }) {
  const [error, setError] = useState(false);
  if (!location) return null;
  const open = () => {
    const point = encodeURIComponent(location.latitude + ',' + location.longitude);
    void Linking.openURL('https://www.google.com/maps/search/?api=1&query=' + point).catch(() =>
      setError(true),
    );
  };
  return (
    <View style={styles.card}>
      <Text style={styles.label}>{label} location</Text>
      <Text style={styles.muted}>
        {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)} · ±
        {Math.round(location.accuracy)} m
      </Text>
      {error && <Problem message="Could not open Maps." />}
      <Action title="Open in Maps" onPress={open} secondary />
    </View>
  );
}
export function AttendanceDetails({ route }: NativeStackScreenProps<AttendanceStack, 'Details'>) {
  const detail = useQuery({
    queryKey: ['attendance', 'detail', route.params.id],
    queryFn: ({ signal }) => mobileAttendance.detail(route.params.id, signal),
  });
  const row = detail.data;
  return (
    <ScrollView contentContainerStyle={styles.page}>
      {detail.isPending ? (
        <ActivityIndicator accessibilityLabel="Loading record" />
      ) : detail.error ? (
        <Problem message={detail.error.message} retry={() => void detail.refetch()} />
      ) : (
        row && (
          <>
            <View style={styles.card}>
              <Text style={styles.label}>
                {row.attendanceDate} · {statusNames[row.status]}
              </Text>
              <Text style={styles.muted}>Record {row.id}</Text>
              <Text style={styles.muted}>
                Check-in {formatShiftTime(row.checkInTime, row.timezone)}
              </Text>
              <Text style={styles.muted}>
                Checkout {formatShiftTime(row.checkOutTime, row.timezone)}
              </Text>
              <Text style={styles.muted}>Working time {minutesText(row.workingMinutes)}</Text>
            </View>
            <Point label="Check-in" location={row.checkInLocation} />
            <Point label="Checkout" location={row.checkOutLocation} />
          </>
        )
      )}
    </ScrollView>
  );
}
export const styles = StyleSheet.create({
  page: { flexGrow: 1, gap: 14, padding: 20, backgroundColor: '#f6f5fc' },
  title: { fontSize: 29, fontWeight: '700', color: '#252047' },
  label: { fontSize: 18, fontWeight: '600', color: '#252047' },
  muted: { fontSize: 15, color: '#544f70', lineHeight: 22 },
  card: { padding: 17, borderRadius: 15, backgroundColor: 'white', gap: 10 },
  timer: { fontSize: 34, color: '#4e37af', fontVariant: ['tabular-nums'], fontWeight: '700' },
  button: {
    padding: 12,
    minHeight: 48,
    backgroundColor: '#5740bc',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: 'white', fontSize: 16, fontWeight: '600' },
  secondary: { backgroundColor: '#eae4fb' },
  secondaryText: { color: '#3f2a91' },
  disabled: { opacity: 0.5 },
  warning: { backgroundColor: '#fce9eb', padding: 12, borderRadius: 10, gap: 8 },
  error: { color: '#812039', fontSize: 15 },
  input: {
    borderWidth: 1,
    borderColor: '#dcd6ee',
    borderRadius: 9,
    color: '#252047',
    padding: 12,
    minHeight: 46,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
});
