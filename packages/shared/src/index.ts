import { z } from 'zod';

export const HEALTH_PATH = '/api/health';
export const healthSchema = z.strictObject({
  status: z.literal('ok'),
  service: z.literal('renuka-api'),
});
export type Health = z.infer<typeof healthSchema>;

export const roleSchema = z.enum(['super_admin', 'admin', 'employee']);
export const reviewStatusSchema = z.enum(['pending', 'approved', 'rejected']);
export const gpsFixSchema = z.strictObject({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().nonnegative(),
  capturedAt: z.iso.datetime(),
});
export type GpsFix = z.infer<typeof gpsFixSchema>;

export async function fetchHealth(baseUrl: string, signal?: AbortSignal): Promise<Health> {
  const url = baseUrl.replace(/\/$/, '') + HEALTH_PATH;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('The API returned HTTP ' + response.status);
  return healthSchema.parse(await response.json());
}
export * from './employees.js';
export * from './attendance.js';
export * from './visits.js';
