import { mongo, Types } from 'mongoose';
import type {
  Employee,
  EmployeeInput,
  employeeProfilePatch,
  employeeStatusInput,
} from '@renuka/shared';
import type { z } from 'zod';
import { AppError } from '../../middleware/errors.js';
import type { Models } from '../../models/index.js';
import type { UserData } from '../../models/User.model.js';
import { recordAudit, type AuditContext } from '../auth/audit.js';
import { newRefreshToken, refreshHash } from '../auth/tokens.js';
import type { Passwords } from '../auth/password.js';
import { nextEmployeeCode } from './employee.repository.js';
import type { EmployeeFilters } from './employee.validation.js';

type Actor = { id: string; department?: string };
type Patch = z.output<typeof employeeProfilePatch>;
type StatusChange = z.output<typeof employeeStatusInput>;
const notFound = () => new AppError(404, 'Employee not found');
const invalidLink = () => new AppError(400, 'This setup link is invalid or expired');
const escapePattern = (value: string) => value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
const projection =
  'employeeCode fullName email phone department designation status dateOfJoining lastLoginAt createdAt updatedAt revision onboardingPending';

function serialize(user: UserData & { _id: Types.ObjectId }): Employee {
  return {
    id: user._id.toString(),
    employeeCode: user.employeeCode,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    department: user.department,
    designation: user.designation,
    role: 'EMPLOYEE',
    status: user.status,
    revision: user.revision ?? 0,
    onboardingPending: user.onboardingPending === true,
    dateOfJoining: user.dateOfJoining?.toISOString().slice(0, 10) ?? null,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

function scope(actor: Actor) {
  return {
    role: 'EMPLOYEE' as const,
    ...(actor.department === undefined ? {} : { department: actor.department }),
  };
}
function filter(actor: Actor, criteria: EmployeeFilters) {
  const { department, designation, status, search } = criteria;
  const prefix = search ? new RegExp('^' + escapePattern(search), 'i') : undefined;
  return {
    ...scope(actor),
    ...(department ? { $and: [{ department }] } : {}),
    ...(designation ? { designation } : {}),
    ...(status ? { status } : {}),
    ...(prefix ? { $or: [{ employeeCode: prefix }, { fullName: prefix }, { email: prefix }] } : {}),
  };
}
function sort(criteria: EmployeeFilters) {
  const order = criteria.sortOrder === 'asc' ? (1 as const) : (-1 as const);
  return { [criteria.sortBy]: order, _id: order };
}
function ensureDepartment(actor: Actor, department?: string) {
  if (
    actor.department !== undefined &&
    department !== undefined &&
    actor.department !== department
  ) {
    throw new AppError(403, 'This department is outside your administrative scope');
  }
}
function revisionFilter(revision: number) {
  return revision === 0
    ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] }
    : { revision };
}
const statusEvents = {
  ACTIVE: 'EMPLOYEE_ACTIVATED',
  INACTIVE: 'EMPLOYEE_DEACTIVATED',
  SUSPENDED: 'EMPLOYEE_SUSPENDED',
} as const;

