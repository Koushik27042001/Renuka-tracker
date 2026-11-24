import { Router, type RequestHandler } from 'express';
import type { Config } from '../../config.js';
import { authController } from './auth.controller.js';
import type { AuthService } from './auth.service.js';
import { loginSchema } from './auth.validation.js';
import { validateRequest } from '../../middleware/validateRequest.js';
import { limiter } from '../../middleware/rateLimiter.js';

export function authRoutes(config: Config, auth: AuthService, authenticate: RequestHandler) {
  const router = Router();
  const controller = authController(auth, config);
  router.post(
    '/login',
    limiter(config.LOGIN_RATE_LIMIT, 15 * 60_000),
    validateRequest({ body: loginSchema }, ({ body }, req, res) =>
      controller.login(body, req, res),
    ),
  );
  router.post('/refresh', limiter(config.REFRESH_RATE_LIMIT, 60_000), controller.refresh);
  router.post('/logout', controller.logout);
  router.post('/logout-all', authenticate, controller.logoutAll);
  router.get('/me', authenticate, controller.me);
  return router;
}
