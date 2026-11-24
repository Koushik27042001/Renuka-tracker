import { mongo } from 'mongoose';
import type { Models } from '../../models/index.js';

const counterId = 'employee-code';
export async function nextEmployeeCode(models: Models) {
  const counters = models.employeeCounters;
  if (!(await counters.exists({ _id: counterId }))) {
    const [old] = await models.users.aggregate<{ sequence: number }>([
      { $match: { employeeCode: /^EMP\d{1,12}$/ } },
      { $project: { sequence: { $toLong: { $substrBytes: ['$employeeCode', 3, 12] } } } },
      { $group: { _id: null, sequence: { $max: '$sequence' } } },
    ]);
    try {
      await counters.updateOne(
        { _id: counterId },
        {
          $setOnInsert: { sequence: Number(old?.sequence ?? 0) },
        },
        { upsert: true },
      );
    } catch (error) {
      if (!(error instanceof mongo.MongoServerError && error.code === 11000)) throw error;
    }
  }
  const result = await counters
    .findOneAndUpdate(
      { _id: counterId },
      {
        $inc: { sequence: 1 },
      },
      { returnDocument: 'after' },
    )
    .orFail();
  return 'EMP' + String(result.sequence).padStart(4, '0');
}
