import { Schema, type Connection, type InferSchemaType } from 'mongoose';

const point = new Schema(
  {
    type: { type: String, enum: ['Point'] as const, required: true },
    coordinates: { type: [Number], required: true },
  },
  { _id: false },
);
const schema = new Schema(
  {
    employeeId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    attendanceDate: { type: String, required: true, immutable: true },
    timezone: { type: String, required: true, immutable: true },
    checkInTime: { type: Date, required: true, immutable: true },
    checkInLocation: { type: point, required: true, immutable: true },
    checkInAccuracy: { type: Number, required: true, immutable: true },
    checkInCapturedAt: { type: Date, required: true, immutable: true },
    checkInKey: { type: String, required: true, immutable: true, select: false },
    checkInFingerprint: { type: String, required: true, immutable: true, select: false },
    checkOutTime: Date,
    checkOutDate: String,
    checkOutLocation: point,
    checkOutAccuracy: Number,
    checkOutCapturedAt: Date,
    checkOutKey: { type: String, select: false },
    checkOutFingerprint: { type: String, select: false },
    workingMinutes: Number,
    status: {
      type: String,
      enum: ['CHECKED_IN', 'CHECKED_OUT', 'INCOMPLETE'] as const,
      required: true,
    },
  },
  { timestamps: true, collection: 'attendance' },
);

schema.index(
  { employeeId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'CHECKED_IN' } },
);
schema.index({ employeeId: 1, checkInKey: 1 }, { unique: true });
schema.index(
  { employeeId: 1, checkOutKey: 1 },
  { unique: true, partialFilterExpression: { checkOutKey: { $type: 'string' } } },
);
schema.index({ employeeId: 1, attendanceDate: -1, checkInTime: -1 });
schema.index({ attendanceDate: -1, checkInTime: -1 });
schema.index({ status: 1, checkInTime: 1 });
schema.index({ checkOutDate: 1, employeeId: 1 });

export type AttendanceData = InferSchemaType<typeof schema>;
export function attendanceModel(connection: Connection) {
  return connection.model('Attendance', schema);
}
