import type { AccessClaims } from '../modules/auth/tokens.js';

declare global {
  namespace Express {
    interface Request {
      auth?: AccessClaims;
      authDepartment?: string;
    }
  }
}
export {};
