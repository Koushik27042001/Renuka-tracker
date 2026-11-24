import { mongo, type Connection } from 'mongoose';
import { visitModel } from '../modules/visits/visit.model.js';
import { attendanceModel } from '../modules/attendance/attendance.model.js';
import { employeeCounterModel } from './EmployeeCounter.model.js';
import { userModel } from './User.model.js';
import { refreshSessionModel } from './RefreshSession.model.js';
import { auditLogModel } from './AuditLog.model.js';

export function createModels(connection: Connection) {
  return {
    users: userModel(connection),
    attendance: attendanceModel(connection),
    visits: visitModel(connection),
    employeeCounters: employeeCounterModel(connection),
    sessions: refreshSessionModel(connection),
    auditLogs: auditLogModel(connection),
  };
}
export type Models = ReturnType<typeof createModels>;

export async function createIndexes(models: Models) {
  try {
    await models.employeeCounters.createCollection();
  } catch (error) {
    if (!(error instanceof mongo.MongoServerError && error.code === 48)) throw error;
  }
  await models.users.createIndexes();
  await models.attendance.createIndexes();
  await models.visits.createIndexes();
  await models.sessions.createIndexes();
  await models.auditLogs.createIndexes();
}

export async function requireIndexes(models: Models) {
  const indexes = await models.users.listIndexes();
  for (const key of ['employeeCode', 'email', 'bootstrap']) {
    if (
      !indexes.some(
        (index) =>
          index.key[key] === 1 &&
          Object.keys(index.key).length === 1 &&
          index.unique === true &&
          (key === 'bootstrap'
            ? index.partialFilterExpression?.bootstrap === true
            : !index.partialFilterExpression),
      )
    ) {
      throw new Error('Required user indexes are missing. Run db:indexes first.');
    }
  }
}

export async function requireAttendanceIndexes(models: Models) {
  const indexes = await models.attendance.listIndexes();
  for (const key of ['status', 'checkInKey', 'checkOutKey']) {
    const exists = indexes.some(
      (index) =>
        index.unique &&
        index.key.employeeId === 1 &&
        index.key[key] === 1 &&
        Object.keys(index.key).length === 2 &&
        (key === 'status'
          ? index.partialFilterExpression?.status === 'CHECKED_IN'
          : key === 'checkOutKey'
            ? index.partialFilterExpression?.checkOutKey?.$type === 'string'
            : !index.partialFilterExpression),
    );
    if (!exists)
      throw new Error('Attendance uniqueness indexes are missing. Run db:indexes first.');
  }
}

export async function requireVisitIndexes(models: Models) {
  const indexes = await models.visits.listIndexes();
  if (
    !indexes.some(
      (index) =>
        index.unique &&
        index.key.employeeId === 1 &&
        index.key.draftKey === 1 &&
        Object.keys(index.key).length === 2 &&
        !index.partialFilterExpression,
    ) ||
    !indexes.some(
      (index) =>
        index.unique &&
        index.sparse &&
        index.key['evidence._id'] === 1 &&
        Object.keys(index.key).length === 1,
    )
  ) {
    throw new Error('Visit uniqueness indexes are missing. Run db:indexes first.');
  }
}
