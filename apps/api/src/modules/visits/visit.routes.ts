import { Router, type Request, type RequestHandler } from 'express';
import multer from 'multer';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { evidenceInput, visitInput } from '@renuka/shared';
import { AppError } from '../../middleware/errors.js';
import { authorize } from '../../middleware/authorize.js';
import { requireAuth } from '../../middleware/authenticate.js';
import { limiter } from '../../middleware/rateLimiter.js';
import { parse, validateRequest } from '../../middleware/validateRequest.js';
import { objectId } from '../users/user.validation.js';
import { success } from '../auth/auth.controller.js';
import { auditContext } from '../auth/audit.js';
import { maxImageBytes } from '../../integrations/evidenceImage.js';
import { csvCell } from '../employees/employee.routes.js';
import { draftInput, visitFilters, type VisitActor, type visitService } from './visit.service.js';
import type { Models } from '../../models/index.js';

const params = z.strictObject({ id: objectId });
const reason = z.strictObject({ reason: z.string().trim().min(3).max(240) });
export function visitActor(req: Request): VisitActor {
  const user = requireAuth(req);
  return { id: user.sub, role: user.role, department: req.authDepartment };
}
const receive = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxImageBytes,
    files: 1,
    fields: 1,
    fieldSize: 2048,
    parts: 2,
  },
}).single('image');
let receiving = 0;
const upload: RequestHandler = (req, res, next) => {
  if (receiving >= 4)
    return next(new AppError(429, 'Evidence uploads are busy. Try again shortly.'));
  receiving++;
  res.once('close', () => {
    receiving--;
  });
  receive(req, res, (error) => {
    if (error instanceof multer.MulterError)
      return next(
        new AppError(
          error.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
          'Invalid evidence upload or file too large.',
        ),
      );
    if (error) return next(new AppError(400, 'Malformed image upload.'));
    next();
  });
};

