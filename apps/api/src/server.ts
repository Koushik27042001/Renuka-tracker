import { config as loadEnv } from 'dotenv';
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { readConfig } from './config.js';
import { databaseReady, openDatabase, waitForDatabase } from './config/database.js';
import { createLogger } from './config/logger.js';
import {
  createModels,
  requireAttendanceIndexes,
  requireIndexes,
  requireVisitIndexes,
} from './models/index.js';
import { createPasswords } from './modules/auth/password.js';

loadEnv({ quiet: true });

async function main() {
  const config = readConfig(process.env);
  const logger = createLogger(config);
  const { connection, ready } = openDatabase(config, logger);
  let server: Server | undefined;
  let stopping = false;

  async function shutdown() {
    if (stopping) return;
    stopping = true;
    const timer = setTimeout(() => {
      logger.error('Shutdown deadline exceeded');
      process.exit(1);
    }, 15000).unref();
    try {
      if (server?.listening) {
        await new Promise<void>((resolve, reject) =>
          server?.close((error) => (error ? reject(error) : resolve())),
        );
      }
      await connection.close();
      logger.info('API stopped');
    } catch {
      logger.error('Could not shut down cleanly');
      process.exitCode = 1;
    } finally {
      clearTimeout(timer);
    }
  }

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  try {
    await waitForDatabase(connection, ready);
    if (stopping) return;
    const models = createModels(connection);
    await requireIndexes(models);
    await requireAttendanceIndexes(models);
    await requireVisitIndexes(models);
    const passwords = createPasswords(config);
    await passwords.ready;
    if (stopping) return;
    const app = createApp({
      config,
      models,
      logger,
      passwords,
      connected: () => !stopping && connection.readyState === 1,
      ready: () => (stopping ? Promise.resolve(false) : databaseReady(connection)),
    });
    server = app.listen(config.PORT, config.HOST, () =>
      logger.info({ port: config.PORT }, 'API listening'),
    );
    server.requestTimeout = 15000;
    server.headersTimeout = 10000;
    server.on('error', () => {
      logger.error('HTTP listener failed');
      process.exitCode = 1;
      void shutdown();
    });
  } catch {
    if (!stopping) {
      logger.error(
        'API startup failed. Check MongoDB connectivity, required indexes and runtime settings.',
      );
      process.exitCode = 1;
      await shutdown();
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'API startup failed');
  process.exitCode = 1;
});
