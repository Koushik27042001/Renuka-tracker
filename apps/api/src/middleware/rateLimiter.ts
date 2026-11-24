import { rateLimit } from 'express-rate-limit';
import { AppError, sendError } from './errors.js';

export function limiter(limit: number, windowMs: number) {
  return rateLimit({
    limit,
    windowMs,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) => sendError(req, res, new AppError(429, 'Too many requests')),
    // An untrusted forwarding header is ignored by Express when proxies are disabled.
    validate: { xForwardedForHeader: false },
  });
}
