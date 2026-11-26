import { rateLimit } from 'express-rate-limit';
import type { Request } from 'express';
import { AppError, sendError } from './errors.js';

export function limiter(limit: number, windowMs: number, keyGenerator?: (req: Request) => string) {
  return rateLimit({
    limit,
    windowMs,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ...(keyGenerator ? { keyGenerator } : {}),
    handler: (req, res) => sendError(req, res, new AppError(429, 'Too many requests')),
    // Keep Express's default IP key and the deployment's explicit proxy trust configuration.
    // Express does not use the standardized Forwarded header to resolve req.ip.
    validate: { xForwardedForHeader: false, forwardedHeader: false },
  });
}
