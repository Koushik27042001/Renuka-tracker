import type { RequestHandler } from 'express';
import type { Role } from '../models/User.model.js';
import { AppError } from './errors.js';
import { requireAuth } from './authenticate.js';

export function authorize(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!roles.includes(requireAuth(req).role)) throw new AppError(403, 'Access denied');
    next();
  };
}
