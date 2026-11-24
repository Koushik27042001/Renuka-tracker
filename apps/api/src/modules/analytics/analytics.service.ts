import { type PipelineStage, type QueryFilter } from 'mongoose';
import { z } from 'zod';
import { AppError } from '../../middleware/errors.js';
import type { Models } from '../../models/index.js';
import type { Config } from '../../config.js';
import { dayFormat, scopedEmployees, type VisitActor } from '../visits/visit.service.js';
import type { VisitData } from '../visits/visit.model.js';

const filters = {
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  department: z.string().trim().min(1).max(120).optional(),
  employeeId: z
    .string()
    .regex(/^[a-f0-9]{24}$/i)
    .optional(),
  status: z.enum(['PENDING_REVIEW', 'APPROVED', 'REJECTED']).optional(),
  interval: z.enum(['day', 'week', 'month']).default('day'),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(50),
};
export const analyticsQuery = z.strictObject(filters);
export const analyticsExport = z.strictObject({
  ...filters,
  report: z.enum(['summary', 'employees']).default('summary'),
});
type Query = z.output<typeof analyticsQuery>;
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

const msDay = 86400_000;

export function analyticsService(models: Models, config: Config) {
  const timezone = config.BUSINESS_TIMEZONE;
  const format = dayFormat(timezone);
  const today = () => format.format(new Date());
  const cutoff = () => new Date(Date.now() - config.ATTENDANCE_MAX_SHIFT_HOURS * 3600_000);
  function range(query: Query) {
    const to = query.to ?? today();
    const from = query.from ?? new Date(Date.parse(to) - 29 * msDay).toISOString().slice(0, 10);
    if (from > to || Date.parse(to) - Date.parse(from) > 365 * msDay)
      throw new AppError(400, 'Select an ordered date range of up to 366 days.');
    return { from, to };
  }
  async function scope(actor: VisitActor, query: Query) {
    const { from, to } = range(query);
    const directory = await scopedEmployees(models, actor, query);
    const employeeId = { $in: directory.map((user) => user._id) };
    const attendanceDate = { $gte: from, $lte: to };
    const status = query.status ?? { $ne: 'DRAFT' as const };
    const visits = { employeeId, visitDate: attendanceDate, status, discardAt: null };
    return { from, to, directory, employeeId, attendance: { employeeId, attendanceDate }, visits };
  }
  const bucket = (field: string, interval: Query['interval']) => ({
    $dateToString: {
      format: '%Y-%m-%d',
      date: {
        $dateTrunc: {
          date: { $dateFromString: { dateString: field } },
          unit: interval,
          timezone: 'UTC',
          ...(interval === 'week' ? { startOfWeek: 'monday' } : {}),
        },
      },
    },
  });
  function groupAttendance(match: Record<string, unknown>, id: unknown) {
    const closed = { $eq: ['$status', 'CHECKED_OUT'] };
    const incomplete = {
      $or: [
        { $eq: ['$status', 'INCOMPLETE'] },
        { $and: [{ $eq: ['$status', 'CHECKED_IN'] }, { $lte: ['$checkInTime', cutoff()] }] },
      ],
    };
    return models.attendance.aggregate<AttendanceGroup>([
      { $match: match },
      {
        $group: {
          _id: id,
          sessions: { $sum: 1 },
          completed: { $sum: { $cond: [closed, 1, 0] } },
          incomplete: { $sum: { $cond: [incomplete, 1, 0] } },
          workingMinutes: { $sum: { $cond: [closed, '$workingMinutes', 0] } },
          averageMinutes: { $avg: { $cond: [closed, '$workingMinutes', null] } },
        },
      },
      { $sort: { _id: 1 } },
    ] as PipelineStage[]);
  }
  function groupVisits(match: Record<string, unknown>, id: unknown) {
    return models.visits.aggregate<VisitGroup>([
      { $match: match },
      {
        $group: {
          _id: id,
          visits: { $sum: 1 },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'PENDING_REVIEW'] }, 1, 0] } },
          approved: { $sum: { $cond: [{ $eq: ['$status', 'APPROVED'] }, 1, 0] } },
          rejected: { $sum: { $cond: [{ $eq: ['$status', 'REJECTED'] }, 1, 0] } },
          averageReviewHours: {
            $avg: {
              $cond: [
                {
                  $and: [
                    { $ne: [{ $ifNull: ['$reviewedAt', null] }, null] },
                    { $ne: [{ $ifNull: ['$submittedAt', null] }, null] },
                  ],
                },
                { $divide: [{ $subtract: ['$reviewedAt', '$submittedAt'] }, 3600_000] },
                null,
              ],
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ] as PipelineStage[]);
  }
  return {
    timezone,
    range,
    async overview(actor: VisitActor, query: Query) {
      const result = await scope(actor, query);
      const date = today();
      const [attendance, visits, onDuty, completedToday, visitsToday] = await Promise.all([
        groupAttendance(result.attendance, null),
        groupVisits(result.visits, null),
        models.attendance.countDocuments({
          employeeId: result.employeeId,
          status: 'CHECKED_IN',
          checkInTime: { $gt: cutoff() },
        }),
        models.attendance.countDocuments({
          employeeId: result.employeeId,
          status: 'CHECKED_OUT',
          checkOutDate: date,
        }),
        models.visits.countDocuments({ ...result.visits, visitDate: date }),
      ]);
      return {
        from: result.from,
        to: result.to,
        timezone,
        departments: [...new Set(result.directory.map((user) => user.department))].sort(),
        totalEmployees: result.directory.length,
        activeEmployees: result.directory.filter((user) => user.status === 'ACTIVE').length,
        currentlyCheckedIn: onDuty,
        completedAttendanceToday: completedToday,
        totalVisits: visits[0]?.visits ?? 0,
        visitsToday,
        pendingReviews: visits[0]?.pending ?? 0,
        approvedVisits: visits[0]?.approved ?? 0,
        rejectedVisits: visits[0]?.rejected ?? 0,
        averageWorkingHours:
          attendance[0]?.averageMinutes == null ? null : attendance[0].averageMinutes / 60,
        totalWorkingMinutes: attendance[0]?.workingMinutes ?? 0,
      };
    },
    async attendance(actor: VisitActor, query: Query) {
      const result = await scope(actor, query);
      const [trend, byEmployee, total] = await Promise.all([
        groupAttendance(result.attendance, bucket('$attendanceDate', query.interval)),
        groupAttendance(result.attendance, '$employeeId'),
        groupAttendance(result.attendance, null),
      ]);
      const departments = new Map(
        result.directory.map((user) => [user._id.toString(), user.department]),
      );
      const groups = new Map<
        string,
        {
          department: string;
          sessions: number;
          completed: number;
          incomplete: number;
          workingMinutes: number;
        }
      >();
      for (const row of byEmployee) {
        const department = departments.get(String(row._id));
        if (!department) continue;
        const group = groups.get(department) ?? {
          department,
          sessions: 0,
          completed: 0,
          incomplete: 0,
          workingMinutes: 0,
        };
        group.sessions += row.sessions;
        group.completed += row.completed;
        group.incomplete += row.incomplete;
        group.workingMinutes += row.workingMinutes;
        groups.set(department, group);
      }
      return {
        from: result.from,
        to: result.to,
        timezone,
        trend,
        total: total[0] ?? null,
        byDepartment: [...groups.values()],
      };
    },
    async visits(actor: VisitActor, query: Query) {
      const result = await scope(actor, query);
      const [trend, byEmployee, total] = await Promise.all([
        groupVisits(result.visits, bucket('$visitDate', query.interval)),
        groupVisits(result.visits, '$employeeId'),
        groupVisits(result.visits, null),
      ]);
      const departments = new Map(
        result.directory.map((user) => [user._id.toString(), user.department]),
      );
      const groups = new Map<
        string,
        { department: string; visits: number; pending: number; approved: number; rejected: number }
      >();
      for (const row of byEmployee) {
        const department = departments.get(String(row._id));
        if (!department) continue;
        const group = groups.get(department) ?? {
          department,
          visits: 0,
          pending: 0,
          approved: 0,
          rejected: 0,
        };
        group.visits += row.visits;
        group.pending += row.pending;
        group.approved += row.approved;
        group.rejected += row.rejected;
        groups.set(department, group);
      }
      return {
        from: result.from,
        to: result.to,
        timezone,
        trend,
        total: total[0] ?? null,
        byDepartment: [...groups.values()],
      };
    },
    async employees(actor: VisitActor, query: Query, all = false) {
      const result = await scope(actor, query);
      const directory = result.directory.sort((a, b) =>
        a.employeeCode.localeCompare(b.employeeCode),
      );
      const batch = all
        ? directory
        : directory.slice((query.page - 1) * query.limit, query.page * query.limit);
      const employeeId = { $in: batch.map((user) => user._id) };
      const [attendance, visits] = await Promise.all([
        groupAttendance({ ...result.attendance, employeeId }, '$employeeId'),
        groupVisits({ ...result.visits, employeeId }, '$employeeId'),
      ]);
      const work = new Map(attendance.map((row) => [String(row._id), row]));
      const field = new Map(visits.map((row) => [String(row._id), row]));
      return {
        total: directory.length,
        page: query.page,
        limit: query.limit,
        employees: batch.map((user) => {
          const row = work.get(user._id.toString());
          return {
            id: user._id.toString(),
            employeeCode: user.employeeCode,
            fullName: user.fullName,
            department: user.department,
            sessions: row?.sessions ?? 0,
            completed: row?.completed ?? 0,
            incomplete: row?.incomplete ?? 0,
            workingMinutes: row?.workingMinutes ?? 0,
            visits: field.get(user._id.toString())?.visits ?? 0,
          };
        }),
      };
    },
    async reviews(actor: VisitActor, query: Query) {
      const result = await scope(actor, query);
      const [summary] = await groupVisits(result.visits, null);
      return {
        pending: summary?.pending ?? 0,
        approved: summary?.approved ?? 0,
        rejected: summary?.rejected ?? 0,
        averageReviewHours: summary?.averageReviewHours ?? null,
      };
    },
    async locations(actor: VisitActor, query: Query) {
      const result = await scope(actor, query);
      const match: QueryFilter<VisitData> = {
        ...result.visits,
        evidenceRetiredAt: null,
        'evidence.point.coordinates': { $exists: true },
      };
      const [rows, total] = await Promise.all([
        models.visits
          .find(match)
          .select('employeeId clientName visitDate status evidence.point')
          .sort({ visitDate: -1, _id: -1 })
          .skip((query.page - 1) * query.limit)
          .limit(query.limit)
          .lean(),
        models.visits.countDocuments(match),
      ]);
      const names = new Map(result.directory.map((user) => [user._id.toString(), user.fullName]));
      return {
        total,
        page: query.page,
        limit: query.limit,
        markers: rows.flatMap((row) => {
          const coords = row.evidence?.point?.coordinates;
          if (
            !coords ||
            coords.length !== 2 ||
            !coords.every(Number.isFinite) ||
            Math.abs(coords[0]) > 180 ||
            Math.abs(coords[1]) > 90
          )
            return [];
          return [
            {
              id: row._id.toString(),
              code: 'VIS-' + row._id.toString().toUpperCase(),
              clientName: row.clientName,
              visitDate: row.visitDate,
              status: row.status,
              employee: names.get(row.employeeId.toString()),
              longitude: coords[0],
              latitude: coords[1],
            },
          ];
        }),
      };
    },
  };
}
