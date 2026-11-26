import { AppState } from 'react-native';
import { HEALTH_PATH } from '@renuka/shared';
import { apiUrl } from '../config';

type Listener = (reachable: boolean) => void;
const listeners = new Set<Listener>();
let reachable: boolean | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let request: AbortController | undefined;
let lifecycle: ReturnType<typeof AppState.addEventListener> | undefined;
let failures = 0;

function stopProbe() {
  clearTimeout(timer);
  request?.abort();
  request = undefined;
}

function publish(value: boolean) {
  if (reachable === value) return;
  reachable = value;
  listeners.forEach((listener) => listener(value));
}

async function probe() {
  if (AppState.currentState !== 'active' || !listeners.size || request) return;
  clearTimeout(timer);
  if (!apiUrl) {
    publish(false);
    return;
  }
  const controller = new AbortController();
  request = controller;
  let online = false;
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(apiUrl + HEALTH_PATH, {
      signal: controller.signal,
      credentials: 'omit',
    });
    const health = response.ok ? await response.json() : null;
    online = health?.status === 'ok' && health?.service === 'renuka-api';
  } catch {
    // Request errors are reported as unavailable to the foreground sync queue.
  } finally {
    clearTimeout(timeout);
    if (request === controller) {
      request = undefined;
      if (online && !controller.signal.aborted) {
        failures = 0;
        publish(true);
      } else if (++failures >= 2 || reachable === undefined) {
        publish(false);
      }
      if (listeners.size && AppState.currentState === 'active' && !request)
        timer = setTimeout(() => void probe(), 15_000 + Math.floor(Math.random() * 3000));
    }
  }
}

export function subscribeApiReachability(listener: Listener) {
  listeners.add(listener);
  if (reachable !== undefined) listener(reachable);
  if (!lifecycle) {
    lifecycle = AppState.addEventListener('change', (state) => {
      if (state === 'active') void probe();
      else {
        stopProbe();
        reachable = undefined;
      }
    });
    void probe();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      stopProbe();
      lifecycle?.remove();
      lifecycle = undefined;
      reachable = undefined;
      failures = 0;
    }
  };
}
