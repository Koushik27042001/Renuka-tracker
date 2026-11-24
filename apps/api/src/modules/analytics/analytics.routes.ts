import { Router, type RequestHandler } from 'express';

import { authorize } from '../../middleware/authorize.js';
import { limiter } from '../../middleware/rateLimiter.js';
import { validateRequest } from '../../middleware/validateRequest.js';
import { success } from '../auth/auth.controller.js';
import { auditContext, recordAudit } from '../auth/audit.js';
import { Types } from 'mongoose';
import { csvCell } from '../employees/employee.routes.js';
import { visitActor } from '../visits/visit.routes.js';
import { analyticsQuery, analyticsExport, type analyticsService } from './analytics.service.js';
import type { Models } from '../../models/index.js';

export function analyticsRoutes(
  models: Models,
  service: ReturnType<typeof analyticsService>,
  authenticated: RequestHandler,
) {
  const router = Router();
  router.use(authenticated, authorize('ADMIN', 'SUPER_ADMIN'));
  router.get(
    '/overview',
    validateRequest({ query: analyticsQuery }, async ({ query }, req, res) =>
      success(res, 'Overview retrieved', await service.overview(visitActor(req), query)),
    ),
  );
  router.get(
    '/attendance',
    validateRequest({ query: analyticsQuery }, async ({ query }, req, res) =>
      success(
        res,
        'Attendance analytics retrieved',
        await service.attendance(visitActor(req), query),
      ),
    ),
  );
  router.get(
    '/visits',
    validateRequest({ query: analyticsQuery }, async ({ query }, req, res) =>
      success(res, 'Visit analytics retrieved', await service.visits(visitActor(req), query)),
    ),
  );
  router.get(
    '/employees',
    validateRequest({ query: analyticsQuery }, async ({ query }, req, res) =>
      success(res, 'Employee activity retrieved', await service.employees(visitActor(req), query)),
    ),
  );
  router.get(
    '/locations',
    validateRequest({ query: analyticsQuery }, async ({ query }, req, res) =>
      success(res, 'Recorded locations retrieved', await service.locations(visitActor(req), query)),
    ),
  );
  router.get(
    '/reviews',
    validateRequest({ query: analyticsQuery }, async ({ query }, req, res) =>
      success(res, 'Review outcomes retrieved', await service.reviews(visitActor(req), query)),
    ),
  );
  router.get(
    '/export',
    limiter(15, 60_000),
    validateRequest({ query: analyticsExport }, async ({ query }, req, res) => {
      const actor = visitActor(req);
      const rows: unknown[][] =
        query.report === 'employees'
          ? [
              [
                'Employee code',
                'Employee',
                'Department',
                'Attendance records',
                'Completed sessions',
                'Working minutes',
                'Submitted visits',
              ],
              ...(await service.employees(actor, query, true)).employees.map((row) => [
                row.employeeCode,
                row.fullName,
                row.department,
                row.sessions,
                row.completed,
                row.workingMinutes,
                row.visits,
              ]),
            ]
          : [
              ['Period start', 'Period end', 'Timezone', 'Metric', 'Value'],
              ...Object.entries(await service.overview(actor, query))
                .filter(([, v]) => typeof v === 'number')
                .map(([key, value]) => [
                  service.range(query).from,
                  service.range(query).to,
                  service.timezone,
                  key,
                  value,
                ]),
            ];
      await recordAudit(models, auditContext(req), {
        actorId: new Types.ObjectId(actor.id),
        action: 'ANALYTICS_EXPORTED',
        entityType: 'VISIT',
      });
      res
        .type('text/csv')
        .attachment(
          query.report === 'employees' ? 'employee-activity.csv' : 'analytics-summary.csv',
        )
        .send('\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n');
    }),
  );
  return router;
}
