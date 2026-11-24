import { z } from 'zod';

export const attendanceStatus = z.enum(['CHECKED_IN', 'CHECKED_OUT', 'INCOMPLETE']);
export const attendanceLocation = z.strictObject({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().positive().max(100000),
  capturedAt: z.iso.datetime(),
});
export const attendanceSubmission = z.strictObject({
  location: attendanceLocation,
  idempotencyKey: z.uuid(),
});
export const checkoutSubmission = attendanceSubmission.extend({
  attendanceId: z
    .string()
    .regex(/^[a-fA-F0-9]{24}$/)
    .optional(),
});
export type AttendanceLocation = z.infer<typeof attendanceLocation>;
export type AttendanceSubmission = z.infer<typeof checkoutSubmission>;
export type AttendanceStatus = z.infer<typeof attendanceStatus>;
export type AttendanceRecord = {
  id: string;
  employeeId: string;
  attendanceDate: string;
  timezone: string;
  checkInTime: string;
  checkOutTime: string | null;
  workingMinutes: number | null;
  status: AttendanceStatus;
  employee?: { employeeCode: string; fullName: string; department: string };
  checkInLocation?: AttendanceLocation;
  checkOutLocation?: AttendanceLocation;
};
export type AttendancePage = {
  records: AttendanceRecord[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
};
export type CurrentAttendance = {
  attendanceDate: string;
  timezone: string;
  serverTime: string;
  attendance: AttendanceRecord | null;
  limits: { preferredAccuracy: number; maximumAccuracy: number; maximumAgeSeconds: number };
};
export type AttendanceStats = {
  totalEmployees: number;
  currentlyOnDuty: number;
  checkedOutToday: number;
  notCheckedInToday: number;
  incompleteSessions: number;
  attendanceDate: string;
  timezone: string;
  departments: string[];
};
