import { randomBytes } from 'node:crypto';
import { argon2id, hash, verify } from 'argon2';
import type { Config } from '../../config.js';

export function createPasswords(config: Config) {
  const options = {
    type: argon2id,
    memoryCost: config.ARGON2_MEMORY_KIB,
    timeCost: config.ARGON2_TIME_COST,
    parallelism: config.ARGON2_PARALLELISM,
  } as const;
  const hashPassword = (password: string) => hash(password, options);
  // Unknown accounts use an equally expensive verification.
  const fallback = hashPassword(randomBytes(32).toString('base64url'));
  return {
    ready: fallback,
    hash: hashPassword,
    async verify(password: string, encoded?: string) {
      return verify(encoded ?? (await fallback), password);
    },
  };
}
export type Passwords = ReturnType<typeof createPasswords>;
