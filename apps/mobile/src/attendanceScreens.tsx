import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { colors, homeColors } from './theme';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Platform,
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
import { cacheOfflineShift, readOfflineShift } from './offlineStore';
import { subscribeApiReachability } from './apiReachability';
import { uniqueId } from './requestId';
import { captureForegroundLocation, isFreshLocation } from './foregroundLocation';
import { elapsedClock, formatShiftTime } from './attendanceTime';

export type AttendanceStack = {
  Attendance: undefined;
  CheckIn: { limits: CurrentAttendance['limits'] };
  CheckOut: { limits: CurrentAttendance['limits']; id: string };
  History: undefined;
  Visits: undefined;
  OfflineQueue: undefined;
  Profile: undefined;
  Permissions: undefined;
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
  variant,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
  variant?: 'attendance' | 'home';
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondary,
        variant === 'attendance' && styles.attendanceButton,
        variant === 'home' && styles.homeButton,
        disabled && styles.disabled,
        pressed && styles.buttonPressed,
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          secondary && styles.secondaryText,
          disabled && styles.disabledText,
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

function DashboardLink({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.dashboardLink, pressed && styles.dashboardLinkPressed]}
    >
      <Text style={styles.dashboardLabel}>{title}</Text>
      <View importantForAccessibility="no" style={styles.chevron} />
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
  updateNotice,
}: NativeStackScreenProps<AttendanceStack, 'Attendance'> & {
  employee: { id: string; fullName: string; employeeCode: string };
  onLogout: () => Promise<void>;
  updateNotice?: ReactNode;
}) {
  const [logoutError, setLogoutError] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const current = useQuery({
    queryKey: ['attendance', 'current'],
    queryFn: ({ signal }) => mobileAttendance.current(signal),
  });
  const saved = useQuery({
    queryKey: ['saved-attendance', employee.id],
    queryFn: async () => (await readOfflineShift(employee.id)) ?? null,
    enabled: !current.data,
  });
  const refetch = current.refetch;
  useFocusEffect(
    useCallback(() => {
      void refetch({ cancelRefetch: false });
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') void refetch({ cancelRefetch: false });
      });
      let hadFailure = false;
      const unsubscribe = subscribeApiReachability((reachable) => {
        if (!reachable) hadFailure = true;
        else if (hadFailure) {
          hadFailure = false;
          void refetch({ cancelRefetch: false });
        }
      });
      return () => {
        subscription.remove();
        unsubscribe();
      };
    }, [refetch]),
  );
  const live = current.data;
  const data = live ?? saved.data;
  const unverified = !live || current.isError;
  useEffect(() => {
    if (live) void cacheOfflineShift(employee.id, live).catch(() => undefined);
  }, [employee.id, live]);
  const checkoutDeadline = live?.checkoutDeadline;
  const serverTime = live?.serverTime;
  useEffect(() => {
    if (!checkoutDeadline || !serverTime) return;
    const remaining = Date.parse(checkoutDeadline) - Date.parse(serverTime);
    const refreshAt = current.dataUpdatedAt + remaining;
    const timer = setTimeout(() => void refetch(), Math.max(0, refreshAt - Date.now()));
    return () => clearTimeout(timer);
  }, [checkoutDeadline, serverTime, current.dataUpdatedAt, refetch]);
  const row = data?.attendance;
  const checkedIn = row?.status === 'CHECKED_IN';
  const onDuty = checkedIn && !unverified;
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
      contentContainerStyle={[styles.page, styles.homePage]}
      refreshControl={
        <RefreshControl
          refreshing={current.isRefetching}
          onRefresh={() => void refetch()}
          colors={[homeColors.red]}
          tintColor={homeColors.red}
        />
      }
    >
      <View style={[styles.hero, styles.homeHero]}>
        <Text style={styles.homeHeroMeta}>{employee.employeeCode}</Text>
        <Text accessibilityRole="header" style={styles.heroTitle}>
          {employee.fullName}
        </Text>
        {data?.attendanceDate && (
          <Text style={styles.heroMeta}>
            {new Date(data.attendanceDate + 'T00:00:00Z').toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              timeZone: 'UTC',
            })}
          </Text>
        )}
      </View>
      {updateNotice}
      {current.isPending && (
        <View>
          <ActivityIndicator color={homeColors.red} accessibilityLabel="Loading attendance" />
          <Text style={styles.muted}>Checking attendance with the server…</Text>
        </View>
      )}
      {current.error && <Problem message={current.error.message} retry={() => void refetch()} />}
      {data && (
        <View style={[styles.card, styles.homeCard]}>
          {unverified && (
            <Text style={styles.muted}>
              Last saved attendance. Waiting for server confirmation.
            </Text>
          )}
          <View style={styles.shiftHeading}>
            <Text accessibilityRole="header" style={styles.shiftTitle}>
              Attendance
            </Text>
            <View style={[styles.statusBadge, onDuty && styles.statusOnDuty]}>
              <View style={[styles.statusDot, onDuty && styles.statusDotOnDuty]} />
              <Text style={[styles.statusText, onDuty && styles.statusTextOnDuty]}>
                {unverified ? 'Last saved' : row ? statusNames[row.status] : 'Not checked in'}
              </Text>
            </View>
          </View>
          {row && !unverified && (checkedIn || row.workingMinutes != null) && (
            <View style={styles.durationPanel}>
              <Text style={styles.timeLabel}>{checkedIn ? 'Time on duty' : 'Hours worked'}</Text>
              {checkedIn ? (
                <WorkingTimer
                  checkIn={row.checkInTime}
                  serverTime={data.serverTime}
                  verifiedAt={current.dataUpdatedAt}
                />
              ) : (
                <Text style={styles.timer}>{minutesText(row.workingMinutes)}</Text>
              )}
            </View>
          )}
          {row && (
            <View style={styles.punches}>
              <View style={styles.punch}>
                <Text style={styles.timeLabel}>Check-in</Text>
                <Text style={styles.timeValue}>
                  {formatShiftTime(row.checkInTime, row.timezone)}
                </Text>
              </View>
              <View style={styles.punch}>
                <Text style={styles.timeLabel}>Checkout</Text>
                <Text style={styles.timeValue}>
                  {row.checkOutTime
                    ? formatShiftTime(row.checkOutTime, row.timezone)
                    : checkedIn
                      ? 'Pending'
                      : 'Not recorded'}
                </Text>
              </View>
            </View>
          )}
          {checkedIn && checkoutDeadline && (
            <Text style={styles.muted}>
              Check out before {formatShiftTime(checkoutDeadline, data.timezone)}
            </Text>
          )}
          {checkedIn && row ? (
            <Action
              title="Check out"
              variant="home"
              disabled={unverified}
              onPress={() => navigation.navigate('CheckOut', { limits: data.limits, id: row.id })}
            />
          ) : (
            <Action
              title="Check in"
              variant="home"
              disabled={unverified}
              onPress={() => navigation.navigate('CheckIn', { limits: data.limits })}
            />
          )}
        </View>
      )}
      <View style={styles.dashboardLinks} accessibilityLabel="Quick actions">
        <DashboardLink title="Field visits" onPress={() => navigation.navigate('Visits')} />
        <DashboardLink title="Attendance history" onPress={() => navigation.navigate('History')} />
        <DashboardLink
          title="Visit sync queue"
          onPress={() => navigation.navigate('OfflineQueue')}
        />
      </View>
      <MobileVisitSummary
        owner={employee.id}
        open={(id) => navigation.navigate('VisitDetail', { id })}
      />
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
  const locationRequest = useRef<AbortController>(null);
  const [fix, setFix] = useState<AttendanceLocation>();
  const [pending, setPending] = useState<AttendanceSubmission>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [locationProgress, setLocationProgress] = useState('');
  const [confirmed, setConfirmed] = useState<AttendanceRecord>();
  const title = checkout ? 'checkout' : 'check-in';
  useFocusEffect(useCallback(() => () => locationRequest.current?.abort(), []));

  async function capture() {
    if (lock.current || pending) return;
    lock.current = true;
    const request = new AbortController();
    locationRequest.current = request;
    setBusy(true);
    setFix(undefined);
    setMessage('');
    try {
      const result = await captureForegroundLocation(limits, undefined, {
        signal: request.signal,
        onProgress: setLocationProgress,
      });
      if (!request.signal.aborted) setFix(result);
    } catch (error) {
      if (!request.signal.aborted)
        setMessage(error instanceof Error ? error.message : 'Could not obtain a location.');
    } finally {
      locationRequest.current = null;
      lock.current = false;
      setLocationProgress('');
      setBusy(false);
    }
  }
  async function submit() {
    if (lock.current || !fix) return;
    if (!pending && !isFreshLocation(Date.parse(fix.capturedAt), limits.maximumAgeSeconds)) {
      setFix(undefined);
      setMessage('This location reading has expired. Retry location before confirming.');
      return;
    }
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
              <Text style={styles.muted}>
                Location captured · Accuracy ±{Math.round(fix.accuracy)} m
              </Text>
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
            <View>
              <ActivityIndicator color={colors.hunter} />
              <Text accessibilityLiveRegion="polite" style={styles.muted}>
                {pending ? 'Submitting attendance' : locationProgress}
              </Text>
            </View>
          )}
          {!pending && (
            <Action
              title={fix ? 'Capture again' : message ? 'Retry location' : 'Capture location'}
              onPress={() => void capture()}
              disabled={busy}
              secondary={!!fix}
            />
          )}
          {!!fix && (
            <Action
              title={pending ? 'Retry submission' : 'Confirm ' + title}
              variant="attendance"
              onPress={() => void submit()}
              disabled={busy}
            />
          )}
          {!fix && /permission|precise|Location Services/i.test(message) && (
            <Action
              title="Open settings"
              onPress={() =>
                void (
                  Platform.OS === 'android' && message.includes('Location Services')
                    ? Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS')
                    : Linking.openSettings()
                ).catch(() => undefined)
              }
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
  page: { flexGrow: 1, gap: 14, padding: 20, backgroundColor: colors.ivory },
  title: { fontSize: 29, fontWeight: '700', color: colors.forest },
  label: { fontSize: 18, fontWeight: '600', color: colors.forest },
  muted: { fontSize: 15, color: colors.muted, lineHeight: 22 },
  card: {
    padding: 17,
    borderRadius: 16,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    gap: 10,
  },
  hero: { padding: 22, borderRadius: 20, backgroundColor: colors.forest, gap: 6 },
  homePage: { gap: 16, paddingHorizontal: 18, paddingBottom: 28 },
  homeHero: { padding: 24, borderRadius: 24 },
  homeHeroMeta: { color: colors.sand, fontSize: 13, fontWeight: '700', letterSpacing: 0.6 },
  homeCard: { gap: 15, padding: 18, borderRadius: 20 },
  shiftHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
  },
  shiftTitle: { color: colors.forest, fontSize: 21, fontWeight: '800' },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: colors.driedGreen,
  },
  statusOnDuty: { backgroundColor: colors.greenWash },
  statusDot: { height: 7, width: 7, borderRadius: 4, backgroundColor: colors.muted },
  statusDotOnDuty: { backgroundColor: colors.hunter },
  statusText: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  statusTextOnDuty: { color: colors.hunter },
  durationPanel: { padding: 14, gap: 2, backgroundColor: colors.greenWash, borderRadius: 14 },
  punches: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  punch: {
    flexGrow: 1,
    flexBasis: '44%',
    minWidth: 115,
    borderTopWidth: 1,
    borderColor: colors.line,
    paddingTop: 10,
    gap: 3,
  },
  timeLabel: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  timeValue: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  heroTitle: { color: colors.white, fontFamily: 'serif', fontSize: 29, fontWeight: '700' },
  heroMeta: { color: colors.sand, fontSize: 15, lineHeight: 22 },
  dashboardLinks: {
    gap: 2,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: colors.line,
    borderWidth: 1,
    borderColor: colors.line,
  },
  dashboardLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 54,
    paddingVertical: 13,
    paddingHorizontal: 16,
    backgroundColor: colors.white,
    gap: 14,
  },
  dashboardLabel: { flexShrink: 1, color: colors.forest, fontSize: 16, fontWeight: '700' },
  chevron: {
    width: 8,
    height: 8,
    borderTopWidth: 2,
    borderRightWidth: 2,
    borderColor: colors.hunter,
    transform: [{ rotate: '45deg' }],
    marginRight: 4,
  },
  dashboardLinkPressed: { backgroundColor: colors.greenWash },
  timer: { fontSize: 34, color: colors.forest, fontVariant: ['tabular-nums'], fontWeight: '700' },
  button: {
    padding: 12,
    minHeight: 48,
    backgroundColor: colors.hunter,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: 'white', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  buttonPressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  secondary: { backgroundColor: colors.greenWash },
  attendanceButton: { backgroundColor: colors.rust },
  homeButton: { backgroundColor: homeColors.red },
  secondaryText: { color: colors.hunter },
  disabled: { backgroundColor: colors.driedGreen },
  disabledText: { color: colors.muted },
  warning: { backgroundColor: colors.warning, padding: 12, borderRadius: 10, gap: 8 },
  error: { color: colors.error, fontSize: 15 },
  input: {
    borderWidth: 1,
    borderColor: colors.fieldBorder,
    borderRadius: 9,
    color: colors.forest,
    padding: 12,
    minHeight: 46,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
});
