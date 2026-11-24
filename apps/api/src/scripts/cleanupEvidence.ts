import { config as dotenv } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { QueryFilter } from 'mongoose';
import { readConfig } from '../config.js';
import { createLogger } from '../config/logger.js';
import { openDatabase, waitForDatabase } from '../config/database.js';
import { createModels } from '../models/index.js';
import { cloudinaryEvidence } from '../integrations/cloudinary.js';
import type { VisitData } from '../modules/visits/visit.model.js';

dotenv({ quiet: true });
async function main() {
  const args = process.argv.slice(2);
  const setting = args.find((value) => value.startsWith('--retention-days='))?.split('=')[1];
  const days = setting ? z.coerce.number().int().min(1).max(3650).parse(setting) : undefined;
  const apply = args.includes('--apply');
  if (args.some((value) => value !== '--apply' && !value.startsWith('--retention-days=')))
    throw new Error('Invalid cleanup arguments');
  const config = readConfig(process.env);
  const logger = createLogger(config);
  const opening = openDatabase(config, logger);
  try {
    await waitForDatabase(opening.connection, opening.ready);
    const models = createModels(opening.connection);
    const { visits } = models;
    const store = cloudinaryEvidence(config);
    const cutoff = new Date(Date.now() - 15 * 60_000);
    const staleDraft = new Date(Date.now() - 48 * 3600_000);
    const retiredSelector: QueryFilter<VisitData>[] = days
      ? [
          {
            status: { $in: ['APPROVED', 'REJECTED'] },
            reviewedAt: { $lt: new Date(Date.now() - days * 86400_000) },
            evidence: { $ne: null },
          },
        ]
      : [];
    const candidates: QueryFilter<VisitData> = {
      $or: [
        { status: 'DRAFT', uploadClaim: { $ne: null }, uploadStartedAt: { $lt: cutoff } },
        { status: 'DRAFT', uploadClaim: null, discardAt: { $ne: null }, evidence: { $ne: null } },
        { status: 'DRAFT', uploadClaim: null, discardAt: null, updatedAt: { $lt: staleDraft } },
        ...retiredSelector,
      ],
    };
    if (!apply) {
      logger.info(
        { cleanupStatus: 'dry-run' },
        'Eligible evidence cleanup records: ' + (await visits.countDocuments(candidates)),
      );
      return;
    }
    let removed = 0;
    let failures = 0;
    const cursor = visits.find(candidates).lean().cursor();
    try {
      for await (const row of cursor) {
        const retired = row.status !== 'DRAFT';
        const pending = row.uploadClaim?.replace(/^cleanup:/, '');
        const publicId =
          row.evidence?.publicId ??
          (pending && pending !== 'remove'
            ? config.CLOUDINARY_FOLDER + '/' + row._id + '/' + pending
            : undefined);
        const claim = retired ? 'retention' : 'cleanup:' + (pending ?? 'remove');
        const lock = await visits.updateOne(
          {
            _id: row._id,
            status: row.status,
            updatedAt: row.updatedAt,
            ...(retired
              ? { $or: [{ uploadClaim: null }, { uploadStartedAt: { $lt: cutoff } }] }
              : { uploadClaim: row.uploadClaim ?? null }),
          },
          {
            $set: {
              uploadClaim: claim,
              uploadStartedAt: new Date(),
              ...(retired
                ? { evidenceRetiredAt: new Date() }
                : !row.discardAt && row.updatedAt < staleDraft
                  ? { discardAt: new Date() }
                  : {}),
            },
          },
        );
        if (!lock.modifiedCount) continue;
        try {
          if (publicId) await store.remove(publicId);
          await visits.updateOne(
            { _id: row._id, uploadClaim: claim },
            { $unset: { evidence: 1, uploadClaim: 1, uploadStartedAt: 1, uploadFingerprint: 1 } },
          );
          await models.auditLogs.create({
            entityType: 'VISIT',
            entityId: row._id,
            action: 'EVIDENCE_REMOVED',
            requestId: randomUUID(),
            metadata: { reason: retired ? 'Evidence retention' : 'Draft cleanup' },
          });
          removed++;
        } catch {
          failures++;
        }
      }
    } finally {
      await cursor.close();
    }
    logger.info(
      { removed, failures, cleanupStatus: failures ? 'partial' : 'complete' },
      'Cleanup completed: ' + removed + ' records. Retriable failures: ' + failures + '.',
    );
    if (failures) process.exitCode = 1;
  } finally {
    await opening.connection.close();
  }
}
main().catch(() => {
  console.error('Evidence cleanup failed. Check configuration and connection.');
  process.exitCode = 1;
});