export function visitRoutes(
  models: Models,
  service: ReturnType<typeof visitService>,
  authenticated: RequestHandler,
) {
  const routes = Router();
  const evidence = Router();
  const employee = authorize('EMPLOYEE');
  const admin = authorize('ADMIN', 'SUPER_ADMIN');
  routes.use(authenticated);
  evidence.use(authenticated);
  routes.post(
    '/',
    employee,
    validateRequest({ body: draftInput }, async ({ body }, req, res) =>
      success(res.status(201), 'Visit draft saved', {
        visit: await service.create(visitActor(req), body, auditContext(req)),
      }),
    ),
  );
  routes.get(
    '/me',
    employee,
    validateRequest({ query: visitFilters }, async ({ query }, req, res) =>
      success(res, 'Visits retrieved', await service.list(visitActor(req), query)),
    ),
  );
  routes.get(
    '/',
    admin,
    validateRequest({ query: visitFilters }, async ({ query }, req, res) =>
      success(res, 'Visits retrieved', await service.list(visitActor(req), query)),
    ),
  );
  routes.get(
    '/stats',
    admin,
    validateRequest({ query: visitFilters }, async ({ query }, req, res) => {
      const { match } = await service.report(visitActor(req), query);
      const groups = await models.visits.aggregate<{ _id: string; count: number }>([
        { $match: match },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]);
      const count = (status: string) => groups.find((row) => row._id === status)?.count ?? 0;
      success(res, 'Visit statistics retrieved', {
        total: groups.reduce((sum, row) => sum + row.count, 0),
        pending: count('PENDING_REVIEW'),
        approved: count('APPROVED'),
        rejected: count('REJECTED'),
      });
    }),
  );
  routes.get(
    '/export',
    admin,
    limiter(15, 60_000),
    validateRequest({ query: visitFilters }, async ({ query }, req, res) => {
      const actor = visitActor(req);
      const { match, directory } = await service.report(actor, query);
      await models.auditLogs.create({
        ...auditContext(req),
        actorId: actor.id,
        entityType: 'VISIT',
        action: 'VISITS_EXPORTED',
      });
      const cursor = models.visits.find(match).sort({ visitDate: -1, _id: -1 }).lean().cursor();
      res.type('text/csv').attachment('field-visits.csv');
      async function* rows() {
        try {
          yield '\uFEFFVisit ID,Employee ID,Employee,Department,Client,Date,Purpose,Status,Submitted,Reviewed,Evidence\r\n';
          for await (const row of cursor) {
            const user = directory.get(row.employeeId.toString());
            yield (
              [
                'VIS-' + row._id.toString().toUpperCase(),
                user?.employeeCode,
                user?.fullName,
                user?.department,
                row.clientName,
                row.visitDate,
                row.purpose,
                row.status,
                row.submittedAt?.toISOString(),
                row.reviewedAt?.toISOString(),
                row.evidence ? 'Stored' : 'Unavailable',
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
  routes.get(
    ['/me/:id', '/:id'],
    validateRequest({ params }, async ({ params }, req, res) =>
      success(res, 'Visit retrieved', { visit: await service.detail(visitActor(req), params.id) }),
    ),
  );
  routes.patch(
    ['/me/:id', '/:id'],
    employee,
    validateRequest({ params, body: visitInput }, async ({ params, body }, req, res) =>
      success(res, 'Draft updated', {
        visit: await service.edit(visitActor(req), params.id, body),
      }),
    ),
  );
  const discardDraft = validateRequest({ params }, async ({ params }, req, res) => {
    await service.discard(visitActor(req), params.id, false, auditContext(req));
    success(res, 'Draft discarded');
  });
  routes.delete('/:id', employee, discardDraft);
  routes.post('/me/:id/discard', employee, discardDraft);
  routes.delete(
    '/:id/evidence',
    employee,
    validateRequest({ params }, async ({ params }, req, res) => {
      await service.discard(visitActor(req), params.id, true, auditContext(req));
      success(res, 'Draft evidence removed');
    }),
  );
  routes.post(
    '/:id/evidence',
    employee,
    limiter(12, 60_000),
    upload,
    validateRequest({ params }, async ({ params }, req, res) => {
      if (!req.file || !['image/jpeg', 'image/png'].includes(req.file.mimetype))
        throw new AppError(422, 'A JPEG or PNG image is required.');
      let raw: unknown;
      try {
        raw = JSON.parse(req.body.metadata);
      } catch {
        throw new AppError(400, 'Evidence metadata must be valid JSON.');
      }
      const visit = await service.upload(
        visitActor(req),
        params.id,
        parse(evidenceInput, raw),
        req.file.buffer,
        auditContext(req),
      );
      success(res, 'Evidence stored', { visit });
    }),
  );
  routes.post(
    ['/me/:id/submit', '/:id/submit'],
    employee,
    validateRequest({ params }, async ({ params }, req, res) =>
      success(res, 'Visit submitted', {
        visit: await service.submit(visitActor(req), params.id, auditContext(req)),
      }),
    ),
  );
  routes.post(
    '/:id/approve',
    admin,
    validateRequest({ params }, async ({ params }, req, res) =>
      success(res, 'Visit approved', {
        visit: await service.review(visitActor(req), params.id, true, undefined, auditContext(req)),
      }),
    ),
  );
  routes.post(
    '/:id/reject',
    admin,
    validateRequest({ params, body: reason }, async ({ params, body }, req, res) =>
      success(res, 'Visit rejected', {
        visit: await service.review(
          visitActor(req),
          params.id,
          false,
          body.reason,
          auditContext(req),
        ),
      }),
    ),
  );
  evidence.get(
    '/:id',
    validateRequest({ params }, async ({ params }, req, res) =>
      success(
        res,
        'Evidence retrieved',
        await service.evidence(visitActor(req), params.id, auditContext(req)),
      ),
    ),
  );
  evidence.get(
    '/:id/view',
    limiter(60, 60_000),
    validateRequest({ params }, async ({ params }, req, res) => {
      const result = await service.image(visitActor(req), params.id, auditContext(req), false);
      if (!result.bytes) throw new AppError(503, 'Evidence unavailable.');
      res.type('image/jpeg').send(result.bytes);
    }),
  );
  evidence.post(
    '/:id/verify-integrity',
    limiter(15, 60_000),
    validateRequest({ params }, async ({ params }, req, res) => {
      const result = await service.image(visitActor(req), params.id, auditContext(req), true);
      success(res, 'Evidence integrity checked', { matches: result.matches });
    }),
  );
  return { routes, evidence };
}
