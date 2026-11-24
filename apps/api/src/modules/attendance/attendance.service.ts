import { createHash } from 'node:crypto';
import { mongo, Types, type QueryFilter } from 'mongoose';
import type { AttendanceLocation, AttendanceRecord, AttendanceSubmission } from '@renuka/shared';
import type { Config } from '../../config.js';
import { AppError } from '../../middleware/errors.js';
import type { Models } from '../../models/index.js';
import { recordAudit, type AuditContext } from '../auth/audit.js';
import type { AttendanceData } from './attendance.model.js';
import type { ReportQuery } from './attendance.validation.js';

type Row = AttendanceData & { _id: Types.ObjectId };
type Actor = { id: string; department?: string };
type Action = 'checkIn' | 'checkOut';
const notFound = () => new AppError(404, 'Attendance record not found');
const duplicateKey = (error: unknown) =>
  error instanceof mongo.MongoServerError && error.code === 11000;
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const geo = (location: AttendanceLocation) => ({
  type: 'Point' as const,
  coordinates: [location.longitude, location.latitude],
});
const fingerprint = (input: AttendanceSubmission) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        input.location.latitude,
        input.location.longitude,
        input.location.accuracy,
        input.location.capturedAt,
        input.attendanceId?.toLowerCase() ?? null,
      ]),
    )
    .digest('hex');

