import { z } from 'zod';
import { attendanceLocation } from './attendance.js';
export const visitStatus = z.enum(['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED']);
const optional = (length: number) => z.string().trim().max(length).optional();
export const visitInput = z.strictObject({
  visitDate: z.iso.date(),
  clientName: z.string().trim().min(1).max(120),
  purpose: z.string().trim().min(1).max(240),
  contactName: optional(120),
  contactPhone: z
    .string()
    .trim()
    .regex(/^(?:\+?[0-9 ()-]{7,24})?$/)
    .optional(),
  remarks: optional(500),
  notes: optional(1000),
});
export const evidenceInput = z.strictObject({
  location: attendanceLocation,
  capturedAt: z.iso.datetime(),
  key: z.uuid(),
  mockLocation: z.boolean().optional(),
  source: z.literal('gallery').optional(),
  originalSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
export type VisitInput = z.infer<typeof visitInput>;
export type VisitStatus = z.infer<typeof visitStatus>;
export type VisitEvidence = {
  id: string;
  longitude: number;
  latitude: number;
  accuracy: number;
  locationCapturedAt: string;
  capturedAt: string;
  uploadedAt: string;
  address: string | null;
  addressProvider: string | null;
  sha256: string;
  width: number;
  height: number;
  size: number;
  mimeType: 'image/jpeg';
  watermarkVersion: number;
  mockLocation: boolean;
  source?: 'gallery';
  delayed?: boolean;
  enhancedReview?: boolean;
  syncDelaySeconds?: number;
  verificationStatus: 'STORED';
};
export type Visit = VisitInput & {
  id: string;
  code: string;
  status: VisitStatus;
  employeeId: string;
  attendanceId: string;
  employee?: { fullName: string; employeeCode: string; department: string };
  submittedAt?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reason?: string;
  evidence?: VisitEvidence;
};
export type VisitPage = { visits: Visit[]; total: number; page: number; limit: number };
