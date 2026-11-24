import type { Config } from '../config.js';
type Address = { address: string | null; provider: string | null };
export function reverseGeocoder(config: Config) {
  const cache = new Map<string, { result: Address; until: number }>();
  let next = 0;
  return async (latitude: number, longitude: number, accuracy: number): Promise<Address> => {
    const unavailable = { address: null, provider: null };
    if (!config.GEOCODING_REVERSE_URL || !config.GEOCODING_USER_AGENT) return unavailable;
    const key =
      latitude.toFixed(4) + ',' + longitude.toFixed(4) + (accuracy > 50 ? ':area' : ':street');
    const old = cache.get(key);
    if (old && old.until > Date.now()) return old.result;
    if (Date.now() < next) return unavailable;
    next = Date.now() + 1100;
    try {
      const url = new URL(config.GEOCODING_REVERSE_URL);
      url.searchParams.set('lat', String(latitude));
      url.searchParams.set('lon', String(longitude));
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('zoom', accuracy > 50 ? '13' : '16');
      const response = await fetch(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(3500),
        headers: {
          'User-Agent': config.GEOCODING_USER_AGENT,
          ...(config.GEOCODING_API_KEY
            ? { Authorization: 'Bearer ' + config.GEOCODING_API_KEY }
            : {}),
        },
      });
      if (!response.ok) return unavailable;
      const value = await response.json();
      if (typeof value.display_name !== 'string') return unavailable;
      const address = value.display_name.replace(/\s+/g, ' ').trim().slice(0, 300);
      if (!address) return unavailable;
      const result = { address, provider: url.hostname };
      if (cache.size >= 500) cache.delete(cache.keys().next().value!);
      cache.set(key, { result, until: Date.now() + 3600_000 });
      return result;
    } catch {
      return unavailable;
    }
  };
}