export function attendanceService(models: Models, config: Config, clock = () => new Date()) {
  const { attendance, users } = models;
  const timezone = config.BUSINESS_TIMEZONE;
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const day = (date: Date) => format.format(date);
  const limit = (now: Date) =>
    new Date(now.getTime() - config.ATTENDANCE_MAX_SHIFT_HOURS * 3600_000);
  function fix(
    point?: AttendanceData['checkOutLocation'],
    accuracy?: number | null,
    captured?: Date | null,
  ): AttendanceLocation | undefined {
    if (!point || accuracy == null || !captured) return;
    return {
      longitude: point.coordinates[0],
      latitude: point.coordinates[1],
      accuracy,
      capturedAt: captured.toISOString(),
    };
  }
  function serialize(
    row: Row,
    now: Date,
    employee?: AttendanceRecord['employee'],
    includeLocation = false,
  ): AttendanceRecord {
    return {
      id: row._id.toString(),
      employeeId: row.employeeId.toString(),
      employee,
      attendanceDate: row.attendanceDate,
      timezone: row.timezone,
      checkInTime: row.checkInTime.toISOString(),
      checkOutTime: row.checkOutTime?.toISOString() ?? null,
      workingMinutes: row.workingMinutes ?? null,
      status:
        row.status === 'CHECKED_IN' && row.checkInTime <= limit(now) ? 'INCOMPLETE' : row.status,
      ...(includeLocation
        ? {
            checkInLocation: fix(row.checkInLocation, row.checkInAccuracy, row.checkInCapturedAt),
            checkOutLocation: fix(
              row.checkOutLocation,
              row.checkOutAccuracy,
              row.checkOutCapturedAt,
            ),
          }
        : {}),
    };
  }
  function validateFix(location: AttendanceLocation, now: Date) {
    const age = now.getTime() - Date.parse(location.capturedAt);
    if (age > config.ATTENDANCE_MAX_LOCATION_AGE_SECONDS * 1000 || age < -5000)
      throw new AppError(
        400,
        'Location reading is stale or the device clock is out of sync. Capture again.',
      );
    if (location.accuracy > config.ATTENDANCE_MAX_ACCURACY)
      throw new AppError(400, 'Location accuracy is too low. Move to an open area and retry.');
  }
  async function audit(
    context: AuditContext,
    actorId: string,
    action:
      | 'ATTENDANCE_CHECKED_IN'
      | 'ATTENDANCE_CHECKED_OUT'
      | 'ATTENDANCE_DUPLICATE'
      | 'ATTENDANCE_EXPORTED'
      | 'ATTENDANCE_VIEWED',
    entityId?: Types.ObjectId,
  ) {
    await recordAudit(models, context, {
      actorId: new Types.ObjectId(actorId),
      action,
      entityType: 'ATTENDANCE',
      entityId,
    });
  }
  async function existing(
    action: Action,
    employeeId: string,
    input: AttendanceSubmission,
    context: AuditContext,
    now: Date,
  ) {
    const key = action === 'checkIn' ? 'checkInKey' : 'checkOutKey';
    const print = action === 'checkIn' ? 'checkInFingerprint' : 'checkOutFingerprint';
    const row = await attendance
      .findOne({ employeeId, [key]: input.idempotencyKey })
      .select('+' + print)
      .lean();
    if (!row) return;
    await audit(context, employeeId, 'ATTENDANCE_DUPLICATE', row._id);
    if (row[print] !== fingerprint(input))
      throw new AppError(409, 'Idempotency key already used for another submission.');
    return serialize(row, now, undefined, true);
  }
  async function employeeDirectory(actor: Actor, query: Partial<ReportQuery> = {}) {
    const prefix = query.search ? new RegExp('^' + escape(query.search), 'i') : undefined;
    return users
      .find({
        role: 'EMPLOYEE',
        ...(actor.department ? { department: actor.department } : {}),
        ...(query.department ? { $and: [{ department: query.department }] } : {}),
        ...(query.employeeId ? { _id: query.employeeId } : {}),
        ...(prefix
          ? { $or: [{ employeeCode: prefix }, { fullName: prefix }, { email: prefix }] }
          : {}),
      })
      .select('employeeCode fullName department status')
      .lean();
  }
  async function report(actor: Actor, query: ReportQuery, now: Date) {
    const employees = await employeeDirectory(actor, query);
    const directory = new Map(
      employees.map((user) => [
        user._id.toString(),
        {
          employeeCode: user.employeeCode,
          fullName: user.fullName,
          department: user.department,
        },
      ]),
    );
    const filter: QueryFilter<AttendanceData> = {
      employeeId: { $in: employees.map((user) => user._id) },
      ...dateFilter(query),
    };
    if (query.status === 'INCOMPLETE')
      filter.$or = [
        { status: 'INCOMPLETE' },
        { status: 'CHECKED_IN', checkInTime: { $lte: limit(now) } },
      ];
    else if (query.status) {
      filter.status = query.status;
      if (query.status === 'CHECKED_IN') filter.checkInTime = { $gt: limit(now) };
    }
    return { filter, directory };
  }
  function dateFilter(query: { from?: string; to?: string }) {
    return query.from || query.to
      ? {
          attendanceDate: {
            ...(query.from ? { $gte: query.from } : {}),
            ...(query.to ? { $lte: query.to } : {}),
          },
        }
      : {};
  }
  async function listRows(
    filter: QueryFilter<AttendanceData>,
    page: number,
    limit: number,
    now: Date,
    sortBy = 'checkInTime',
    sortOrder: 1 | -1 = -1,
    directory?: Map<string, AttendanceRecord['employee']>,
  ) {
    const [rows, total] = await Promise.all([
      attendance
        .find(filter)
        .sort({ [sortBy]: sortOrder, _id: sortOrder })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      attendance.countDocuments(filter),
    ]);
    return {
      records: rows.map((row) => serialize(row, now, directory?.get(row.employeeId.toString()))),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }
  return {
    async checkIn(employeeId: string, input: AttendanceSubmission, context: AuditContext) {
      const now = clock();
      const prior = await existing('checkIn', employeeId, input, context, now);
      if (prior) return { attendance: prior, replayed: true };
      validateFix(input.location, now);
      await attendance.updateOne(
        { employeeId, status: 'CHECKED_IN', checkInTime: { $lte: limit(now) } },
        { $set: { status: 'INCOMPLETE' } },
      );
      let row;
      try {
        row = await attendance.create({
          employeeId,
          attendanceDate: day(now),
          timezone,
          checkInTime: now,
          checkInLocation: geo(input.location),
          checkInAccuracy: input.location.accuracy,
          checkInCapturedAt: new Date(input.location.capturedAt),
          status: 'CHECKED_IN',
          checkInKey: input.idempotencyKey,
          checkInFingerprint: fingerprint(input),
        });
      } catch (error) {
        if (!duplicateKey(error)) throw error;
        const retry = await existing('checkIn', employeeId, input, context, now);
        if (retry) return { attendance: retry, replayed: true };
        await audit(context, employeeId, 'ATTENDANCE_DUPLICATE');
        throw new AppError(409, 'You already have an active attendance session.');
      }
      await audit(context, employeeId, 'ATTENDANCE_CHECKED_IN', row._id);
      return { attendance: serialize(row, now, undefined, true), replayed: false };
    },
    async checkOut(employeeId: string, input: AttendanceSubmission, context: AuditContext) {
      const now = clock();
      const prior = await existing('checkOut', employeeId, input, context, now);
      if (prior) return { attendance: prior, replayed: true };
      validateFix(input.location, now);
      const selector = {
        employeeId,
        status: 'CHECKED_IN' as const,
        checkInTime: { $gt: limit(now), $lte: now },
        ...(input.attendanceId ? { _id: input.attendanceId } : {}),
      };
      const active = await attendance.findOne(selector).lean();
      let updated: Row | null = null;
      if (active)
        try {
          updated = await attendance
            .findOneAndUpdate(
              { ...selector, _id: active._id },
              {
                $set: {
                  checkOutTime: now,
                  checkOutDate: day(now),
                  checkOutLocation: geo(input.location),
                  checkOutAccuracy: input.location.accuracy,
                  checkOutCapturedAt: new Date(input.location.capturedAt),
                  checkOutKey: input.idempotencyKey,
                  checkOutFingerprint: fingerprint(input),
                  workingMinutes: Math.floor(
                    (now.getTime() - active.checkInTime.getTime()) / 60_000,
                  ),
                  status: 'CHECKED_OUT',
                },
              },
              { returnDocument: 'after' },
            )
            .lean();
        } catch (error) {
          if (!duplicateKey(error)) throw error;
        }
      if (!updated) {
        const retry = await existing('checkOut', employeeId, input, context, now);
        if (retry) return { attendance: retry, replayed: true };
        await audit(context, employeeId, 'ATTENDANCE_DUPLICATE');
        throw new AppError(409, 'No active attendance session is available for checkout.');
      }
      await audit(context, employeeId, 'ATTENDANCE_CHECKED_OUT', updated._id);
      return { attendance: serialize(updated, now, undefined, true), replayed: false };
    },
    async current(employeeId: string) {
      const now = clock();
      const attendanceDate = day(now);
      const row =
        (await attendance.findOne({ employeeId, status: 'CHECKED_IN' }).lean()) ??
        (await attendance
          .findOne({ employeeId, $or: [{ attendanceDate }, { checkOutDate: attendanceDate }] })
          .sort({ checkInTime: -1, _id: -1 })
          .lean());
      return {
        attendanceDate,
        timezone,
        serverTime: now.toISOString(),
        attendance: row ? serialize(row, now) : null,
        limits: {
          preferredAccuracy: config.ATTENDANCE_PREFERRED_ACCURACY,
          maximumAccuracy: config.ATTENDANCE_MAX_ACCURACY,
          maximumAgeSeconds: config.ATTENDANCE_MAX_LOCATION_AGE_SECONDS,
        },
      };
    },
    history(
      employeeId: string,
      query: { from?: string; to?: string; page: number; limit: number },
    ) {
      return listRows(
        { employeeId: new Types.ObjectId(employeeId), ...dateFilter(query) },
        query.page,
        query.limit,
        clock(),
      );
    },
    async ownDetail(employeeId: string, id: string) {
      const record = await attendance.findOne({ employeeId, _id: id }).lean();
      if (!record) throw notFound();
      return serialize(record, clock(), undefined, true);
    },
    async adminDetail(actor: Actor, id: string, context: AuditContext) {
      const row = await attendance.findById(id).lean();
      if (!row) throw notFound();
      const [user] = await employeeDirectory(actor, { employeeId: row.employeeId.toString() });
      if (!user) throw notFound();
      await audit(context, actor.id, 'ATTENDANCE_VIEWED', row._id);
      return serialize(
        row,
        clock(),
        { employeeCode: user.employeeCode, fullName: user.fullName, department: user.department },
        true,
      );
    },
    async list(actor: Actor, query: ReportQuery & { page: number; limit: number }) {
      const now = clock();
      const { filter, directory } = await report(actor, query, now);
      return listRows(
        filter,
        query.page,
        query.limit,
        now,
        query.sortBy,
        query.sortOrder === 'asc' ? 1 : -1,
        directory,
      );
    },
    async stats(actor: Actor) {
      const now = clock();
      const attendanceDate = day(now);
      const directory = await employeeDirectory(actor);
      const employeeId = { $in: directory.map((user) => user._id) };
      const activeIds = directory
        .filter((user) => user.status === 'ACTIVE')
        .map((user) => user._id);
      const onDuty = { status: 'CHECKED_IN' as const, checkInTime: { $gt: limit(now) } };
      const endedToday = { status: 'CHECKED_OUT' as const, checkOutDate: attendanceDate };
      const [on, ended, present, incompleteSessions] = await Promise.all([
        attendance.distinct('employeeId', { employeeId, ...onDuty }),
        attendance.distinct('employeeId', { employeeId, ...endedToday }),
        attendance.distinct('employeeId', {
          employeeId: { $in: activeIds },
          $or: [{ attendanceDate }, onDuty, endedToday],
        }),
        attendance.countDocuments({
          employeeId,
          $or: [
            { status: 'INCOMPLETE' },
            { status: 'CHECKED_IN', checkInTime: { $lte: limit(now) } },
          ],
        }),
      ]);
      return {
        totalEmployees: directory.length,
        currentlyOnDuty: on.length,
        checkedOutToday: ended.length,
        notCheckedInToday: activeIds.length - present.length,
        incompleteSessions,
        attendanceDate,
        timezone,
        departments: [...new Set(directory.map((user) => user.department))].sort(),
      };
    },
    async exportRows(actor: Actor, query: ReportQuery, context: AuditContext) {
      const now = clock();
      const { filter, directory } = await report(actor, query, now);
      await audit(context, actor.id, 'ATTENDANCE_EXPORTED');
      const order = query.sortOrder === 'asc' ? 1 : -1;
      const cursor = attendance
        .find(filter)
        .sort({ [query.sortBy]: order, _id: order })
        .lean()
        .cursor();
      return (async function* () {
        try {
          for await (const row of cursor)
            yield serialize(row, now, directory.get(row.employeeId.toString()));
        } finally {
          await cursor.close();
        }
      })();
    },
  };
}
