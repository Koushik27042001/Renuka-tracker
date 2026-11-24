import { Types } from 'mongoose';
import type { Config } from '../../config.js';
import type { Models } from '../../models/index.js';
import { unauthorized } from '../../middleware/errors.js';
import { publicUser } from '../users/user.service.js';
import type { Transport } from './auth.validation.js';
import { recordAudit, type AuditContext } from './audit.js';
import type { Passwords } from './password.js';
import { newRefreshToken, refreshHash, type AccessClaims, type Tokens } from './tokens.js';

const MAX_ROTATIONS = 4096;
const roleAllowed = (role: string, transport: Transport) =>
  transport === 'web' ? role === 'ADMIN' || role === 'SUPER_ADMIN' : role === 'EMPLOYEE';

export function createAuthService(
  models: Models,
  config: Config,
  passwords: Passwords,
  tokens: Tokens,
) {
  const { users, sessions } = models;

  async function findActiveUser(claims: AccessClaims) {
    const user = await users
      .findOne({
        _id: claims.sub,
        status: 'ACTIVE',
        role: claims.role,
        sessionVersion: claims.ver,
      })
      .lean();
    if (!user) throw unauthorized();
    const session = await sessions.exists({
      _id: claims.sid,
      userId: user._id,
      sessionVersion: claims.ver,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    });
    if (!session) throw unauthorized();
    return user;
  }

  return {
    findActiveUser,
    async login(
      input: { identifier: string; password: string },
      transport: Transport,
      context: AuditContext,
    ) {
      const field = input.identifier.includes('@') ? 'email' : 'employeeCode';
      const user = await users
        .findOne({ [field]: input.identifier })
        .select('+passwordHash')
        .lean();
      const verified = await passwords.verify(input.password, user?.passwordHash);
      if (!verified || !user || user.status !== 'ACTIVE' || !roleAllowed(user.role, transport)) {
        await recordAudit(models, context, {
          actorId: user?._id,
          action: 'LOGIN_FAILED',
          entityType: 'USER',
          entityId: user?._id,
          reason: 'INVALID_CREDENTIALS',
        });
        throw unauthorized();
      }

      const now = new Date();
      const updated = await users
        .findOneAndUpdate(
          {
            _id: user._id,
            status: 'ACTIVE',
            role: user.role,
            sessionVersion: user.sessionVersion,
            passwordHash: user.passwordHash,
          },
          { $set: { lastLoginAt: now } },
          { returnDocument: 'after' },
        )
        .lean();
      if (!updated) throw unauthorized();

      const sessionId = new Types.ObjectId();
      const refreshToken = newRefreshToken(sessionId.toString());
      const expiresAt = new Date(now.getTime() + config.REFRESH_TOKEN_EXPIRES_DAYS * 86400000);
      const accessToken = await tokens.access({
        sub: user._id.toString(),
        sid: sessionId.toString(),
        role: updated.role,
        ver: updated.sessionVersion,
      });
      await sessions.create({
        _id: sessionId,
        userId: user._id,
        sessionVersion: updated.sessionVersion,
        transport,
        currentHash: refreshHash(refreshToken),
        expiresAt,
      });
      try {
        await recordAudit(models, context, {
          actorId: user._id,
          action: 'LOGIN_SUCCEEDED',
          entityType: 'REFRESH_SESSION',
          entityId: sessionId,
        });
      } catch (error) {
        await sessions.updateOne({ _id: sessionId }, { $set: { revokedAt: new Date() } });
        throw error;
      }
      return { accessToken, refreshToken, expiresAt, user: publicUser(updated) };
    },

    async refresh(raw: string, transport: Transport, context: AuditContext) {
      const id = raw.split('.')[0];
      const currentHash = refreshHash(raw);
      const now = new Date();
      const filter = { _id: id, transport, revokedAt: null, expiresAt: { $gt: now } };
      const nextToken = newRefreshToken(id);
      // A single document contains both the current token hash and all consumed hashes.
      const session = await sessions
        .findOneAndUpdate(
          {
            ...filter,
            currentHash,
            rotations: { $lt: MAX_ROTATIONS },
          },
          {
            $set: { currentHash: refreshHash(nextToken) },
            $push: { usedHashes: currentHash },
            $inc: { rotations: 1 },
          },
          { returnDocument: 'after' },
        )
        .lean();

      if (!session) {
        const replay = await sessions
          .findOneAndUpdate(
            {
              ...filter,
              usedHashes: currentHash,
            },
            { $set: { revokedAt: now } },
          )
          .lean();
        if (replay) {
          await recordAudit(models, context, {
            actorId: replay.userId,
            action: 'REFRESH_REUSED',
            entityType: 'REFRESH_SESSION',
            entityId: replay._id,
            reason: 'REPLAY',
          });
        } else {
          await sessions.updateOne(
            { ...filter, currentHash, rotations: { $gte: MAX_ROTATIONS } },
            {
              $set: { revokedAt: now },
            },
          );
        }
        throw unauthorized();
      }

      const user = await users
        .findOne({
          _id: session.userId,
          status: 'ACTIVE',
          sessionVersion: session.sessionVersion,
        })
        .lean();
      if (!user || !roleAllowed(user.role, transport)) {
        await sessions.updateOne({ _id: id, revokedAt: null }, { $set: { revokedAt: now } });
        throw unauthorized();
      }
      const accessToken = await tokens.access({
        sub: user._id.toString(),
        sid: id,
        role: user.role,
        ver: user.sessionVersion,
      });
      return {
        accessToken,
        refreshToken: nextToken,
        expiresAt: session.expiresAt,
        user: publicUser(user),
      };
    },

    async logout(raw: string | undefined, transport: Transport, context: AuditContext) {
      if (!raw) return;
      const hash = refreshHash(raw);
      const session = await sessions
        .findOneAndUpdate(
          {
            _id: raw.split('.')[0],
            transport,
            revokedAt: null,
            expiresAt: { $gt: new Date() },
            $or: [{ currentHash: hash }, { usedHashes: hash }],
          },
          { $set: { revokedAt: new Date() } },
        )
        .lean();
      if (session)
        await recordAudit(models, context, {
          actorId: session.userId,
          action: 'LOGOUT',
          entityType: 'REFRESH_SESSION',
          entityId: session._id,
        });
    },

    async logoutAll(claims: AccessClaims, context: AuditContext) {
      const user = await users
        .findOneAndUpdate(
          {
            _id: claims.sub,
            status: 'ACTIVE',
            sessionVersion: claims.ver,
          },
          { $inc: { sessionVersion: 1 } },
          { returnDocument: 'after' },
        )
        .lean();
      if (!user) throw unauthorized();
      await sessions.updateMany(
        {
          userId: user._id,
          sessionVersion: { $lt: user.sessionVersion },
          revokedAt: null,
        },
        { $set: { revokedAt: new Date() } },
      );
      await recordAudit(models, context, {
        actorId: user._id,
        action: 'LOGOUT_ALL',
        entityType: 'USER',
        entityId: user._id,
      });
    },
  };
}
export type AuthService = ReturnType<typeof createAuthService>;
