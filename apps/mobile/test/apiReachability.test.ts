import { afterEach, expect, it, vi } from 'vitest';
import { subscribeApiReachability } from '../src/apiReachability';

const app = vi.hoisted(() => ({
  currentState: 'active',
  addEventListener: vi.fn(),
}));
vi.mock('react-native', () => ({ AppState: app }));
vi.mock('../config', () => ({ apiUrl: 'https://api.example.test' }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('shares the health probe, detects recovery, and pauses when backgrounded', async () => {
  vi.useFakeTimers();
  const unsubscribed = vi.fn();
  app.addEventListener.mockReturnValue({ remove: unsubscribed });
  const fetchHealth = vi.fn()
    .mockResolvedValueOnce(new Response('<html>Captive portal</html>'))
    .mockImplementation(async () => Response.json({ status: 'ok', service: 'renuka-api' }));
  vi.stubGlobal('fetch', fetchHealth);
  const first = vi.fn();
  const second = vi.fn();
  const stopFirst = subscribeApiReachability(first);
  const stopSecond = subscribeApiReachability(second);
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchHealth).toHaveBeenCalledTimes(1);
    expect(fetchHealth).toHaveBeenCalledWith('https://api.example.test/api/health', expect.anything());
    expect(first).toHaveBeenLastCalledWith(false);
    expect(second).toHaveBeenLastCalledWith(false);

    await vi.advanceTimersByTimeAsync(18_000);
    expect(first).toHaveBeenLastCalledWith(true);
    expect(second).toHaveBeenLastCalledWith(true);
    const change = app.addEventListener.mock.calls[0][1];
    app.currentState = 'background';
    change('background');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchHealth).toHaveBeenCalledTimes(2);

    app.currentState = 'active';
    change('active');
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchHealth).toHaveBeenCalledTimes(3);
  } finally {
    stopFirst();
    stopSecond();
  }
  expect(unsubscribed).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(fetchHealth).toHaveBeenCalledTimes(3);
});
