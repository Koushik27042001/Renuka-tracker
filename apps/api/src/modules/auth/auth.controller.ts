import type { CookieOptions, Request, Response } from 'express';
import type { Config } from '../../config.js';
import { AppError, unauthorized } from '../../middleware/errors.js';
import { parse } from '../../middleware/validateRequest.js';
import { auditContext } from './audit.js';
import { requireAuth } from '../../middleware/authenticate.js';
import {
  emptyBody,
  mobileRefresh,
  rawRefreshSchema,
  transportSchema,
  type Transport,
} from './auth.validation.js';
import { publicUser } from '../users/user.service.js';
import type { AuthService } from './auth.service.js';

export function success(res: Response, message: string, data: object = {}) {
  res.json({ success: true, message, data });
}

export function authController(auth: AuthService, config: Config) {
  const cookieName = config.COOKIE_SECURE ? '__Host-renuka_refresh' : 'renuka_refresh';
  const cookie: CookieOptions = {
    secure: config.COOKIE_SECURE,
    httpOnly: true,
    sameSite: config.COOKIE_SAME_SITE,
    path: '/',
  };

  function transport(req: Request) {
    const mode = transportSchema.safeParse(req.get('x-auth-transport'));
    if (!mode.success) throw new AppError(400, 'X-Auth-Transport must be web or mobile');
    const origin = req.get('origin');
    if (
      mode.data === 'web'
        ? !origin || !config.ADMIN_ORIGINS.includes(origin)
        : origin !== undefined || req.get('cookie') !== undefined
    ) {
      throw new AppError(403, 'Authentication transport is not permitted');
    }
    return mode.data;
  }

  function credential(req: Request, mode: Transport, required: boolean) {
    if (mode === 'mobile') return parse(mobileRefresh, req.body).refreshToken;
    parse(emptyBody, req.body ?? {});
    const result = rawRefreshSchema.safeParse(req.cookies[cookieName]);
    if (result.success) return result.data;
    if (required) throw unauthorized();
  }

  function grant(res: Response, mode: Transport, data: Awaited<ReturnType<AuthService['login']>>) {
    const { refreshToken, expiresAt, ...publicData } = data;
    if (mode === 'web') res.cookie(cookieName, refreshToken, { ...cookie, expires: expiresAt });
    success(res, 'Authenticated', mode === 'web' ? publicData : { ...publicData, refreshToken });
  }

  return {
    async login(input: Parameters<AuthService['login']>[0], req: Request, res: Response) {
      const mode = transport(req);
      grant(res, mode, await auth.login(input, mode, auditContext(req)));
    },
    async refresh(req: Request, res: Response) {
      const mode = transport(req);
      const raw = credential(req, mode, true);
      if (!raw) throw unauthorized();
      try {
        grant(res, mode, await auth.refresh(raw, mode, auditContext(req)));
      } catch (error) {
        if (mode === 'web' && error instanceof AppError && error.status === 401)
          res.clearCookie(cookieName, cookie);
        throw error;
      }
    },
    async logout(req: Request, res: Response) {
      const mode = transport(req);
      await auth.logout(credential(req, mode, false), mode, auditContext(req));
      if (mode === 'web') res.clearCookie(cookieName, cookie);
      success(res, 'Signed out');
    },
    async logoutAll(req: Request, res: Response) {
      const mode = transport(req);
      parse(emptyBody, req.body ?? {});
      await auth.logoutAll(requireAuth(req), auditContext(req));
      if (mode === 'web') res.clearCookie(cookieName, cookie);
      success(res, 'Signed out on all devices');
    },
    async me(req: Request, res: Response) {
      const user = await auth.findActiveUser(requireAuth(req));
      success(res, 'Profile retrieved', { user: publicUser(user) });
    },
  };
}
