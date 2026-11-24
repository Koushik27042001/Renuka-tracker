import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { roles } from '../../models/User.model.js';
import { unauthorized } from '../../middleware/errors.js';
import { objectId } from '../users/user.validation.js';

const claimsSchema = z.object({
  sub: objectId,
  sid: objectId,
  role: z.enum(roles),
  ver: z.number().int().nonnegative(),
  type: z.literal('access'),
});
export type AccessClaims = z.infer<typeof claimsSchema>;

export function createTokens(config: Config) {
  const key = new TextEncoder().encode(config.JWT_ACCESS_SECRET);
  return {
    access(claims: Omit<AccessClaims, 'type'>) {
      return new SignJWT({ ...claims, type: 'access' })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setIssuer(config.JWT_ISSUER)
        .setAudience(config.JWT_AUDIENCE)
        .setJti(randomUUID())
        .setIssuedAt()
        .setExpirationTime(config.JWT_ACCESS_EXPIRES_IN)
        .sign(key);
    },
    async verify(token: string) {
      try {
        const { payload } = await jwtVerify(token, key, {
          algorithms: ['HS256'],
          issuer: config.JWT_ISSUER,
          audience: config.JWT_AUDIENCE,
          typ: 'JWT',
          requiredClaims: ['iat', 'exp', 'sub'],
          maxTokenAge: config.JWT_ACCESS_EXPIRES_IN,
        });
        return claimsSchema.parse(payload);
      } catch {
        throw unauthorized();
      }
    },
  };
}
export type Tokens = ReturnType<typeof createTokens>;

export function newRefreshToken(sessionId: string) {
  return sessionId + '.' + randomBytes(32).toString('base64url');
}
export function refreshHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
