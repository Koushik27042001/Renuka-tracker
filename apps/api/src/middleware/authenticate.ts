import type { Request, RequestHandler } from 'express';
import { unauthorized } from './errors.js';
import type { Tokens } from '../modules/auth/tokens.js';
import type { AuthService } from '../modules/auth/auth.service.js';

export function authenticate(tokens: Tokens, auth: AuthService): RequestHandler {
  return async (req, _res, next) => {
    const token = /^Bearer ([A-Za-z0-9._-]{1,4096})$/i.exec(req.get('authorization') ?? '')?.[1];
    if (!token) throw unauthorized();
    const claims = await tokens.verify(token);
    const user = await auth.findActiveUser(claims);
    req.auth = { ...claims, role: user.role };
    req.authDepartment = user.department;
    next();
  };
}

export function requireAuth(req: Request) {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
