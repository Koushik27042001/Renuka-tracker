import { z } from 'zod';
import { email, employeeCode } from '../users/user.validation.js';

export const transportSchema = z.enum(['web', 'mobile', 'employee-web']);
export type Transport = z.infer<typeof transportSchema>;
export const loginSchema = z.strictObject({
  identifier: z.union([email, employeeCode]),
  password: z.string().min(1).max(128),
});
export const rawRefreshSchema = z.string().regex(/^[0-9a-f]{24}\.[A-Za-z0-9_-]{43}$/);
export const mobileRefresh = z.strictObject({ refreshToken: rawRefreshSchema });
export const emptyBody = z.strictObject({});
