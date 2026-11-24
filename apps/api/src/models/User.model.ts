import { Schema, type Connection, type InferSchemaType } from 'mongoose';

export const roles = ['SUPER_ADMIN', 'ADMIN', 'EMPLOYEE'] as const;
export const statuses = ['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const;
export type Role = (typeof roles)[number];
export const phonePattern = /^\+[1-9]\d{7,14}$/;
export const employeeCodePattern = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;

const userSchema = new Schema(
  {
    employeeCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      match: employeeCodePattern,
    },
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },
    phone: { type: String, required: true, trim: true, match: phonePattern },
    department: { type: String, required: true, trim: true, maxlength: 120 },
    designation: { type: String, required: true, trim: true, maxlength: 120 },
    role: { type: String, enum: roles, required: true, default: 'EMPLOYEE' },
    passwordHash: { type: String, required: true, select: false, match: /^\$argon2id\$/ },
    status: { type: String, enum: statuses, required: true, default: 'ACTIVE' },
    dateOfJoining: Date,
    onboardingPending: Boolean,
    accountSetupHash: { type: String, select: false },
    accountSetupExpires: { type: Date, select: false },
    revision: { type: Number, default: 0 },
    lastLoginAt: Date,
    passwordChangedAt: { type: Date, required: true, default: Date.now },
    sessionVersion: { type: Number, required: true, default: 0, min: 0 },
    bootstrap: { type: Boolean, select: false, immutable: true },
  },
  { timestamps: true, collection: 'users' },
);

userSchema.index({ employeeCode: 1 }, { unique: true });
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ bootstrap: 1 }, { unique: true, partialFilterExpression: { bootstrap: true } });
userSchema.index({ role: 1, status: 1 });
userSchema.index({ role: 1, department: 1, status: 1, createdAt: -1 });
userSchema.index({ role: 1, createdAt: -1 });

export type UserData = InferSchemaType<typeof userSchema>;
export function userModel(connection: Connection) {
  return connection.model('User', userSchema);
}
