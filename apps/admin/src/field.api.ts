import type { Visit, VisitPage, VisitStatus } from '@renuka/shared';
import { authorized, data } from './api';
export type FieldFilters = {
  from?: string;
  to?: string;
  department?: string;
  employeeId?: string;
  status?: VisitStatus;
  search?: string;
  client?: string;
  page?: number;
  limit?: number;
  interval?: 'day' | 'week' | 'month';
};
export type Marker = {
  id: string;
  code: string;
  clientName: string;
  visitDate: string;
  status: VisitStatus;
  employee?: string;
  latitude: number;
  longitude: number;
};
export type Overview = {
  from: string;
  to: string;
  timezone: string;
  departments: string[];
  totalEmployees: number;
  activeEmployees: number;
  currentlyCheckedIn: number;
  completedAttendanceToday: number;
  totalVisits: number;
  visitsToday: number;
  pendingReviews: number;
  approvedVisits: number;
  rejectedVisits: number;
  averageWorkingHours: number | null;
  totalWorkingMinutes: number;
};
type AttendanceGroup = {
  _id: string;
  sessions: number;
  completed: number;
  incomplete: number;
  workingMinutes: number;
  averageMinutes: number | null;
};
type VisitGroup = {
  _id: string;
  visits: number;
  pending: number;
  approved: number;
  rejected: number;
  averageReviewHours: number | null;
};
type EmployeeActivity = {
  id: string;
  employeeCode: string;
  fullName: string;
  department: string;
  sessions: number;
  completed: number;
  incomplete: number;
  workingMinutes: number;
  visits: number;
};
const query = (filters: FieldFilters & { report?: string }) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    const normalized = value === undefined ? '' : String(value).trim();
    if (normalized) params.set(key, normalized);
  }
  return '?' + params.toString();
};
async function csv(path: string, name: string) {
  const response = await authorized(path);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const id = (value: string) => encodeURIComponent(value);
export const fieldApi = {
  list: async (filters: FieldFilters, signal?: AbortSignal) =>
    data<VisitPage>(await authorized('/visits' + query(filters), { signal })),
  stats: async (filters: FieldFilters, signal?: AbortSignal) =>
    data<{ total: number; pending: number; approved: number; rejected: number }>(
      await authorized('/visits/stats' + query(filters), { signal }),
    ),
  detail: async (visitId: string, signal?: AbortSignal) =>
    data<{ visit: Visit }>(await authorized('/visits/' + id(visitId), { signal })).then(
      (r) => r.visit,
    ),
  review: async (visitId: string, action: 'approve' | 'reject', reason?: string) =>
    data<{ visit: Visit }>(
      await authorized('/visits/' + id(visitId) + '/' + action, {
        method: 'POST',
        body: JSON.stringify(action === 'reject' ? { reason } : {}),
      }),
    ).then((r) => r.visit),
  image: async (evidenceId: string, signal?: AbortSignal) =>
    (await authorized('/evidence/' + id(evidenceId) + '/view', { signal })).blob(),
  verify: async (evidenceId: string) =>
    data<{ matches: boolean }>(
      await authorized('/evidence/' + id(evidenceId) + '/verify-integrity', { method: 'POST' }),
    ),
  export: (filters: FieldFilters) => csv('/visits/export' + query(filters), 'field-visits.csv'),
};
export const analyticsApi = {
  overview: async (f: FieldFilters, signal?: AbortSignal) =>
    data<Overview>(await authorized('/analytics/overview' + query(f), { signal })),
  attendance: async (f: FieldFilters, signal?: AbortSignal) =>
    data<{
      trend: AttendanceGroup[];
      total: AttendanceGroup | null;
      byDepartment: {
        department: string;
        sessions: number;
        completed: number;
        incomplete: number;
        workingMinutes: number;
      }[];
    }>(await authorized('/analytics/attendance' + query(f), { signal })),
  visits: async (f: FieldFilters, signal?: AbortSignal) =>
    data<{
      trend: VisitGroup[];
      total: VisitGroup | null;
      byDepartment: {
        department: string;
        visits: number;
        pending: number;
        approved: number;
        rejected: number;
      }[];
    }>(await authorized('/analytics/visits' + query(f), { signal })),
  reviews: async (f: FieldFilters, signal?: AbortSignal) =>
    data<{
      pending: number;
      approved: number;
      rejected: number;
      averageReviewHours: number | null;
    }>(await authorized('/analytics/reviews' + query(f), { signal })),
  employees: async (f: FieldFilters, signal?: AbortSignal) =>
    data<{ employees: EmployeeActivity[]; total: number; page: number; limit: number }>(
      await authorized('/analytics/employees' + query(f), { signal }),
    ),
  locations: async (f: FieldFilters, signal?: AbortSignal) =>
    data<{ markers: Marker[]; total: number; page: number; limit: number }>(
      await authorized('/analytics/locations' + query(f), { signal }),
    ),
  export: (f: FieldFilters, report: 'summary' | 'employees') =>
    csv(
      '/analytics/export' + query({ ...f, report }),
      report === 'employees' ? 'employee-activity.csv' : 'analytics-summary.csv',
    ),
};
