import { AppState, NativeModules, Platform } from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import { requestLocationPermission } from './devicePermissions';
import { attendanceLocation, type AttendanceLocation } from '@renuka/shared';

type Limits = {
  preferredAccuracy: number;
  maximumAccuracy: number;
  maximumAgeSeconds: number;
};
type Position = {
  coords: { latitude: number; longitude: number; accuracy: number };
  timestamp: number;
  mocked?: boolean;
  provider?: string;
};
type AndroidLocation = {
  ensureEnabled(): Promise<boolean>;
  capture(id: number, high: boolean, timeout: number, target: number): Promise<Position>;
  cancel(id: number): void;
  cached(): Promise<Position[]>;
  manufacturer: string;
  model: string;
  hasFusedProvider: boolean;
};
type CaptureOptions = {
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
};
const android =
  Platform.OS === 'android'
    ? (NativeModules.RenukaForegroundLocation as AndroidLocation | undefined)
    : undefined;
let nextRequest = 0;
const cancelled = () => new Error('Location capture stopped. Open the screen and try again.');

class LocationError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export function isFreshLocation(timestamp: number, maximumAgeSeconds: number, now = Date.now()) {
  const age = now - timestamp;
  return Number.isFinite(age) && age >= -5000 && age <= maximumAgeSeconds * 1000;
}

function iosPosition(high: boolean, timeout: number, target: number) {
  let watch: number | undefined;
  let best: Position | undefined;
  let timer: ReturnType<typeof setTimeout>;
  const result = new Promise<Position>((resolve, reject) => {
    timer = setTimeout(() => {
      if (best) resolve(best);
      else reject(new LocationError('timeout'));
    }, timeout);
    watch = Geolocation.watchPosition(
      (position) => {
        if (!best || position.coords.accuracy <= best.coords.accuracy) best = position;
        if (position.coords.accuracy <= target) resolve(position);
      },
      (error) => reject(new LocationError(error.code === 1 ? 'permission' : 'provider_failure')),
      {
        enableHighAccuracy: high,
        maximumAge: 0,
        distanceFilter: 0,
        interval: 1000,
      },
    );
  });
  return {
    result,
    cancel: () => {
      clearTimeout(timer);
      if (watch !== undefined) Geolocation.clearWatch(watch);
    },
  };
}

