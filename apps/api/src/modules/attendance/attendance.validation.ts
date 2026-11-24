import { z } from 'zod';
import { attendanceStatus } from '@renuka/shared';
import { objectId } from '../users/user.validation.js';

const dates = { from: z.iso.date().optional(), to: z.iso.date().optional() };
const pages = {
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};
const report = {
  ...dates,
  employeeId: objectId.optional(),
  search: z.string().trim().min(1).max(80).optional(),
  department: z.string().trim().min(1).max(120).optional(),
  status: attendanceStatus.optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  sortBy: z.enum(['checkInTime', 'attendanceDate', 'workingMinutes']).default('checkInTime'),
};
const ordered = (input: { from?: string; to?: string }) =>
  !input.from || !input.to || input.from <= input.to;
export const attendanceId = z.strictObject({ id: objectId });
export const historyQuery = z
  .strictObject({ ...dates, ...pages })
  .refine(ordered, { path: ['to'], message: 'End date must be on or after start date' });
export const attendanceExport = z
  .strictObject(report)
  .refine(ordered, { path: ['to'], message: 'End date must be on or after start date' });
export const attendanceList = z
  .strictObject({ ...report, ...pages })
  .refine(ordered, { path: ['to'], message: 'End date must be on or after start date' });
export type ReportQuery = z.output<typeof attendanceExport>;
