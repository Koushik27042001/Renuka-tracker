import { AppState } from 'react-native';
import type { Visit } from '@renuka/shared';
import { authenticated, MobileApiError } from './api';
import {
  offlineDrafts,
  saveOfflineDraft,
  withOfflineCapture,
  type OfflineDraft,
} from './offlineStore';

export async function syncOfflineDrafts(
  owner: string,
  signal: AbortSignal,
  force = false,
  maxAttempts = 8,
) {
  const active = () => !signal.aborted && AppState.currentState === 'active';
  for (let draft of await offlineDrafts(owner)) {
    if (!active()) break;
    if (
      draft.uploaded ||
      (draft.problem && !draft.retryAt && !(force && draft.manuallyRetryable)) ||
      (!force && (draft.retryAt ?? 0) > Date.now())
    )
      continue;
    try {
      if (!draft.serverId) {
        const { visit } = await authenticated<{ visit: Visit }>('/visits', {
          owner,
          signal,
          body: {
            ...draft.input,
            key: draft.id,
            offline: { attendanceId: draft.attendanceId, capturedAt: draft.capturedAt },
          },
        });
        draft = { ...draft, serverId: visit.id };
        await saveOfflineDraft(owner, draft);
      }
      if (!active()) break;
      await withOfflineCapture(owner, draft, (uri) => {
        if (!active()) throw new MobileApiError(0, 'Sync paused.');
        const form = new FormData();
        form.append(
          'metadata',
          JSON.stringify({ ...draft.metadata, originalSha256: draft.checksum }),
        );
        form.append('image', { uri, type: draft.imageType, name: 'selfie.jpg' } as unknown as Blob);
        return authenticated('/visits/' + draft.serverId + '/evidence', {
          owner,
          signal,
          method: 'POST',
          form,
        });
      });
      await saveOfflineDraft(owner, {
        ...draft,
        uploaded: true,
        uploadedAt: Date.now(),
        manuallyRetryable: undefined,
        attempts: 0,
        problem: undefined,
        retryAt: undefined,
      });
    } catch (error) {
      if (!active() || (error instanceof MobileApiError && error.status === 401)) break;
      const failed = draft.attempts ?? 0;
      const retryable =
        error instanceof MobileApiError &&
        (error.status === 0 || error.status === 429 || error.status >= 500);
      const delay = Math.min(300_000, 3000 * 2 ** Math.min(failed, 7));
      const retryAfter = error instanceof MobileApiError ? (error.retryAfterMs ?? 0) : 0;
      const next: OfflineDraft = {
        ...draft,
        attempts: failed + 1,
        manuallyRetryable: retryable,
        retryAt:
          retryable && failed + 1 < maxAttempts
            ? Date.now() + Math.max(delay, retryAfter) + Math.floor(Math.random() * delay * 0.25)
            : undefined,
        problem: error instanceof Error ? error.message : 'Sync failed.',
      };
      await saveOfflineDraft(owner, next);
      if (retryable) break;
    }
  }
}