export async function captureForegroundLocation(
  limits: Limits,
  onMocked?: (mocked: boolean) => void,
  { signal, onProgress }: CaptureOptions = {},
): Promise<AttendanceLocation> {
  const checkActive = () => {
    if (signal?.aborted || AppState.currentState !== 'active') throw cancelled();
  };
  if (AppState.currentState !== 'active')
    throw new Error('Keep the app open to capture your location.');
  checkActive();
  onProgress?.('Checking location permission');
  const permission = await requestLocationPermission();
  if (signal?.aborted) throw cancelled();
  if (Platform.OS === 'android' && !android)
    throw new Error('The Android location provider is unavailable in this build.');
  if (android && !(await android.ensureEnabled()))
    throw new Error('Location Services are off. Turn them on and retry location.');
  checkActive();

  const stop = new AbortController();
  const abort = () => stop.abort();
  signal?.addEventListener('abort', abort);
  const foreground = AppState.addEventListener('change', (state) => {
    if (state !== 'active') abort();
  });
  const target = Math.min(limits.preferredAccuracy, limits.maximumAccuracy);
  const maxAge = Math.min(30, limits.maximumAgeSeconds);
  const candidates: Position[] = [];
  let sawInaccurate = false;
  let sawStale = false;
  let lastError = '';
  let retry = 0;

  async function awaitAttempt<T>(result: Promise<T>, timeout: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      return await new Promise<T>((resolve, reject) => {
        onAbort = () => reject(cancelled());
        timer = setTimeout(() => reject(new LocationError('timeout')), timeout);
        if (stop.signal.aborted) onAbort();
        else stop.signal.addEventListener('abort', onAbort);
        void result.then(resolve, reject);
      });
    } finally {
      clearTimeout(timer);
      if (onAbort) stop.signal.removeEventListener('abort', onAbort);
    }
  }

  function select() {
    return candidates
      .flatMap((position) => {
        const date = new Date(position.timestamp);
        if (!Number.isFinite(date.getTime()) || !isFreshLocation(position.timestamp, maxAge)) {
          sawStale = true;
          return [];
        }
        const parsed = attendanceLocation.safeParse({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          capturedAt: date.toISOString(),
        });
        if (!parsed.success || parsed.data.accuracy > limits.maximumAccuracy) {
          sawInaccurate = true;
          return [];
        }
        return [{ location: parsed.data, position }];
      })
      .sort(
        (a, b) =>
          a.location.accuracy - b.location.accuracy || b.position.timestamp - a.position.timestamp,
      )[0];
  }

  function diagnostic(startedAt: number, position?: Position, errorCode?: string) {
    if (typeof __DEV__ !== 'undefined' && __DEV__ && android)
      console.debug('location_capture', {
        androidVersion: Platform.Version,
        manufacturer: android.manufacturer,
        model: android.model,
        permission,
        provider: position?.provider ?? (android.hasFusedProvider ? 'fused' : 'android'),
        durationMs: Date.now() - startedAt,
        retry,
        accuracy: position?.coords.accuracy,
        timestamp: position?.timestamp,
        mocked: position?.mocked,
        errorCode,
      });
  }

  async function attempt(high: boolean, timeout: number) {
    const startedAt = Date.now();
    const id = ++nextRequest;
    const request = android
      ? {
          result: android.capture(id, high, timeout, target),
          cancel: () => android.cancel(id),
        }
      : iosPosition(high, timeout, target);
    try {
      const position = await awaitAttempt(request.result, timeout + 1000);
      candidates.push(position);
      diagnostic(startedAt, position);
    } catch (error) {
      if (stop.signal.aborted) throw cancelled();
      lastError = (error as { code?: string }).code ?? 'provider_failure';
      diagnostic(startedAt, undefined, lastError);
      if (lastError === 'permission')
        throw new Error(
          'Location permission was denied. Allow location while using the app in Settings.',
        );
      if (lastError === 'disabled')
        throw new Error('Location Services are off. Turn them on and retry location.');
    } finally {
      request.cancel();
    }
  }

  try {
    onProgress?.(
      android?.hasFusedProvider === false
        ? 'Trying Android location providers'
        : 'Capturing current location',
    );
    await attempt(false, 15_000);
    let best = select();
    if (!best || best.location.accuracy > target) {
      retry++;
      onProgress?.('Improving location accuracy');
      await attempt(true, 35_000);
      best = select();
    }
    if (!best && android) {
      retry++;
      const startedAt = Date.now();
      onProgress?.('Checking recent location readings');
      try {
        candidates.push(...(await awaitAttempt(android.cached(), 3000)));
      } catch {
        if (stop.signal.aborted) throw cancelled();
      }
      best = select();
      diagnostic(startedAt, best?.position, best ? undefined : 'cache_unavailable');
    }
    checkActive();
    if (best) {
      onMocked?.(best.position.mocked === true);
      return best.location;
    }
    if (permission === 'approximate')
      throw new Error(
        'Approximate location did not meet the required accuracy. Allow precise location and retry.',
      );
    if (sawInaccurate)
      throw new Error(
        'Location accuracy is too low. Try near a window or outdoors and retry location.',
      );
    if (sawStale) throw new Error('The location reading was too old. Retry location.');
    if (lastError === 'play_services_unavailable')
      throw new Error(
        'Google Play Services and Android’s alternative location providers are unavailable. Retry location.',
      );
    if (lastError === 'network_unavailable' || lastError === 'provider_failure')
      throw new Error('The phone’s location providers could not obtain a reading. Retry location.');
    throw new Error(
      'Location timed out after two attempts. Retry location from an area with better signal.',
    );
  } finally {
    foreground.remove();
    signal?.removeEventListener('abort', abort);
  }
}
