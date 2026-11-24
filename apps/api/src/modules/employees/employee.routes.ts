import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Router, type Request, type RequestHandler } from 'express';
import {
  accountSetupInput,
  employeeProfileInput,
  employeeProfilePatch,
  employeeStatusInput,
} from '@renuka/shared';
import { z } from 'zod';
import { requireAuth } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/errors.js';
import { limiter } from '../../middleware/rateLimiter.js';
import { validateRequest } from '../../middleware/validateRequest.js';
import { success } from '../auth/auth.controller.js';
import { auditContext } from '../auth/audit.js';
import { pagination } from '../users/user.validation.js';
import { employeeParams, exportQuery, listQuery } from './employee.validation.js';
import type { employeeService } from './employee.service.js';

type Service = ReturnType<typeof employeeService>;
function actor(req: Request) {
  const auth = requireAuth(req);
  if (auth.role === 'ADMIN' && !req.authDepartment)
    throw new AppError(403, 'Administrative department is required');
  return { id: auth.sub, department: auth.role === 'ADMIN' ? req.authDepartment : undefined };
}

export function csvCell(value: unknown) {
  const raw = String(value ?? '');
  const safe = /^[\s\u0000-\u001f]*[=+\-@]|^[\t\r\n]/u.test(raw) ? "'" + raw : raw;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export function employeeRoutes(service: Service, authenticate: RequestHandler) {
  const router = Router();
  router.use(authenticate, authorize('SUPER_ADMIN', 'ADMIN'));
  router.get(
    '/',
    validateRequest({ query: listQuery }, async ({ query }, req, res) => {
      success(res, 'Employees retrieved', await service.list(actor(req), query));
    }),
  );
  router.post(
    '/',
    validateRequest({ body: employeeProfileInput }, async ({ body }, req, res) => {
      const employee = await service.create(actor(req), body, auditContext(req));
      success(res.status(201), 'Employee created', { employee });
    }),
  );
  router.get('/stats', async (req, res) =>
    success(res, 'Employee statistics retrieved', await service.stats(actor(req))),
  );
  router.get(
    '/export',
    limiter(15, 60_000),
    validateRequest({ query: exportQuery }, async ({ query }, req, res) => {
      const cursor = await service.exportRows(actor(req), query, auditContext(req));
      res.type('text/csv').attachment('employees.csv');
      async function* rows() {
        try {
          yield '\uFEFFEmployee Code,Full Name,Email,Phone,Department,Designation,Status,Joining Date\r\n';
          for await (const row of cursor) {
            yield (
              [
                row.employeeCode,
                row.fullName,
                row.email,
                row.phone,
                row.department,
                row.designation,
                row.status,
                row.dateOfJoining?.toISOString().slice(0, 10),
              ]
                .map(csvCell)
                .join(',') + '\r\n'
            );
          }
        } finally {
          await cursor.close();
        }
      }
      await pipeline(Readable.from(rows()), res);
    }),
  );
  router.get(
    '/:id',
    validateRequest({ params: employeeParams }, async ({ params }, req, res) => {
      success(res, 'Employee retrieved', { employee: await service.detail(actor(req), params.id) });
    }),
  );
  router.patch(
    '/:id',
    validateRequest(
      { params: employeeParams, body: employeeProfilePatch },
      async ({ params, body }, req, res) => {
        success(res, 'Employee updated', {
          employee: await service.update(actor(req), params.id, body, auditContext(req)),
        });
      },
    ),
  );
  router.patch(
    '/:id/status',
    validateRequest(
      { params: employeeParams, body: employeeStatusInput },
      async ({ params, body }, req, res) => {
        success(res, 'Status updated', {
          employee: await service.setStatus(actor(req), params.id, body, auditContext(req)),
        });
      },
    ),
  );
  router.post(
    '/:id/password-reset',
    limiter(15, 60_000),
    validateRequest(
      { params: employeeParams, body: z.strictObject({}).optional() },
      async ({ params }, req, res) => {
        success(
          res,
          'One-time link issued',
          await service.issueLink(actor(req), params.id, auditContext(req)),
        );
      },
    ),
  );
  router.get(
    '/:id/audit-logs',
    authorize('SUPER_ADMIN'),
    validateRequest(
      { params: employeeParams, query: pagination },
      async ({ params, query }, req, res) => {
        success(res, 'Employee audit events retrieved', {
          events: await service.history(actor(req), params.id, query.page, query.limit),
        });
      },
    ),
  );
  return router;
}

export function employeeAccountSetup(service: Service) {
  return [
    limiter(10, 60_000),
    validateRequest({ body: accountSetupInput }, async ({ body }, req, res) => {
      await service.redeem(body.token, body.password, auditContext(req));
      success(res, 'Password set. You can now sign in to the employee app.');
    }),
  ];
}
