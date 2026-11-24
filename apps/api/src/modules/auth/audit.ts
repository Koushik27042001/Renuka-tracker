import { isIP } from 'node:net';
import type { Request } from 'express';
import type { Types } from 'mongoose';
import type { AuditAction } from '../../models/AuditLog.model.js';
import type { Models } from '../../models/index.js';

export type AuditContext = {
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
};

export function auditContext(req: Request): AuditContext {
  const agent = req.get('user-agent') ?? '';
  const userAgent = /Firefox\//i.test(agent)
    ? 'Firefox'
    : /Edg\//i.test(agent)
      ? 'Edge'
      : /Chrome\//i.test(agent)
        ? 'Chrome'
        : /Safari\//i.test(agent)
          ? 'Safari'
          : 'Other';
  return {
    requestId: String(req.id),
    ipAddress: req.ip && isIP(req.ip) ? req.ip : undefined,
    userAgent,
  };
}

export async function recordAudit(
  models: Models,
  context: AuditContext,
  event: {
    action: AuditAction;
    actorId?: Types.ObjectId;
    entityType: 'USER' | 'REFRESH_SESSION' | 'EMPLOYEE' | 'ATTENDANCE' | 'VISIT';
    entityId?: Types.ObjectId;
    reason?: string;
    changedFields?: string[];
  },
) {
  await models.auditLogs.create({
    ...context,
    actorId: event.actorId,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    metadata: { reason: event.reason, changedFields: event.changedFields },
  });
}
