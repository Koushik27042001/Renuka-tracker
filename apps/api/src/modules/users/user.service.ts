import type { Types } from 'mongoose';
import type { UserData } from '../../models/User.model.js';

export function publicUser(user: UserData & { _id: Types.ObjectId }) {
  return {
    id: user._id.toString(),
    employeeCode: user.employeeCode,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    department: user.department,
    designation: user.designation,
    role: user.role,
    status: user.status,
    lastLoginAt: user.lastLoginAt ?? null,
  };
}
