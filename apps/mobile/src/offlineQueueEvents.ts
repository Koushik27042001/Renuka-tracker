const listeners = new Set<() => void>();
export function onOfflineQueueChanged(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function notifyOfflineQueueChanged() {
  listeners.forEach((listener) => listener());
}
