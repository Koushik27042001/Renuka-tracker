import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';
import { mongo } from 'mongoose';
import { readConfig, type Config } from '../config.js';
import { openDatabase, waitForDatabase } from '../config/database.js';
import { createLogger } from '../config/logger.js';
import { createModels, requireIndexes, type Models } from '../models/index.js';
import { createPasswords } from '../modules/auth/password.js';
import { recordAudit } from '../modules/auth/audit.js';
import {
  email,
  employeeCode,
  fullName,
  newPassword,
  phone,
} from '../modules/users/user.validation.js';

const schema = z.object({
  BOOTSTRAP_ADMIN_EMAIL: email,
  BOOTSTRAP_ADMIN_PASSWORD: newPassword,
  BOOTSTRAP_ADMIN_NAME: fullName,
  BOOTSTRAP_ADMIN_PHONE: phone,
  BOOTSTRAP_ADMIN_CODE: employeeCode.default('SUPERADMIN'),
});

export async function bootstrapAdmin(models: Models, config: Config, env: NodeJS.ProcessEnv) {
  const input = schema.safeParse(env);
  if (!input.success)
    throw new Error(
      'Invalid administrator configuration: ' +
        input.error.issues.map((issue) => issue.path.join('.')).join(', '),
    );
  const data = input.data;
  const normalizedPassword = data.BOOTSTRAP_ADMIN_PASSWORD.toLowerCase();
  if (
    normalizedPassword.includes(data.BOOTSTRAP_ADMIN_EMAIL) ||
    normalizedPassword.includes(data.BOOTSTRAP_ADMIN_CODE.toLowerCase()) ||
    new Set(normalizedPassword).size < 6
  ) {
    throw new Error('Bootstrap password must be unique and independent of the account identifier');
  }
  await requireIndexes(models);
  if (await models.users.exists({ role: 'SUPER_ADMIN' }))
    throw new Error('A super administrator already exists');
  const passwords = createPasswords(config);
  await passwords.ready;
  const passwordHash = await passwords.hash(data.BOOTSTRAP_ADMIN_PASSWORD);
  try {
    const user = await models.users.create({
      employeeCode: data.BOOTSTRAP_ADMIN_CODE,
      fullName: data.BOOTSTRAP_ADMIN_NAME,
      email: data.BOOTSTRAP_ADMIN_EMAIL,
      phone: data.BOOTSTRAP_ADMIN_PHONE,
      department: 'Administration',
      designation: 'Super Administrator',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      passwordHash,
      bootstrap: true,
    });
    await recordAudit(
      models,
      { requestId: randomUUID() },
      {
        actorId: user._id,
        action: 'SUPER_ADMIN_BOOTSTRAPPED',
        entityType: 'USER',
        entityId: user._id,
      },
    );
  } catch (error) {
    if (error instanceof mongo.MongoServerError && error.code === 11000) {
      throw new Error('An initial administrator or the supplied account identity already exists');
    }
    throw new Error(
      'Administrator initialization failed. Check whether an account was created before retrying.',
    );
  }
}

async function run() {
  loadEnv({ quiet: true });
  const config = readConfig(process.env);
  const { connection, ready } = openDatabase(config, createLogger(config));
  try {
    await waitForDatabase(connection, ready);
    await bootstrapAdmin(createModels(connection), config, process.env);
    console.info('Initial super administrator created');
  } finally {
    await connection.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Administrator initialization failed');
    process.exitCode = 1;
  });
}
