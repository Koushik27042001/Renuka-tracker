import type { Config } from '../config.js';
type Address = { address: string | null; provider: string | null };
export function reverseGeocoder(config: Config) {
  const { GEOCODING_REVERSE_URL: endpoint, GEOCODING_USER_AGENT: userAgent } = config;
  const locationIQ = config.GEOCODING_PROVIDER === 'locationiq';
  const apiKey = config.GEOCODING_API_KEY;
  const cache = new Map<string, { result: Address; until: number }>();
  const pending = new Map<string, Promise<Address>>();
  let next = 0;
  return async (latitude: number, longitude: number, accuracy: number): Promise<Address> => {
    const unavailable = { address: null, provider: null };
    if (!endpoint || !userAgent) return unavailable;
    const zoom = accuracy <= 25 ? 18 : accuracy <= 50 ? 17 : 14;
    const key = latitude.toFixed(6) + ',' + longitude.toFixed(6) + ':' + zoom;
    const old = cache.get(key);
    if (old && old.until > Date.now()) return old.result;
    const inFlight = pending.get(key);
    if (inFlight) return inFlight;
    const now = Date.now();
    const delay = Math.max(0, next - now);
    if (delay > 3_300) return unavailable;
    next = now + delay + 1100;
    const lookup = async (): Promise<Address> => {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        const url = new URL(endpoint);
        url.searchParams.set('lat', String(latitude));
        url.searchParams.set('lon', String(longitude));
        url.searchParams.set('format', locationIQ ? 'json' : 'jsonv2');
        if (locationIQ && apiKey) url.searchParams.set('key', apiKey);
        url.searchParams.set('zoom', String(zoom));
        url.searchParams.set('addressdetails', '1');
        const response = await fetch(url, {
          redirect: 'error',
          signal: AbortSignal.timeout(3500),
          headers: {
            'User-Agent': userAgent,
            ...(!locationIQ && apiKey ? { Authorization: 'Bearer ' + apiKey } : {}),
          },
        });
        if (!response.ok) return unavailable;
        const value = await response.json();
        if (typeof value.display_name !== 'string') return unavailable;
        const address = value.display_name.replace(/\s+/g, ' ').trim();
        if (!address || address.length > 2000) return unavailable;
        const result = { address, provider: url.hostname };
        if (cache.size >= 500) cache.delete(cache.keys().next().value!);
        cache.set(key, { result, until: Date.now() + 3600_000 });
        return result;
      } catch {
        return unavailable;
      }
    };
    const request = lookup().finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  };
}
