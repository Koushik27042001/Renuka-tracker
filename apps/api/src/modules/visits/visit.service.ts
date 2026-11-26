import { createHash } from 'node:crypto';
import { mongo, Types, type QueryFilter } from 'mongoose';
import { z } from 'zod';
import {
  visitInput,
  visitStatus,
  evidenceInput,
  type Visit,
  type VisitInput,
} from '@renuka/shared';
import type { Config } from '../../config.js';
import { AppError } from '../../middleware/errors.js';
import type { Models } from '../../models/index.js';
import { imageHash, maxImageBytes, watermarkImage } from '../../integrations/evidenceImage.js';
import type { EvidenceStore } from '../../integrations/cloudinary.js';
import { recordAudit, type AuditContext } from '../auth/audit.js';
import { offlineShift } from './offlinePolicy.js';
import type { VisitData } from './visit.model.js';

const date = { from: z.iso.date().optional(), to: z.iso.date().optional() };
export const visitFilters = z
  .strictObject({
    ...date,
    client: z.string().trim().min(1).max(120).optional(),
    search: z.string().trim().min(1).max(80).optional(),
    department: z.string().trim().min(1).max(120).optional(),
    employeeId: z
      .string()
      .regex(/^[a-f0-9]{24}$/i)
      .optional(),
    status: visitStatus.optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to);
export const draftInput = visitInput.extend({
  key: z.uuid(),
  offline: z
    .strictObject({
      attendanceId: z.string().regex(/^[a-f0-9]{24}$/i),
      capturedAt: z.iso.datetime(),
    })
    .optional(),
});
export type VisitFilters = z.output<typeof visitFilters>;
export type VisitActor = {
  id: string;
  role: 'EMPLOYEE' | 'ADMIN' | 'SUPER_ADMIN';
  department?: string;
};
type Row = VisitData & { _id: Types.ObjectId };
const missing = () => new AppError(404, 'Visit or evidence not found.');
const conflict = (message = 'The visit changed. Reload it and try again.') =>
  new AppError(409, message);
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const iso = (date?: Date | null) => date?.toISOString();
export function dayFormat(zone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}
export async function scopedEmployees(
  models: Models,
  actor: VisitActor,
  filters: { department?: string; employeeId?: string; search?: string } = {},
) {
  if (actor.role === 'ADMIN' && !actor.department)
    throw new AppError(403, 'Administrative department is required.');
  const search = filters.search ? new RegExp('^' + escape(filters.search), 'i') : undefined;
  return models.users
    .find({
      role: 'EMPLOYEE',
      ...(actor.role === 'ADMIN' ? { department: actor.department } : {}),
      ...(filters.department ? { $and: [{ department: filters.department }] } : {}),
      ...(filters.employeeId ? { _id: filters.employeeId } : {}),
      ...(search
        ? { $or: [{ fullName: search }, { employeeCode: search }, { email: search }] }
        : {}),
    })
    .select('fullName employeeCode department status')
    .lean();
}
export function serializeVisit(
  row: Row,
  employee?: Visit['employee'],
  includeEvidence = true,
): Visit {
  const evidence = row.evidenceRetiredAt ? undefined : row.evidence;
  return {
    id: row._id.toString(),
    code: 'VIS-' + row._id.toString().toUpperCase(),
    status: row.status,
    employeeId: row.employeeId.toString(),
    attendanceId: row.attendanceId.toString(),
    employee,
    visitDate: row.visitDate,
    clientName: row.clientName,
    purpose: row.purpose,
    contactName: row.contactName ?? undefined,
    contactPhone: row.contactPhone ?? undefined,
    remarks: row.remarks ?? undefined,
    notes: row.notes ?? undefined,
    submittedAt: iso(row.submittedAt),
    reviewedAt: iso(row.reviewedAt),
    reviewedBy: row.reviewedBy?.toString(),
    reason: row.reason ?? undefined,
    evidence:
      includeEvidence && evidence
        ? {
            id: evidence._id.toString(),
            longitude: evidence.point.coordinates[0],
            latitude: evidence.point.coordinates[1],
            accuracy: evidence.accuracy,
            locationCapturedAt: evidence.locationCapturedAt.toISOString(),
            capturedAt: evidence.capturedAt.toISOString(),
            uploadedAt: evidence.uploadedAt.toISOString(),
            address: evidence.address ?? null,
            addressProvider: evidence.addressProvider ?? null,
            width: evidence.width,
            height: evidence.height,
            size: evidence.size,
            sha256: evidence.sha256,
            delayed: !!evidence.delayed,
            enhancedReview: !!evidence.enhancedReview,
            syncDelaySeconds: evidence.syncDelaySeconds ?? undefined,
            mimeType: 'image/jpeg',
            watermarkVersion: evidence.watermarkVersion,
            mockLocation: !!evidence.mockLocation,
            ...(evidence.source === 'gallery' && { source: evidence.source }),
            verificationStatus: 'STORED',
          }
        : undefined,
  };
}
export function visitService(
  models: Models,
  config: Config,
  store: EvidenceStore,
  reverse: (
    lat: number,
    lon: number,
    accuracy: number,
  ) => Promise<{ address: string | null; provider: string | null }>,
) {
  const { visits } = models;
  const day = dayFormat(config.BUSINESS_TIMEZONE);
  const activeShift = (employeeId: string, now: Date) =>
    models.attendance
      .findOne({
        employeeId,
        status: 'CHECKED_IN',
        checkInTime: {
          $gt: new Date(now.getTime() - config.ATTENDANCE_MAX_SHIFT_HOURS * 3600_000),
        },
      })
      .lean();
  const own = (actor: VisitActor, id: string) => ({
    _id: id,
    employeeId: actor.id,
    discardAt: null,
  });
  const draft = (actor: VisitActor, id: string) => ({
    ...own(actor, id),
    status: 'DRAFT' as const,
  });
  async function audit(
    actor: VisitActor,
    context: AuditContext,
    action: Parameters<typeof recordAudit>[2]['action'],
    entityId?: Types.ObjectId,
    reason?: string,
  ) {
    await recordAudit(models, context, {
      actorId: new Types.ObjectId(actor.id),
      action,
      entityId,
      entityType: 'VISIT',
      reason,
    });
  }
  async function allowed(actor: VisitActor, row: Row) {
    if (actor.role === 'EMPLOYEE') {
      if (row.employeeId.toString() !== actor.id) throw missing();
      return;
    }
    if (row.status === 'DRAFT') throw missing();
    const [employee] = await scopedEmployees(models, actor, {
      employeeId: row.employeeId.toString(),
    });
    if (!employee) throw missing();
    return employee;
  }
  async function makeReport(actor: VisitActor, filters: VisitFilters) {
    const match: QueryFilter<VisitData> = { discardAt: null };
    const directory = new Map<string, Visit['employee']>();
    if (actor.role === 'EMPLOYEE') match.employeeId = new Types.ObjectId(actor.id);
    else {
      const employees = await scopedEmployees(models, actor, filters);
      match.employeeId = { $in: employees.map((employee) => employee._id) };
      match.status = { $ne: 'DRAFT' };
      for (const employee of employees) directory.set(employee._id.toString(), employee);
    }
    if (filters.status)
      match.status =
        actor.role !== 'EMPLOYEE' && filters.status === 'DRAFT' ? { $in: [] } : filters.status;
    if (filters.from || filters.to)
      match.visitDate = {
        ...(filters.from ? { $gte: filters.from } : {}),
        ...(filters.to ? { $lte: filters.to } : {}),
      };
    const client = filters.client ?? (actor.role === 'EMPLOYEE' ? filters.search : undefined);
    if (client) match.clientName = new RegExp('^' + escape(client), 'i');
    return { match, directory };
  }
  async function findEvidence(actor: VisitActor, id: string, context: AuditContext) {
    const row = await visits
      .findOne({ 'evidence._id': id, discardAt: null, evidenceRetiredAt: null })
      .lean();
    if (!row?.evidence) throw missing();
    await allowed(actor, row);
    await audit(actor, context, 'EVIDENCE_VIEWED', row._id);
    return row;
  }
  return {
    async create(
      actor: VisitActor,
      { key, offline, ...input }: z.output<typeof draftInput>,
      context: AuditContext,
    ) {
      const draftFingerprint = createHash('sha256')
        .update(JSON.stringify({ input, offline }))
        .digest('hex');
      function replay(row: Row) {
        if (row.discardAt || (row.draftFingerprint && row.draftFingerprint !== draftFingerprint))
          throw conflict('This draft key is already assigned to a different or discarded request.');
        return serializeVisit(row);
      }
      const prior = await visits.findOne({ employeeId: actor.id, draftKey: key }).lean();
      if (prior) return replay(prior);
      const now = new Date();
      const capture = offline ? new Date(offline.capturedAt) : undefined;
      const shift =
        offline && capture
          ? await offlineShift(models, config, actor.id, offline.attendanceId, capture, now)
          : await activeShift(actor.id, now);
      const businessDate =
        capture && shift ? dayFormat(shift.timezone).format(capture) : day.format(now);
      if (input.visitDate !== businessDate)
        throw new AppError(400, 'Use the business date of the original capture.');
      if (!shift) throw conflict('Check in before creating a visit.');
      try {
        const row = await visits.create({
          ...input,
          employeeId: actor.id,
          attendanceId: shift._id,
          draftKey: key,
          draftFingerprint,
          offlineCapturedAt: capture,
          status: 'DRAFT',
        });
        await audit(actor, context, 'VISIT_DRAFT_CREATED', row._id);
        return serializeVisit(row);
      } catch (error) {
        if (error instanceof mongo.MongoServerError && error.code === 11000) {
          const row = await visits.findOne({ employeeId: actor.id, draftKey: key }).lean();
          if (row) return replay(row);
        }
        throw error;
      }
    },
    async edit(actor: VisitActor, id: string, input: VisitInput) {
      const row = await visits.findOne(draft(actor, id)).lean();
      if (!row) throw missing();
      if (row.visitDate !== input.visitDate) throw conflict('The reserved visit date is fixed.');
      const updated = await visits
        .findOneAndUpdate(draft(actor, id), { $set: input }, { returnDocument: 'after' })
        .lean();
      if (!updated) throw conflict();
      return serializeVisit(updated);
    },
    async detail(actor: VisitActor, id: string) {
      const row = await visits.findOne({ _id: id, discardAt: null }).lean();
      if (!row) throw missing();
      return serializeVisit(row, await allowed(actor, row));
    },
    report: makeReport,
    async list(actor: VisitActor, filters: VisitFilters) {
      const { match, directory } = await makeReport(actor, filters);
      const [rows, total] = await Promise.all([
        visits
          .find(match)
          .sort({ visitDate: -1, _id: -1 })
          .skip((filters.page - 1) * filters.limit)
          .limit(filters.limit)
          .lean(),
        visits.countDocuments(match),
      ]);
      return {
        visits: rows.map((row) => serializeVisit(row, directory.get(row.employeeId.toString()))),
        total,
        page: filters.page,
        limit: filters.limit,
      };
    },
    async upload(
      actor: VisitActor,
      id: string,
      input: z.output<typeof evidenceInput>,
      bytes: Buffer,
      context: AuditContext,
    ) {
      const row = await visits.findOne(own(actor, id)).lean();
      if (!row) throw missing();
      if (input.originalSha256 && imageHash(bytes) !== input.originalSha256)
        throw new AppError(422, 'The photo differs from its saved checksum.');
      if (row.offlineCapturedAt && !input.originalSha256)
        throw new AppError(422, 'An original image checksum is required for offline evidence.');
      const fingerprint = createHash('sha256')
        .update(bytes)
        .update(JSON.stringify(input))
        .digest('hex');
      if (row.evidence?.key === input.key && row.evidence.fingerprint === fingerprint)
        return serializeVisit(row);
      if (row.status !== 'DRAFT' || row.evidence)
        throw conflict('Remove the previous draft evidence before retaking.');
      const now = new Date();
      const maxAge = config.ATTENDANCE_MAX_LOCATION_AGE_SECONDS * 1000;
      const capture = new Date(input.capturedAt);
      const locationTime = new Date(input.location.capturedAt);
      const delay = now.getTime() - capture.getTime();
      const delayed = delay > 5 * 60_000;
      const offline = !!row.offlineCapturedAt;
      if (offline && input.source === 'gallery')
        throw new AppError(422, 'Offline visit evidence requires a camera selfie.');
      const shift = offline
        ? await offlineShift(models, config, actor.id, row.attendanceId.toString(), capture, now)
        : await activeShift(actor.id, now);
      const captureDay = offline && shift ? dayFormat(shift.timezone) : day;
      if (offline && row.offlineCapturedAt?.getTime() !== capture.getTime())
        throw new AppError(422, 'The photo timestamp differs from the reserved offline capture.');
      if (
        (!offline && delayed) ||
        capture.getTime() - now.getTime() > 5000 ||
        locationTime.getTime() - now.getTime() > 5000 ||
        Math.abs(locationTime.getTime() - capture.getTime()) > maxAge ||
        input.location.accuracy > config.ATTENDANCE_MAX_ACCURACY ||
        captureDay.format(capture) !== row.visitDate
      ) {
        throw new AppError(
          422,
          input.source === 'gallery'
            ? 'Select the photo again to get a fresh, accurate GPS fix for this visit date.'
            : 'Capture a new selfie with a fresh, accurate GPS fix for this visit date.',
        );
      }
      // Preserve the shift selected by the online or delayed-upload policy above.
      if (
        !shift ||
        !shift._id.equals(row.attendanceId) ||
        capture.getTime() < shift.checkInTime.getTime() - 5000
      )
        throw conflict('An active attendance session is required to store evidence.');
      const user = await models.users
        .findById(actor.id)
        .select('employeeCode fullName')
        .lean()
        .orFail();
      const recovering =
        row.uploadClaim === input.key &&
        row.uploadFingerprint === fingerprint &&
        !!row.uploadStartedAt &&
        now.getTime() - row.uploadStartedAt.getTime() >= 120_000;
      if (
        row.uploadClaim === input.key &&
        row.uploadFingerprint &&
        row.uploadFingerprint !== fingerprint
      )
        throw conflict('This upload key is assigned to a different photo.');
      const claimed = await visits.updateOne(
        {
          ...draft(actor, id),
          evidence: null,
          ...(recovering
            ? { uploadClaim: input.key, uploadStartedAt: row.uploadStartedAt }
            : { uploadClaim: null }),
        },
        { $set: { uploadClaim: input.key, uploadStartedAt: now, uploadFingerprint: fingerprint } },
      );
      if (!claimed.modifiedCount)
        throw new AppError(503, 'Evidence processing is pending. Retry the same upload shortly.');
      const publicId = config.CLOUDINARY_FOLDER + '/' + id.toLowerCase() + '/' + input.key;
      let storageStarted = recovering;
      try {
        if (recovering) {
          await store.remove(publicId);
          storageStarted = false;
        }
        const { latitude, longitude, accuracy } = input.location;
        const address = await reverse(latitude, longitude, accuracy);
        const rendered = await watermarkImage(bytes, [
          'FIELDFORCE CRM',
          user.employeeCode + ' · ' + user.fullName,
          latitude.toFixed(6) +
            ', ' +
            longitude.toFixed(6) +
            ' · GPS ±' +
            Math.round(accuracy) +
            ' m',
          address.address
            ? (accuracy > 50 ? 'Approximate area: ' : 'Mapped address: ') + address.address
            : 'Address unavailable',
          ...(address.address && config.GEOCODING_ATTRIBUTION ? [config.GEOCODING_ATTRIBUTION] : []),
          (input.source === 'gallery' ? 'Gallery photo attached ' : 'Captured ') +
            new Intl.DateTimeFormat('en-IN', {
              timeZone: config.BUSINESS_TIMEZONE,
              dateStyle: 'medium',
              timeStyle: 'short',
            }).format(capture) +
            ' ' +
            config.BUSINESS_TIMEZONE,
          'Visit VIS-' + row._id.toString().toUpperCase(),
        ]);
        storageStarted = true;
        const asset = await store.upload(publicId, rendered.bytes);
        const saved = await visits
          .findOneAndUpdate(
            { ...draft(actor, id), uploadClaim: input.key },
            {
              $set: {
                evidence: {
                  _id: new Types.ObjectId(),
                  ...asset,
                  key: input.key,
                  fingerprint,
                  sha256: rendered.sha256,
                  width: rendered.width,
                  height: rendered.height,
                  size: rendered.bytes.length,
                  point: { type: 'Point', coordinates: [longitude, latitude] },
                  accuracy,
                  capturedAt: capture,
                  locationCapturedAt: locationTime,
                  uploadedAt: new Date(),
                  address: address.address,
                  addressProvider: address.provider,
                  mockLocation: input.mockLocation ?? false,
                  source: input.source,
                  originalSha256: input.originalSha256,
                  delayed,
                  enhancedReview: delayed || (offline && config.OFFLINE_EVIDENCE_REQUIRES_REVIEW),
                  syncDelaySeconds: Math.max(0, Math.round(delay / 1000)),
                  mimeType: 'image/jpeg',
                  watermarkVersion: 1,
                  verificationStatus: 'STORED',
                },
              },
              $unset: { uploadClaim: 1, uploadStartedAt: 1, uploadFingerprint: 1 },
            },
            { returnDocument: 'after' },
          )
          .lean();
        if (!saved) throw conflict();
        await audit(actor, context, 'EVIDENCE_STORED', row._id);
        return serializeVisit(saved);
      } catch (error) {
        // Once a remote write has been attempted, keep the durable claim for cleanup.
        if (!storageStarted)
          await visits.updateOne(
            { _id: id, uploadClaim: input.key },
            { $unset: { uploadClaim: 1, uploadStartedAt: 1, uploadFingerprint: 1 } },
          );
        throw error;
      }
    },
    async discard(actor: VisitActor, id: string, removeOnly: boolean, context: AuditContext) {
      const row = await visits
        .findOneAndUpdate(
          {
            _id: id,
            employeeId: actor.id,
            status: 'DRAFT',
            uploadClaim: null,
            ...(removeOnly ? { discardAt: null } : {}),
          },
          {
            $set: {
              ...(removeOnly
                ? { uploadClaim: 'remove', uploadStartedAt: new Date() }
                : { discardAt: new Date() }),
            },
          },
          { returnDocument: 'after' },
        )
        .lean();
      if (!row)
        throw conflict('The draft is unavailable or its evidence is still being processed.');
      if (row.evidence) await store.remove(row.evidence.publicId);
      await visits.updateOne(
        {
          _id: id,
          status: 'DRAFT',
          ...(removeOnly ? { uploadClaim: 'remove' } : { discardAt: { $ne: null } }),
        },
        { $unset: { evidence: 1, uploadClaim: 1, uploadStartedAt: 1, uploadFingerprint: 1 } },
      );
      if (row.evidence) await audit(actor, context, 'EVIDENCE_REMOVED', row._id);
    },
    async submit(actor: VisitActor, id: string, context: AuditContext) {
      const row = await visits.findOne(own(actor, id)).lean();
      if (!row) throw missing();
      if (row.status !== 'DRAFT') return serializeVisit(row);
      if (!row.evidence)
        throw conflict('Store and review the watermarked photo before submitting.');
      const shift = await activeShift(actor.id, new Date());
      if (!row.offlineCapturedAt && (!shift || !shift._id.equals(row.attendanceId)))
        throw conflict('Check in and submit the visit during its attendance session.');
      const updated = await visits
        .findOneAndUpdate(
          { ...draft(actor, id), uploadClaim: null, 'evidence._id': row.evidence._id },
          { $set: { status: 'PENDING_REVIEW', submittedAt: new Date() } },
          { returnDocument: 'after' },
        )
        .lean();
      if (!updated) {
        const current = await visits
          .findOne({ ...own(actor, id), status: { $ne: 'DRAFT' } })
          .lean();
        if (current) return serializeVisit(current);
        throw conflict();
      }
      await audit(actor, context, 'VISIT_SUBMITTED', row._id);
      return serializeVisit(updated);
    },
    async review(
      actor: VisitActor,
      id: string,
      approved: boolean,
      reason: string | undefined,
      context: AuditContext,
    ) {
      const row = await visits.findById(id).lean();
      if (!row) throw missing();
      const employee = await allowed(actor, row);
      const updated = await visits
        .findOneAndUpdate(
          { _id: id, status: 'PENDING_REVIEW' },
          {
            $set: {
              status: approved ? 'APPROVED' : 'REJECTED',
              reviewedBy: actor.id,
              reviewedAt: new Date(),
              reason,
            },
          },
          { returnDocument: 'after' },
        )
        .lean();
      if (!updated) throw conflict('This visit has already been reviewed.');
      await audit(actor, context, approved ? 'VISIT_APPROVED' : 'VISIT_REJECTED', row._id, reason);
      return serializeVisit(updated, employee);
    },
    async evidence(actor: VisitActor, id: string, context: AuditContext) {
      const row = await findEvidence(actor, id, context);
      return serializeVisit(row).evidence!;
    },
    async image(actor: VisitActor, id: string, context: AuditContext, verify: boolean) {
      const row = await findEvidence(actor, id, context);
      const asset = row.evidence!;
      const response = await store.read(asset.publicId);
      const reader = response.body?.getReader();
      if (!reader) throw new AppError(503, 'Evidence unavailable.');
      const chunks: Buffer[] = [];
      let total = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxImageBytes)
            throw new AppError(503, 'Stored evidence exceeds the allowed size.');
          chunks.push(Buffer.from(value));
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      const bytes = Buffer.concat(chunks, total);
      if (!verify) return { bytes };
      const matches = imageHash(bytes) === asset.sha256;
      await audit(actor, context, 'EVIDENCE_VERIFIED', row._id);
      return { matches };
    },
  };
}
