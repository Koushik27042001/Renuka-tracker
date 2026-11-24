import type { Config } from '../../config.js';
import type { Models } from '../../models/index.js';
import { AppError } from '../../middleware/errors.js';

export async function offlineShift(
  models: Models,
  config: Config,
  employeeId: string,
  attendanceId: string,
  capture: Date,
  now: Date,
) {
  if (!config.OFFLINE_VISITS_ENABLED || !config.OFFLINE_EVIDENCE_ENABLED)
    throw new AppError(403, 'Offline evidence is disabled by company policy.');
  const age = now.getTime() - capture.getTime();
  if (age < -5000 || age > config.OFFLINE_EVIDENCE_MAX_DELAY_HOURS * 3600_000)
    throw new AppError(422, 'This capture is outside the permitted offline upload window.');
  const shift = await models.attendance
    .findOne({
      _id: attendanceId,
      employeeId,
      status: { $in: ['CHECKED_IN', 'CHECKED_OUT'] },
    })
    .select('checkInTime checkOutTime timezone')
    .lean();
  const start = shift?.checkInTime.getTime();
  if (
    !shift ||
    start === undefined ||
    capture.getTime() < start ||
    capture.getTime() >
      Math.min(
        start + config.ATTENDANCE_MAX_SHIFT_HOURS * 3600_000,
        shift.checkOutTime?.getTime() ?? now.getTime() + 5000,
      )
  ) {
    throw new AppError(
      422,
      'This capture does not fall within your server-recorded attendance session.',
    );
  }
  return shift;
}
