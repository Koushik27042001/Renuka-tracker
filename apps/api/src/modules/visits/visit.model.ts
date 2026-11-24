import { Schema, type Connection, type InferSchemaType } from 'mongoose';

const point = new Schema(
  {
    type: { type: String, enum: ['Point'], required: true },
    coordinates: { type: [Number], required: true },
  },
  { _id: false },
);
const evidence = new Schema({
  _id: { type: Schema.Types.ObjectId, required: true },
  publicId: { type: String, required: true },
  assetId: String,
  key: { type: String, required: true },
  fingerprint: { type: String, required: true },
  sha256: { type: String, required: true },
  width: { type: Number, required: true },
  height: { type: Number, required: true },
  size: { type: Number, required: true },
  point: { type: point, required: true },
  accuracy: { type: Number, required: true },
  capturedAt: { type: Date, required: true },
  locationCapturedAt: { type: Date, required: true },
  uploadedAt: { type: Date, required: true },
  address: String,
  addressProvider: String,
  mockLocation: Boolean,
  originalSha256: String,
  delayed: Boolean,
  enhancedReview: Boolean,
  syncDelaySeconds: Number,
  mimeType: { type: String, required: true, default: 'image/jpeg' },
  watermarkVersion: { type: Number, required: true, default: 1 },
  verificationStatus: { type: String, required: true, default: 'STORED' },
});
const schema = new Schema(
  {
    employeeId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    attendanceId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    draftKey: { type: String, required: true, immutable: true },
    visitDate: { type: String, required: true },
    clientName: { type: String, required: true },
    purpose: { type: String, required: true },
    contactName: String,
    contactPhone: String,
    remarks: String,
    notes: String,
    status: {
      type: String,
      enum: ['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED'] as const,
      required: true,
    },
    evidence,
    draftFingerprint: String,
    offlineCapturedAt: Date,
    uploadFingerprint: String,
    uploadClaim: String,
    uploadStartedAt: Date,
    discardAt: Date,
    evidenceRetiredAt: Date,
    submittedAt: Date,
    reviewedAt: Date,
    reviewedBy: Schema.Types.ObjectId,
    reason: String,
  },
  { timestamps: true, collection: 'field_visits' },
);

schema.index({ employeeId: 1, draftKey: 1 }, { unique: true });
schema.index({ employeeId: 1, visitDate: -1, _id: -1 });
schema.index({ status: 1, visitDate: -1, _id: -1 });
schema.index({ visitDate: -1, _id: -1 });
schema.index({ 'evidence._id': 1 }, { unique: true, sparse: true });
schema.index({ 'evidence.point': '2dsphere' });
schema.index({ status: 1, updatedAt: 1 });

export type VisitData = InferSchemaType<typeof schema>;
export function visitModel(connection: Connection) {
  return connection.model('FieldVisit', schema);
}
