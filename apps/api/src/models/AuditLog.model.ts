import { Schema, type Connection } from 'mongoose';

export const auditActions = [
  'LOGIN_SUCCEEDED',
  'LOGIN_FAILED',
  'LOGOUT',
  'LOGOUT_ALL',
  'REFRESH_REUSED',
  'SUPER_ADMIN_BOOTSTRAPPED',
  'ACCOUNT_SUSPENDED',
  'ADMIN_ACTION',
  'EMPLOYEE_CREATED',
  'EMPLOYEE_UPDATED',
  'EMPLOYEE_ACTIVATED',
  'EMPLOYEE_DEACTIVATED',
  'EMPLOYEE_SUSPENDED',
  'EMPLOYEE_SETUP_ISSUED',
  'EMPLOYEE_PASSWORD_CHANGED',
  'EMPLOYEES_EXPORTED',
  'ATTENDANCE_CHECKED_IN',
  'ATTENDANCE_CHECKED_OUT',
  'ATTENDANCE_DUPLICATE',
  'ATTENDANCE_EXPORTED',
  'ATTENDANCE_VIEWED',
  'VISIT_DRAFT_CREATED',
  'VISIT_SUBMITTED',
  'VISIT_APPROVED',
  'VISIT_REJECTED',
  'VISITS_EXPORTED',
  'EVIDENCE_STORED',
  'EVIDENCE_VIEWED',
  'EVIDENCE_VERIFIED',
  'EVIDENCE_REMOVED',
  'ANALYTICS_EXPORTED',
] as const;
export type AuditAction = (typeof auditActions)[number];

const auditSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, immutable: true },
    action: { type: String, enum: auditActions, required: true, immutable: true },
    entityType: {
      type: String,
      enum: ['USER', 'REFRESH_SESSION', 'EMPLOYEE', 'ATTENDANCE', 'VISIT'],
      required: true,
      immutable: true,
    },
    entityId: { type: Schema.Types.ObjectId, immutable: true },
    requestId: { type: String, required: true, immutable: true },
    ipAddress: { type: String, immutable: true },
    userAgent: { type: String, immutable: true },
    metadata: {
      reason: { type: String, maxlength: 240, immutable: true },
      changedFields: { type: [String], default: undefined, immutable: true },
    },
    createdAt: { type: Date, required: true, default: Date.now, immutable: true },
  },
  { collection: 'audit_logs' },
);

auditSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 86400 });
auditSchema.index({ actorId: 1, createdAt: -1 });
auditSchema.index({ action: 1, createdAt: -1 });
auditSchema.index({ entityId: 1, createdAt: -1 });

export function auditLogModel(connection: Connection) {
  return connection.model('AuditLog', auditSchema);
}
