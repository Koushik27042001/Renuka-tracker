import { z } from 'zod';

export const employeeStatuses = ['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const;
export const employeeStatus = z.enum(employeeStatuses);
const label = z.string().trim().min(1).max(120);
const joiningDate = z.union([z.iso.date(), z.literal('')]);
export const employeeFields = {
  fullName: label,
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  phone: z
    .string()
    .trim()
    .regex(
      /^(?:\+[1-9]\d{7,14}|[6-9]\d{9})$/,
      'Enter an international phone number or an Indian mobile number',
    ),
  department: label,
  designation: label,
  dateOfJoining: joiningDate.optional(),
};
export const employeeProfileInput = z.strictObject(employeeFields);
export const employeeProfilePatch = z
  .strictObject({
    ...employeeProfileInput.partial().shape,
    revision: z.number().int().nonnegative(),
  })
  .refine((value) => Object.keys(value).length > 1, 'Enter at least one change');
export const employeeStatusInput = z
  .strictObject({
    status: employeeStatus,
    reason: z.string().trim().min(3).max(240).optional(),
    revision: z.number().int().nonnegative(),
  })
  .refine((value) => value.status === 'ACTIVE' || !!value.reason, {
    path: ['reason'],
    message: 'Enter a reason',
  });

export type EmployeeStatus = z.infer<typeof employeeStatus>;
export type EmployeeInput = z.input<typeof employeeProfileInput>;
export type Employee = Omit<EmployeeInput, 'dateOfJoining'> & {
  id: string;
  employeeCode: string;
  role: 'EMPLOYEE';
  status: EmployeeStatus;
  revision: number;
  onboardingPending: boolean;
  dateOfJoining: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EmployeeStats = {
  totalEmployees: number;
  activeEmployees: number;
  inactiveEmployees: number;
  suspendedEmployees: number;
  departments: string[];
};
export type EmployeeList = {
  employees: Employee[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
};

export const accountSetupInput = z.strictObject({
  token: z.string().regex(/^[a-f0-9]{24}\.[A-Za-z0-9_-]{43}$/),
  password: z
    .string()
    .min(12, 'Use at least 12 characters')
    .max(128)
    .refine((value) => /\S/.test(value)),
});
