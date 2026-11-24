import { z } from 'zod';
import { employeeCodePattern, phonePattern } from '../../models/User.model.js';

export const objectId = z.string().regex(/^[a-f0-9]{24}$/i);
export const userParams = z.strictObject({ userId: objectId });
export const pagination = z.strictObject({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export const newPassword = z
  .string()
  .min(12)
  .max(128)
  .refine((value) => /\S/.test(value));
export const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
export const employeeCode = z.string().trim().toUpperCase().regex(employeeCodePattern);
export const fullName = z.string().trim().min(1).max(120);
export const phone = z.string().trim().regex(phonePattern);
const profileFields = {
  fullName,
  email,
  phone,
  department: fullName,
  designation: fullName,
};
export const createEmployee = z.strictObject({
  ...profileFields,
  employeeCode,
  password: newPassword,
});
export const updateProfile = z
  .strictObject(profileFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0);
