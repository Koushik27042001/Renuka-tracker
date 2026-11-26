import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Image, ScrollView, Text, TextInput, View } from 'react-native';
import { subscribeApiReachability } from './apiReachability';
import type { CurrentAttendance, Visit } from '@renuka/shared';
import { visitInput } from '@renuka/shared';
import { Action, Problem, styles } from './attendanceScreens';
import { authenticated, mobileAttendance } from './api';
import { captureVisitPhoto, cleanCapture } from './cameraEvidence';
import {
  cacheOfflineShift,
  clearInterruptedUploads,
  deleteOfflineDraft,
  offlineDrafts,
  readOfflineShift,
  readOfflineImage,
  saveOfflineCapture,
  type OfflineDraft,
} from './offlineStore';
import { syncOfflineDrafts } from './offlineSync';
import { EvidenceImage } from './visits';
import { notifyOfflineQueueChanged, onOfflineQueueChanged } from './offlineQueueEvents';
import { uniqueId } from './requestId';

let syncFlight: Promise<void> | undefined;
let destructiveAction = false;
let retryLimit = 8;
async function run(owner: string, signal: AbortSignal, force = false) {
  if (destructiveAction) return;
  if (!syncFlight) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal.aborted || AppState.currentState !== 'active') abort();
    signal.addEventListener('abort', abort);
    const lifecycle = AppState.addEventListener('change', (state) => {
      if (state !== 'active') abort();
    });
    syncFlight = syncOfflineDrafts(owner, controller.signal, force, retryLimit).finally(() => {
      signal.removeEventListener('abort', abort);
      lifecycle.remove();
      syncFlight = undefined;
      notifyOfflineQueueChanged();
    });
    notifyOfflineQueueChanged();
  }
  await syncFlight;
}
export function useForegroundVisitSync(owner?: string, maxAttempts?: number) {
  useEffect(() => {
    retryLimit = maxAttempts ?? 8;
  }, [maxAttempts]);
  useEffect(() => {
    if (!owner) return;
    let online = false;
    let controller = new AbortController();
    const cleanup = clearInterruptedUploads().catch(() => undefined);
    const tick = () => {
      if (!online || AppState.currentState !== 'active') return;
      const { signal } = controller;
      void cleanup.then(() => {
        if (!signal.aborted && online) return run(owner, signal);
      }).catch(() => undefined);
    };
    const subscription = subscribeApiReachability((reachable) => {
      online = reachable;
      if (online) tick();
    });
    const lifecycle = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        online = false;
        controller.abort();
      } else if (controller.signal.aborted) controller = new AbortController();
    });
    const timer = setInterval(tick, 15_000);
    return () => {
      controller.abort();
      subscription();
      lifecycle.remove();
      clearInterval(timer);
    };
  }, [owner]);
}

