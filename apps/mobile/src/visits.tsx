import { useEffect, useRef, useState } from 'react';
import { colors } from './theme';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';
import { captureVisitPhoto, cleanCapture, type Capture } from './cameraEvidence';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  visitInput,
  type Visit,
  type VisitInput,
  type VisitPage,
  type VisitStatus,
} from '@renuka/shared';
import { authenticated, MobileApiError, mobileAttendance } from './api';
import { Action, Problem, styles, type AttendanceStack } from './attendanceScreens';
import { uniqueId } from './requestId';

const states: Record<VisitStatus, string> = {
  DRAFT: 'Draft',
  PENDING_REVIEW: 'Pending review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};
const blank: VisitInput = {
  visitDate: '',
  clientName: '',
  purpose: '',
  contactName: '',
  contactPhone: '',
  remarks: '',
  notes: '',
};
const detail = (id: string, signal?: AbortSignal) =>
  authenticated<{ visit: Visit }>('/visits/' + id, { signal }).then((result) => result.visit);
async function viewEvidence(id: string, signal?: AbortSignal): Promise<string> {
  const result = await authenticated<Response>('/evidence/' + id + '/view', {
    binary: true,
    signal,
  });
  const blob = await result.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Image could not be read.'));
    reader.onerror = () => reject(new Error('Image could not be read.'));
    reader.readAsDataURL(blob);
  });
}
export function EvidenceImage({
  evidence,
  onLoaded,
}: {
  evidence: Pick<NonNullable<Visit['evidence']>, 'id' | 'width' | 'height'>;
  onLoaded?: () => void;
}) {
  const { id, width, height } = evidence;
  const [decodeFailed, setDecodeFailed] = useState(false);
  const image = useQuery({
    queryKey: ['evidence', id],
    queryFn: ({ signal }) => viewEvidence(id, signal),
    gcTime: 0,
  });
  if (image.error)
    return <Problem message={image.error.message} retry={() => void image.refetch()} />;
  if (decodeFailed)
    return (
      <Problem
        message="Could not display the visit photo."
        retry={() => {
          setDecodeFailed(false);
          void image.refetch();
        }}
      />
    );
  if (!image.data) return <ActivityIndicator accessibilityLabel="Loading private evidence" />;
  return (
    <Image
      onLoad={onLoaded}
      onError={() => setDecodeFailed(true)}
      source={{ uri: image.data, cache: 'reload' }}
      resizeMode="contain"
      style={[visitStyles.photo, { aspectRatio: width > 0 && height > 0 ? width / height : 1 }]}
      accessibilityLabel="Watermarked visit photo"
    />
  );
}
const fields = [
  ['clientName', 'Client or place', 'Enter a client or site name', 120, false],
  ['purpose', 'Visit purpose', 'Example: Stock check or client meeting', 240, true],
  ['contactName', 'Contact name (optional)', 'Enter the contact’s name', 120, false],
  ['contactPhone', 'Contact phone (optional)', 'Enter a phone number', 25, false],
  ['remarks', 'Remarks (optional)', 'Summarize the outcome', 500, true],
  ['notes', 'Additional notes (optional)', 'Add any follow-up details', 1000, true],
] as const;

function VisitField({ label, multiline, ...props }: TextInputProps & { label: string }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={visitStyles.field}>
      <Text style={visitStyles.fieldLabel}>{label}</Text>
      <TextInput
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        multiline={multiline}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          visitStyles.input,
          multiline && visitStyles.multiline,
          focused && visitStyles.focused,
        ]}
      />
    </View>
  );
}
function editable(row?: Visit): VisitInput {
  if (!row) return blank;
  return {
    visitDate: row.visitDate,
    clientName: row.clientName,
    purpose: row.purpose,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    remarks: row.remarks,
    notes: row.notes,
  };
}

