import type {
  AttendancePage,
  AttendanceRecord,
  AttendanceStats,
  AttendanceStatus,
} from '@renuka/shared';
import { authorized, data } from './api';

export type AttendanceFilters = {
  page?: number;
  limit?: number;
  search?: string;
  department?: string;
  employeeId?: string;
  from?: string;
  to?: string;
  status?: AttendanceStatus;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
};
const base = '/attendance';
function query(filters: AttendanceFilters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    const normalized = value === undefined ? '' : String(value).trim();
    if (normalized) params.set(key, normalized);
  }
  return '?' + params.toString();
}
export const attendanceApi = {
  list: async (filters: AttendanceFilters, signal?: AbortSignal) =>
    data<AttendancePage>(await authorized(base + query(filters), { signal })),
  stats: async (signal?: AbortSignal) =>
    data<AttendanceStats>(await authorized(base + '/stats', { signal })),
  detail: async (id: string, signal?: AbortSignal) =>
    data<{ attendance: AttendanceRecord }>(
      await authorized(base + '/' + encodeURIComponent(id), { signal }),
    ).then((reply) => reply.attendance),
  export: async (filters: AttendanceFilters) => {
    const result = await authorized(base + '/export' + query(filters));
    const url = URL.createObjectURL(await result.blob());
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'attendance.csv';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
