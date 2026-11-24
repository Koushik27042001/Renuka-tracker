import { Router, type Request, type RequestHandler } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { attendanceSubmission, checkoutSubmission } from '@renuka/shared';
import { requireAuth } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/errors.js';
import { limiter } from '../../middleware/rateLimiter.js';
import { validateRequest } from '../../middleware/validateRequest.js';
import { success } from '../auth/auth.controller.js';
import { auditContext } from '../auth/audit.js';
import { csvCell } from '../employees/employee.routes.js';
import {
  attendanceExport,
  attendanceId,
  attendanceList,
  historyQuery,
} from './attendance.validation.js';
import type { attendanceService } from './attendance.service.js';

function actor(req: Request) {
  const user = requireAuth(req);
  if (user.role === 'ADMIN' && !req.authDepartment)
    throw new AppError(403, 'Administrative department is required');
  return { id: user.sub, department: user.role === 'ADMIN' ? req.authDepartment : undefined };
}

export function attendanceRoutes(
  service: ReturnType<typeof attendanceService>,
  authenticate: RequestHandler,
) {
  const routes = Router();
  routes.use(authenticate);
  const employee = authorize('EMPLOYEE');
  const admin = authorize('ADMIN', 'SUPER_ADMIN');
  const submissionLimit = limiter(20, 60_000);
  routes.post(
    '/check-in',
    employee,
    submissionLimit,
    validateRequest({ body: attendanceSubmission }, async ({ body }, req, res) => {
      const result = await service.checkIn(requireAuth(req).sub, body, auditContext(req));
      success(res.status(result.replayed ? 200 : 201), 'Check-in confirmed', result);
    }),
  );
  routes.post(
    '/check-out',
    employee,
    submissionLimit,
    validateRequest({ body: checkoutSubmission }, async ({ body }, req, res) => {
      success(
        res,
        'Checkout confirmed',
        await service.checkOut(requireAuth(req).sub, body, auditContext(req)),
      );
    }),
  );
  routes.get('/me/current', employee, async (req, res) =>
    success(res, 'Attendance retrieved', await service.current(requireAuth(req).sub)),
  );
  routes.get(
    '/me/history',
    employee,
    validateRequest({ query: historyQuery }, async ({ query }, req, res) => {
      success(res, 'Attendance retrieved', await service.history(requireAuth(req).sub, query));
    }),
  );
  routes.get(
    '/me/:id',
    employee,
    validateRequest({ params: attendanceId }, async ({ params }, req, res) => {
      success(res, 'Attendance record retrieved', {
        attendance: await service.ownDetail(requireAuth(req).sub, params.id),
      });
    }),
  );
  routes.get('/stats', admin, async (req, res) =>
    success(res, 'Statistics retrieved', await service.stats(actor(req))),
  );
  routes.get(
    '/export',
    admin,
    limiter(15, 60_000),
    validateRequest({ query: attendanceExport }, async ({ query }, req, res) => {
      const rows = await service.exportRows(actor(req), query, auditContext(req));
      res.type('text/csv').attachment('attendance.csv');
      async function* csv() {
        yield '\uFEFFEmployee Code,Employee Name,Department,Attendance Date,Check-in Time,Checkout Time,Working Minutes,Status\r\n';
        for await (const row of rows) {
          yield (
            [
              row.employee?.employeeCode,
              row.employee?.fullName,
              row.employee?.department,
              row.attendanceDate,
              row.checkInTime,
              row.checkOutTime,
              row.workingMinutes,
              row.status,
            ]
              .map(csvCell)
              .join(',') + '\r\n'
          );
        }
      }
      await pipeline(Readable.from(csv()), res);
    }),
  );
  routes.get(
    '/',
    admin,
    validateRequest({ query: attendanceList }, async ({ query }, req, res) => {
      success(res, 'Attendance retrieved', await service.list(actor(req), query));
    }),
  );
  routes.get(
    '/:id',
    admin,
    validateRequest({ params: attendanceId }, async ({ params }, req, res) => {
      success(res, 'Attendance record retrieved', {
        attendance: await service.adminDetail(actor(req), params.id, auditContext(req)),
      });
    }),
  );
  return routes;
}