export function VisitHistory({ navigation }: NativeStackScreenProps<AttendanceStack, 'Visits'>) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState<VisitStatus>();
  const [filters, setFilters] = useState('');
  const [error, setError] = useState('');
  const list = useQuery({
    queryKey: ['visits', page, filters],
    queryFn: ({ signal }) =>
      authenticated<VisitPage>('/visits/me?page=' + page + filters, { signal }),
  });
  function apply() {
    const datesValid = [from, to].every(
      (value) =>
        !value ||
        (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
          Number.isFinite(Date.parse(value)) &&
          new Date(value).toISOString().slice(0, 10) === value),
    );
    if (!datesValid || (from && to && from > to)) {
      setError('Use a valid YYYY-MM-DD date range.');
      return;
    }
    setError('');
    const parts = [
      ['search', search.trim()],
      ['from', from],
      ['to', to],
      ['status', status],
    ];
    setFilters(
      parts
        .filter(([, v]) => !!v)
        .map(([k, v]) => '&' + k + '=' + encodeURIComponent(v!))
        .join(''),
    );
    setPage(1);
  }
  return (
    <ScrollView
      contentContainerStyle={visitStyles.page}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      automaticallyAdjustKeyboardInsets
      refreshControl={
        <RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} />
      }
    >
      <Action title="New field visit" onPress={() => navigation.navigate('VisitDraft', {})} />
      <View style={styles.card}>
        <Text style={styles.label}>Filter visits</Text>
        <VisitField
          label="Search by client"
          placeholder="Client or place"
          value={search}
          onChangeText={setSearch}
          maxLength={80}
        />
        <VisitField
          label="From date"
          placeholder="YYYY-MM-DD"
          value={from}
          onChangeText={setFrom}
        />
        <VisitField label="To date" placeholder="YYYY-MM-DD" value={to} onChangeText={setTo} />
        <Action
          title={status ? 'Status: ' + states[status] : 'Status: All'}
          onPress={() => {
            const values = Object.keys(states) as VisitStatus[];
            setStatus(status ? values[values.indexOf(status) + 1] : values[0]);
          }}
          secondary
        />
        {error && <Problem message={error} />}
        <Action title="Apply filters" onPress={apply} secondary />
      </View>
      {list.error ? (
        <Problem message={list.error.message} retry={() => void list.refetch()} />
      ) : list.isPending ? (
        <ActivityIndicator accessibilityLabel="Loading visits" />
      ) : list.data.visits.length === 0 ? (
        <Text style={styles.muted}>No visits match these filters.</Text>
      ) : (
        list.data.visits.map((row) => (
          <View key={row.id} style={styles.card}>
            <Text style={styles.label}>{row.clientName}</Text>
            <Text style={styles.muted}>
              {row.code} · {row.visitDate}
            </Text>
            <Text style={styles.muted}>
              {states[row.status]}
              {row.submittedAt && ' · ' + new Date(row.submittedAt).toLocaleString()}
            </Text>
            <Action
              title={row.status === 'DRAFT' ? 'Open draft' : 'View visit'}
              secondary
              onPress={() =>
                row.status === 'DRAFT'
                  ? navigation.navigate('VisitDraft', { id: row.id })
                  : navigation.navigate('VisitDetail', { id: row.id })
              }
            />
          </View>
        ))
      )}
      <View style={styles.row}>
        <Action
          title="Previous"
          onPress={() => setPage(page - 1)}
          disabled={page === 1 || list.isFetching}
          secondary
        />
        <Text style={styles.muted}>Page {page}</Text>
        <Action
          title="Next"
          onPress={() => setPage(page + 1)}
          disabled={!list.data || page * list.data.limit >= list.data.total || list.isFetching}
          secondary
        />
      </View>
    </ScrollView>
  );
}
export function VisitDraft({
  route,
  navigation,
}: NativeStackScreenProps<AttendanceStack, 'VisitDraft'>) {
  const id = route.params.id;
  const query = useQueryClient();
  const shift = useQuery({
    queryKey: ['attendance', 'current'],
    queryFn: ({ signal }) => mobileAttendance.current(signal),
  });
  const existing = useQuery({
    queryKey: ['visit', id],
    queryFn: ({ signal }) => detail(id!, signal),
    enabled: !!id,
  });
  const row = existing.data;
  const [form, setForm] = useState(blank);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const key = useRef<string | undefined>(undefined);
  const submitAttempt = useRef(false);
  const gate = useRef(false);
  useEffect(() => {
    if (row) setForm(editable(row));
  }, [row]);
  async function act(work: () => Promise<void>) {
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
      await query.invalidateQueries({ queryKey: ['visits'] });
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Visit request failed.');
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  async function save() {
    const validated = visitInput.safeParse({
      ...form,
      visitDate: row?.visitDate ?? shift.data?.attendanceDate,
    });
    if (!validated.success) {
      setError('Enter a client or place, visit purpose, and a valid optional contact phone.');
      return;
    }
    await act(async () => {
      if (!key.current) key.current = uniqueId();
      const updated = await authenticated<{ visit: Visit }>(id ? '/visits/' + id : '/visits', {
        method: id ? 'PATCH' : 'POST',
        body: id ? validated.data : { ...validated.data, key: key.current },
      });
      if (!id) navigation.replace('VisitDraft', { id: updated.visit.id });
      else query.setQueryData(['visit', id], updated.visit);
    });
  }
  async function openVisitPhoto() {
    if (!row || !shift.data) return;
    const validated = visitInput.safeParse({ ...form, visitDate: row.visitDate });
    if (!validated.success) {
      setError('Check the visit details before adding a photo.');
      return;
    }
    const limits = shift.data.limits;
    await act(async () => {
      const result = await authenticated<{ visit: Visit }>('/visits/' + row.id, {
        method: 'PATCH',
        body: validated.data,
      });
      query.setQueryData(['visit', row.id], result.visit);
      navigation.navigate('VisitCamera', { id: row.id, limits });
    });
  }
  async function submit() {
    if (!row) return;
    const validated = visitInput.safeParse({ ...form, visitDate: row.visitDate });
    if (!validated.success) {
      setError('Check the visit details before submitting.');
      return;
    }
    await act(async () => {
      if (!submitAttempt.current) {
        await authenticated('/visits/' + row.id, { method: 'PATCH', body: validated.data });
        submitAttempt.current = true;
      }
      await authenticated('/visits/' + row.id + '/submit', { method: 'POST', body: {} });
      await query.invalidateQueries({ queryKey: ['visit', row.id] });
      navigation.replace('VisitDetail', { id: row.id });
    });
  }
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={visitStyles.page}
    >
      {existing.error ? (
        <Problem message={existing.error.message} retry={() => void existing.refetch()} />
      ) : id && !row ? (
        <ActivityIndicator />
      ) : (
        <>
          <View style={styles.hero}>
            <Text accessibilityRole="header" style={styles.heroTitle}>
              {row?.code ?? 'New field visit'}
            </Text>
            <Text style={styles.heroMeta}>
              Business date {row?.visitDate ?? shift.data?.attendanceDate ?? '—'}
            </Text>
          </View>
          {shift.error && (
            <Problem message={shift.error.message} retry={() => void shift.refetch()} />
          )}
          {shift.data?.attendance?.status !== 'CHECKED_IN' && (
            <Text style={styles.muted}>Check in before capturing or submitting a visit.</Text>
          )}
          <View style={visitStyles.section}>
            <Text accessibilityRole="header" style={styles.label}>
              Visit details
            </Text>
            {fields.map(([name, label, placeholder, maxLength, multiline]) => (
              <VisitField
                key={name}
                label={label}
                placeholder={placeholder}
                maxLength={maxLength}
                multiline={multiline}
                value={form[name] ?? ''}
                editable={!busy}
                keyboardType={name === 'contactPhone' ? 'phone-pad' : 'default'}
                onChangeText={(value) => setForm((old) => ({ ...old, [name]: value }))}
              />
            ))}
            {error && <Problem message={error} />}
            <Action
              title={busy ? 'Saving…' : id ? 'Save draft changes' : 'Save draft'}
              disabled={busy || (!id && shift.data?.attendance?.status !== 'CHECKED_IN')}
              onPress={() => void save()}
            />
          </View>
          <View style={visitStyles.section}>
            <Text accessibilityRole="header" style={styles.label}>
              Visit photo
            </Text>
            {row?.evidence ? (
              <EvidenceImage key={row.evidence.id} evidence={row.evidence} />
            ) : (
              <Text style={styles.muted}>
                {row
                  ? 'Add a GPS selfie before submitting this visit.'
                  : 'Save the draft to enable the camera.'}
              </Text>
            )}
            <Action
              title={row?.evidence ? 'Preview or replace photo' : 'Add visit photo'}
              disabled={busy || !row || !shift.data}
              onPress={() => void openVisitPhoto()}
              secondary
            />
          </View>
          {row && (
            <>
              <Action
                title="Submit visit"
                disabled={busy || !row.evidence || shift.data?.attendance?.status !== 'CHECKED_IN'}
                onPress={() => void submit()}
              />
              <Action
                title="Discard draft"
                disabled={busy}
                onPress={() =>
                  Alert.alert('Discard this draft?', 'Stored draft evidence will be removed.', [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Discard',
                      style: 'destructive',
                      onPress: () =>
                        void act(async () => {
                          await authenticated('/visits/' + row.id, { method: 'DELETE' });
                          navigation.goBack();
                        }),
                    },
                  ])
                }
                secondary
              />
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}
export function VisitCamera({
  route,
  navigation,
}: NativeStackScreenProps<AttendanceStack, 'VisitCamera'>) {
  const { id, limits } = route.params;
  const query = useQueryClient();
  const existing = useQuery({
    queryKey: ['visit', id],
    queryFn: ({ signal }) => detail(id, signal),
  });
  const [capture, setCapture] = useState<Capture>();
  const current = useRef<Capture | undefined>(undefined);
  const lock = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(
    () => () => {
      mounted.current = false;
      cleanCapture(current.current?.uri);
    },
    [],
  );
  async function act(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (problem) {
      if (mounted.current)
        setError(problem instanceof Error ? problem.message : 'Camera operation failed.');
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function take() {
    await act(async () => {
      const photo = await captureVisitPhoto(limits, () => mounted.current);
      if (!photo) return;
      cleanCapture(current.current?.uri);
      current.current = photo;
      setCapture(photo);
    });
  }
  async function upload() {
    if (!capture) return;
    await act(async () => {
      const form = new FormData();
      form.append('metadata', JSON.stringify(capture.metadata));
      form.append('image', {
        uri: capture.uri,
        type: capture.type,
        name: capture.type === 'image/png' ? 'visit-photo.png' : 'visit-photo.jpg',
      } as unknown as Blob);
      try {
        const result = await authenticated<{ visit: Visit }>('/visits/' + id + '/evidence', {
          method: 'POST',
          form,
        });
        query.setQueryData(['visit', id], result.visit);
        cleanCapture(capture.uri);
        current.current = undefined;
        setCapture(undefined);
      } catch (problem) {
        if (problem instanceof MobileApiError && problem.status === 422) {
          cleanCapture(capture.uri);
          current.current = undefined;
          setCapture(undefined);
        }
        throw problem;
      }
    });
  }
  const evidence = existing.data?.evidence;
  return (
    <ScrollView contentContainerStyle={visitStyles.page}>
      <View style={styles.hero}>
        <Text accessibilityRole="header" style={styles.heroTitle}>
          {evidence ? 'Review your photo' : capture ? 'Preview your selfie' : 'Take a GPS selfie'}
        </Text>
        <Text style={styles.heroMeta}>
          {evidence
            ? 'Review the watermark before you use this photo.'
            : capture
              ? 'Upload the selfie to preview its GPS watermark, or retake it.'
              : 'Your current location is added to the photo watermark. If address lookup is enabled, your coordinates are sent to the address service.'}
        </Text>
      </View>
      {existing.error && (
        <Problem message={existing.error.message} retry={() => void existing.refetch()} />
      )}
      {error && <Problem message={error} />}
      {(busy || existing.isPending) && (
        <View style={visitStyles.progress}>
          <ActivityIndicator color={colors.hunter} />
          <Text accessibilityLiveRegion="polite" style={styles.muted}>
            {existing.isPending ? 'Loading visit photo…' : 'Working on visit photo…'}
          </Text>
        </View>
      )}
      {evidence ? (
        <View style={visitStyles.section}>
          <EvidenceImage key={evidence.id} evidence={evidence} />
          {evidence.source === 'gallery' && <Text style={styles.muted}>Gallery upload</Text>}
          <View style={visitStyles.address}>
            <Text style={styles.label}>
              {evidence.accuracy > 50 ? 'Approximate area' : 'Mapped address'}
            </Text>
            <Text style={styles.muted}>{evidence.address ?? 'Address unavailable'}</Text>
            <Text style={styles.muted}>GPS accuracy ±{Math.round(evidence.accuracy)} m</Text>
          </View>
          <Action title="Use this photo" disabled={busy} onPress={() => navigation.goBack()} />
          <Action
            title="Remove and replace photo"
            disabled={busy}
            onPress={() =>
              void act(async () => {
                await authenticated('/visits/' + id + '/evidence', {
                  method: 'DELETE',
                });
                await existing.refetch();
              })
            }
            secondary
          />
        </View>
      ) : (
        <View style={visitStyles.section}>
          {capture && (
            <Image
              source={{ uri: capture.uri }}
              resizeMode="contain"
              style={[visitStyles.photo, visitStyles.capturePreview]}
              accessibilityLabel="Captured selfie"
            />
          )}
          {!!capture && (
            <Action
              title="Upload and preview photo"
              disabled={busy}
              onPress={() => void upload()}
            />
          )}
          <Action
            title={capture ? 'Retake selfie' : 'Take selfie'}
            disabled={busy || !existing.data}
            onPress={() => void take()}
            secondary={!!capture}
          />
          {error && (
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

export function VisitDetail({ route }: NativeStackScreenProps<AttendanceStack, 'VisitDetail'>) {
  const result = useQuery({
    queryKey: ['visit', route.params.id],
    queryFn: ({ signal }) => detail(route.params.id, signal),
  });
  const row = result.data;
  return (
    <ScrollView
      contentContainerStyle={visitStyles.page}
      refreshControl={
        <RefreshControl refreshing={result.isRefetching} onRefresh={() => void result.refetch()} />
      }
    >
      {result.error ? (
        <Problem message={result.error.message} retry={() => void result.refetch()} />
      ) : !row ? (
        <ActivityIndicator />
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.title}>{row.clientName}</Text>
            <Text style={styles.muted}>
              {row.code} · {row.visitDate}
            </Text>
            <Text style={styles.label}>{states[row.status]}</Text>
            <Text style={styles.muted}>{row.purpose}</Text>
            {row.submittedAt && (
              <Text style={styles.muted}>
                Submitted {new Date(row.submittedAt).toLocaleString()}
              </Text>
            )}
            {row.reason && <Text style={styles.muted}>Review reason: {row.reason}</Text>}
            {row.remarks && <Text style={styles.muted}>{row.remarks}</Text>}
            {row.notes && <Text style={styles.muted}>{row.notes}</Text>}
          </View>
          {row.evidence && (
            <View style={styles.card}>
              <EvidenceImage key={row.evidence.id} evidence={row.evidence} />
              <Text style={styles.muted}>{row.evidence.address ?? 'Address unavailable'}</Text>
              <Text style={styles.muted}>
                {row.evidence.latitude.toFixed(6)}, {row.evidence.longitude.toFixed(6)} · ±
                {Math.round(row.evidence.accuracy)} m
              </Text>
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const visitStyles = StyleSheet.create({
  page: {
    ...styles.page,
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingBottom: 28,
  },
  section: {
    gap: 16,
    padding: 16,
    borderRadius: 18,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.driedGreen,
  },
  field: { gap: 6 },
  fieldLabel: { color: colors.ink, fontSize: 15, lineHeight: 22, fontWeight: '600' },
  input: {
    minHeight: 52,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: colors.forest,
    backgroundColor: colors.white,
    fontSize: 16,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.fieldBorder,
    textAlignVertical: 'center',
  },
  multiline: { minHeight: 92, textAlignVertical: 'top' },
  focused: { borderColor: colors.hunter, backgroundColor: colors.white },
  photo: {
    width: '100%',
    alignSelf: 'center',
    backgroundColor: colors.forest,
    borderRadius: 12,
  },
  capturePreview: { aspectRatio: 4 / 5, maxWidth: 360 },
  address: { backgroundColor: colors.ivory, borderRadius: 12, padding: 14, gap: 6 },
  progress: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
});