export function OfflineQueue({
  owner,
  detail,
  enableCapture,
}: {
  owner: string;
  enableCapture: boolean;
  detail: (id: string) => void;
}) {
  const [drafts, setDrafts] = useState<OfflineDraft[]>([]);
  const [online, setOnline] = useState(false);
  const [shift, setShift] = useState<CurrentAttendance>();
  const [form, setForm] = useState({ clientName: '', purpose: '', description: '' });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  const [preview, setPreview] = useState<{ localId: string; visit: Visit }>();
  const [localPreview, setLocalPreview] = useState<{ id: string; uri: string }>();
  const [loaded, setLoaded] = useState(false);
  const gate = useRef(false);
  const lifetime = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    const refresh = () =>
      void offlineDrafts(owner)
        .then((rows) => {
          if (!controller.signal.aborted) setDrafts(rows);
        })
        .catch(() => setProblem('The encrypted local queue could not be opened.'));
    const unsubscribe = subscribeApiReachability((connected) => {
      setOnline(connected);
      if (connected)
        void mobileAttendance
          .current(controller.signal)
          .then((value) => {
            if (!controller.signal.aborted) setShift(value);
            return cacheOfflineShift(owner, value);
          })
          .catch(() => undefined);
    });
    void readOfflineShift(owner)
      .then((value) => {
        if (!controller.signal.aborted) setShift((latest) => latest ?? value);
      })
      .catch(() => undefined);
    const unsubscribeChanges = onOfflineQueueChanged(refresh);
    refresh();
    return () => {
      controller.abort();
      unsubscribe();
      unsubscribeChanges();
    };
  }, [owner]);
  async function act(work: () => Promise<void>) {
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    setProblem('');
    try {
      await work();
      notifyOfflineQueueChanged();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'The queue operation failed.');
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  async function capture() {
    if (drafts.length >= 30)
      throw new Error(
        'The device queue is full. Sync or discard old drafts before capturing more.',
      );
    const attendance = shift?.attendance;
    if (!shift || attendance?.status !== 'CHECKED_IN')
      throw new Error('Check in online before saving an offline visit.');
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: attendance.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const day = (timestamp: Date) => {
      const fields = Object.fromEntries(
        formatter.formatToParts(timestamp).map((part) => [part.type, part.value]),
      );
      return [fields.year, fields.month, fields.day].join('-');
    };
    const parsed = visitInput.safeParse({
      clientName: form.clientName.trim(),
      purpose: form.purpose,
      notes: form.description,
      visitDate: day(new Date()),
    });
    if (!parsed.success) throw new Error('Enter a client or place and a valid visit purpose.');
    const signal = lifetime.current.signal;
    const photo = await captureVisitPhoto(shift.limits, () => !signal.aborted, signal);
    if (!photo) return;
    try {
      const capturedAt = (photo.metadata as { capturedAt: string }).capturedAt;
      const input = { ...parsed.data, visitDate: day(new Date(capturedAt)) };
      await saveOfflineCapture(
        owner,
        {
          id: uniqueId(),
          input,
          attendanceId: attendance.id,
          capturedAt,
          metadata: photo.metadata,
          imageType: photo.type,
        },
        photo.uri,
      );
      setForm({ clientName: '', purpose: '', description: '' });
    } finally {
      cleanCapture(photo.uri);
    }
  }
  async function remove(row: OfflineDraft) {
    destructiveAction = true;
    try {
      await syncFlight;
      const current = (await offlineDrafts(owner)).find((draft) => draft.id === row.id);
      if (!current) return;
      setLocalPreview(undefined);
      await discard(current);
    } finally {
      destructiveAction = false;
    }
  }
  async function discard(row: OfflineDraft) {
    const serverId = row.serverId;
    if (serverId) {
      if (!online) throw new Error('Reconnect to discard the corresponding server draft.');
      await authenticated('/visits/' + serverId, {
        owner,
        method: 'DELETE',
        signal: lifetime.current.signal,
      });
    }
    await deleteOfflineDraft(owner, row.id);
    setPreview(undefined);
  }
  async function submit(row: OfflineDraft) {
    const id = row.serverId;
    if (!id || preview?.localId !== row.id) return;
    await authenticated('/visits/' + id + '/submit', {
      owner,
      body: {},
      signal: lifetime.current.signal,
    });
    await deleteOfflineDraft(owner, row.id);
    detail(id);
  }
  async function sync() {
    await run(owner, lifetime.current.signal, true);
  }
  const lastUpload = Math.max(0, ...drafts.map((draft) => draft.uploadedAt ?? 0));
  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Visit sync queue</Text>
      <Text style={styles.muted}>
        {online ? 'Connected' : 'Renuka server unavailable. Attendance requires a connection.'}
      </Text>
      <Text style={styles.label}>{drafts.filter((row) => !row.uploaded).length} pending sync</Text>
      {syncFlight && (
        <Text style={styles.muted} accessibilityLiveRegion="polite">
          Syncing queued visits…
        </Text>
      )}
      {lastUpload > 0 && (
        <Text style={styles.muted}>
          Last successful upload {new Date(lastUpload).toLocaleTimeString()}
        </Text>
      )}
      <Text style={styles.muted}>
        Evidence stays on this device until you preview the server copy and submit the visit. Keep
        the app open while syncing.
      </Text>
      {problem && <Problem message={problem} />}
      <Action
        title={busy ? 'Working…' : 'Sync now'}
        disabled={!online || busy}
        onPress={() => void act(sync)}
      />
      {enableCapture && (
        <View style={styles.card}>
          <Text style={styles.label}>Save a field visit</Text>
          {(['clientName', 'purpose', 'description'] as const).map((field, index) => {
            const label = ['Client or place', 'Purpose', 'Description'][index];
            return (
              <TextInput
                key={field}
                style={styles.input}
                placeholder={label}
                accessibilityLabel={label}
                value={form[field]}
                maxLength={field === 'description' ? 500 : 120}
                onChangeText={(value) => setForm((previous) => ({ ...previous, [field]: value }))}
              />
            );
          })}
          <Action
            title="Capture and save on device"
            disabled={busy || !form.clientName.trim() || !form.purpose.trim()}
            onPress={() => void act(capture)}
          />
        </View>
      )}
      {drafts.map((row) => (
        <View style={styles.card} key={row.id}>
          <Text style={styles.label}>{row.input.clientName}</Text>
          <Text style={styles.muted}>
            {row.uploaded
              ? 'Uploaded · awaiting preview and submission'
              : row.problem
                ? 'Sync needs attention'
                : 'Saved locally · queued'}
          </Text>
          {row.problem && <Problem message={row.problem} />}
          {row.manuallyRetryable && !row.uploaded && (
            <Action
              title="Retry sync"
              secondary
              disabled={!online || busy}
              onPress={() =>
                void act(async () => {
                  await sync();
                })
              }
            />
          )}
          {!row.uploaded && (
            <Action
              title={localPreview?.id === row.id ? 'Hide saved selfie' : 'Preview saved selfie'}
              secondary
              disabled={busy}
              onPress={() =>
                void act(async () => {
                  if (localPreview?.id === row.id) {
                    setLocalPreview(undefined);
                    return;
                  }
                  const encoded = await readOfflineImage(owner, row);
                  setLocalPreview({
                    id: row.id,
                    uri: 'data:' + row.imageType + ';base64,' + encoded,
                  });
                })
              }
            />
          )}
          {!row.uploaded && localPreview?.id === row.id && (
            <>
              <Text style={styles.muted}>
                Saved on this device. Server verification is pending.
              </Text>
              <Image
                source={{ uri: localPreview.uri }}
                resizeMode="contain"
                style={{ width: '100%', height: 280 }}
                accessibilityLabel="Locally saved selfie evidence"
              />
            </>
          )}
          {row.uploaded && (
            <Action
              title="Preview uploaded evidence"
              secondary
              disabled={!online || busy}
              onPress={() =>
                void act(async () => {
                  const result = await authenticated<{ visit: Visit }>('/visits/' + row.serverId, {
                    owner,
                    signal: lifetime.current.signal,
                  });
                  setLoaded(false);
                  setPreview({ localId: row.id, visit: result.visit });
                })
              }
            />
          )}
          {preview?.localId === row.id && preview.visit.evidence && (
            <>
              <EvidenceImage
                key={preview.visit.evidence.id}
                evidence={preview.visit.evidence}
                onLoaded={() => setLoaded(true)}
              />
              <Action
                title="Submit visit"
                disabled={!online || busy || !loaded}
                onPress={() => void act(() => submit(row))}
              />
            </>
          )}
          <Action
            title="Discard draft"
            secondary
            disabled={busy}
            onPress={() =>
              Alert.alert('Discard draft?', 'This removes the saved selfie and draft.', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Discard',
                  style: 'destructive',
                  onPress: () => void act(() => remove(row)),
                },
              ])
            }
          />
        </View>
      ))}
    </ScrollView>
  );
}