export function employeeService(models: Models, passwords: Passwords) {
  const { users, sessions } = models;
  const find = async (actor: Actor, id: string) => {
    const employee = await users
      .findOne({ ...scope(actor), _id: id })
      .select(projection)
      .lean();
    if (!employee) throw notFound();
    return employee;
  };
  async function audit(
    actor: Actor,
    context: AuditContext,
    action: Parameters<typeof recordAudit>[2]['action'],
    id?: Types.ObjectId,
    details?: { reason?: string; changedFields?: string[] },
  ) {
    await recordAudit(models, context, {
      actorId: new Types.ObjectId(actor.id),
      action,
      entityType: 'EMPLOYEE',
      entityId: id,
      ...details,
    });
  }
  async function revoke(id: Types.ObjectId, version: number) {
    await sessions.updateMany(
      { userId: id, sessionVersion: { $lt: version }, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
  }
  function normalize(input: Partial<EmployeeInput>) {
    const { phone, dateOfJoining, ...fields } = input;
    return {
      ...fields,
      ...(phone ? { phone: phone.startsWith('+') ? phone : '+91' + phone } : {}),
      ...(dateOfJoining ? { dateOfJoining: new Date(dateOfJoining) } : {}),
    };
  }
  function duplicate(error: unknown, key: string) {
    return (
      error instanceof mongo.MongoServerError && error.code === 11000 && !!error.keyPattern?.[key]
    );
  }

  return {
    async create(actor: Actor, input: EmployeeInput, context: AuditContext) {
      ensureDepartment(actor, input.department);
      const passwordHash = await passwords.hash(newRefreshToken(new Types.ObjectId().toString()));
      for (let attempt = 0; attempt < 5; attempt++) {
        const employeeCode = await nextEmployeeCode(models);
        try {
          const employee = await users.create({
            ...normalize(input),
            employeeCode,
            passwordHash,
            role: 'EMPLOYEE',
            status: 'INACTIVE',
            onboardingPending: true,
          });
          await audit(actor, context, 'EMPLOYEE_CREATED', employee._id);
          return serialize(employee);
        } catch (error) {
          if (duplicate(error, 'email'))
            throw new AppError(409, 'This email is already registered', [
              { field: 'email', message: 'Email already registered' },
            ]);
          if (!duplicate(error, 'employeeCode')) throw error;
        }
      }
      throw new AppError(409, 'Employee code allocation conflicted. Retry creation.');
    },
    async detail(actor: Actor, id: string) {
      return serialize(await find(actor, id));
    },
    async list(actor: Actor, criteria: EmployeeFilters & { page: number; limit: number }) {
      const query = filter(actor, criteria);
      const { page, limit } = criteria;
      const [rows, total] = await Promise.all([
        users
          .find(query)
          .select(projection)
          .sort(sort(criteria))
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        users.countDocuments(query),
      ]);
      return {
        employees: rows.map(serialize),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    },
    async update(actor: Actor, id: string, { revision, ...input }: Patch, context: AuditContext) {
      ensureDepartment(actor, input.department);
      const before = await find(actor, id);
      const changedFields = Object.keys(input).filter((key) => {
        const field = key as keyof EmployeeInput;
        if (field === 'dateOfJoining')
          return (before.dateOfJoining?.toISOString().slice(0, 10) ?? '') !== input.dateOfJoining;
        if (field === 'phone') return before.phone !== normalize(input).phone;
        return before[field] !== input[field];
      });
      if ((before.revision ?? 0) !== revision)
        throw new AppError(409, 'Employee changed. Reload before saving.');
      if (!changedFields.length) return serialize(before);
      const set = normalize(input);
      try {
        const updated = await users
          .findOneAndUpdate(
            { ...scope(actor), _id: id, ...revisionFilter(revision) },
            {
              $set: set,
              $unset: {
                ...(input.dateOfJoining === '' ? { dateOfJoining: 1 } : {}),
                ...(changedFields.includes('email')
                  ? { accountSetupHash: 1, accountSetupExpires: 1 }
                  : {}),
              },
              $inc: { revision: 1 },
            },
            { returnDocument: 'after', runValidators: true },
          )
          .select(projection)
          .lean();
        if (!updated) throw new AppError(409, 'Employee changed. Reload before saving.');
        await audit(actor, context, 'EMPLOYEE_UPDATED', updated._id, { changedFields });
        return serialize(updated);
      } catch (error) {
        if (duplicate(error, 'email'))
          throw new AppError(409, 'This email is already registered', [
            { field: 'email', message: 'Email already registered' },
          ]);
        throw error;
      }
    },
    async setStatus(actor: Actor, id: string, input: StatusChange, context: AuditContext) {
      const before = await find(actor, id);
      if ((before.revision ?? 0) !== input.revision)
        throw new AppError(409, 'Employee changed. Reload before saving.');
      if (before.status === input.status) return serialize(before);
      if (before.onboardingPending && input.status === 'ACTIVE')
        throw new AppError(409, 'The employee must complete account setup first');
      const updated = await users
        .findOneAndUpdate(
          { ...scope(actor), _id: id, ...revisionFilter(input.revision) },
          {
            $set: { status: input.status },
            $unset: { accountSetupHash: 1, accountSetupExpires: 1 },
            $inc: { revision: 1, sessionVersion: 1 },
          },
          { returnDocument: 'after' },
        )
        .lean();
      if (!updated) throw new AppError(409, 'Employee changed. Reload before saving.');
      await revoke(updated._id, updated.sessionVersion);
      await audit(actor, context, statusEvents[input.status], updated._id, {
        reason: input.reason,
      });
      return serialize(updated);
    },
    async issueLink(actor: Actor, id: string, context: AuditContext) {
      const employee = await find(actor, id);
      if (
        employee.status === 'SUSPENDED' ||
        (!employee.onboardingPending && employee.status !== 'ACTIVE')
      ) {
        throw new AppError(409, 'Activate this account before issuing a password reset');
      }
      const token = newRefreshToken(id.toLowerCase());
      const expiresAt = new Date(Date.now() + 30 * 60_000);
      const issued = await users.updateOne(
        { ...scope(actor), _id: id, ...revisionFilter(employee.revision ?? 0) },
        {
          $set: { accountSetupHash: refreshHash(token), accountSetupExpires: expiresAt },
        },
      );
      if (!issued.matchedCount)
        throw new AppError(409, 'Employee changed. Reload before issuing a link.');
      await audit(actor, context, 'EMPLOYEE_SETUP_ISSUED', employee._id);
      return { token, expiresAt };
    },
    async redeem(token: string, password: string, context: AuditContext) {
      const pair = {
        role: 'EMPLOYEE' as const,
        _id: token.split('.')[0],
        accountSetupHash: refreshHash(token),
      };
      const eligibility = {
        $or: [
          { status: 'ACTIVE' as const },
          { status: 'INACTIVE' as const, onboardingPending: true },
        ],
      };
      const query = () => ({ ...pair, ...eligibility, accountSetupExpires: { $gt: new Date() } });
      if (!(await users.exists(query()))) throw invalidLink();
      const passwordHash = await passwords.hash(password);
      const employee = await users
        .findOneAndUpdate(
          query(),
          {
            $set: {
              passwordHash,
              passwordChangedAt: new Date(),
              onboardingPending: false,
              status: 'ACTIVE',
            },
            $unset: { accountSetupHash: 1, accountSetupExpires: 1 },
            $inc: { revision: 1, sessionVersion: 1 },
          },
          { returnDocument: 'after' },
        )
        .lean();
      if (!employee) throw invalidLink();
      await revoke(employee._id, employee.sessionVersion);
      await audit(
        { id: employee._id.toString() },
        context,
        'EMPLOYEE_PASSWORD_CHANGED',
        employee._id,
      );
    },
    async stats(actor: Actor) {
      const [counts, departments] = await Promise.all([
        users.aggregate<{ _id: Employee['status']; count: number }>([
          { $match: scope(actor) },
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
        users.distinct('department', scope(actor)),
      ]);
      const count = (status: Employee['status']) =>
        counts.find((row) => row._id === status)?.count ?? 0;
      return {
        totalEmployees: counts.reduce((sum, row) => sum + row.count, 0),
        activeEmployees: count('ACTIVE'),
        inactiveEmployees: count('INACTIVE'),
        suspendedEmployees: count('SUSPENDED'),
        departments: departments.sort(),
      };
    },
    async exportRows(actor: Actor, criteria: EmployeeFilters, context: AuditContext) {
      await audit(actor, context, 'EMPLOYEES_EXPORTED');
      return users
        .find(filter(actor, criteria))
        .select(projection)
        .sort(sort(criteria))
        .lean()
        .cursor();
    },
    async history(actor: Actor, id: string, page: number, limit: number) {
      const employee = await find(actor, id);
      return models.auditLogs
        .find({ entityId: employee._id, entityType: 'EMPLOYEE' })
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select('actorId action requestId metadata createdAt')
        .lean();
    },
  };
}
