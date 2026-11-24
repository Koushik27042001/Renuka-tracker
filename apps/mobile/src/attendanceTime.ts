export function elapsedClock(checkIn: string, serverNow: number) {
  const seconds = Math.max(0, Math.floor((serverNow - Date.parse(checkIn)) / 1000));
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}

export function formatShiftTime(value: string | null, timezone: string) {
  return value
    ? new Intl.DateTimeFormat(undefined, {
        timeZone: timezone,
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value))
    : '—';
}
