import { Schema, type Connection } from 'mongoose';

const refreshSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    sessionVersion: { type: Number, required: true, immutable: true },
    transport: { type: String, enum: ['web', 'mobile'], required: true, immutable: true },
    currentHash: { type: String, required: true, select: false },
    usedHashes: { type: [String], default: [], select: false },
    rotations: { type: Number, required: true, default: 0 },
    expiresAt: { type: Date, required: true, immutable: true },
    revokedAt: Date,
  },
  { timestamps: true, collection: 'refresh_sessions' },
);

refreshSessionSchema.index({ userId: 1, sessionVersion: 1, revokedAt: 1 });
refreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export function refreshSessionModel(connection: Connection) {
  return connection.model('RefreshSession', refreshSessionSchema);
}
