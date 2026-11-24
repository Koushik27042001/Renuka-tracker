import { z } from 'zod';
import { employeeStatus } from '@renuka/shared';
import { objectId } from '../users/user.validation.js';

export const employeeParams = z.strictObject({ id: objectId });
const filterFields = {
  search: z.string().trim().min(1).max(80).optional(),
  department: z.string().trim().min(1).max(120).optional(),
  designation: z.string().trim().min(1).max(120).optional(),
  status: employeeStatus.optional(),
  sortBy: z.enum(['fullName', 'employeeCode', 'createdAt', 'dateOfJoining']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
};
export const exportQuery = z.strictObject(filterFields);
export const listQuery = z.strictObject({
  ...filterFields,
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});
export type EmployeeFilters = z.output<typeof exportQuery>;
