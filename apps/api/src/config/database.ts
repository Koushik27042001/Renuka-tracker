import mongoose, { type Connection } from 'mongoose';
import type { Logger } from 'pino';
import type { Config } from '../config.js';

export function openDatabase(config: Config, logger: Logger) {
  const connection = mongoose.createConnection();
  connection.on('connected', () => logger.info('MongoDB connected'));
  connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  connection.on('error', () => logger.error('MongoDB connection error'));
  return {
    connection,
    ready: connection.openUri(config.MONGODB_URI, {
      serverSelectionTimeoutMS: config.MONGODB_CONNECT_TIMEOUT_MS,
      connectTimeoutMS: config.MONGODB_CONNECT_TIMEOUT_MS,
      socketTimeoutMS: 10000,
      maxPoolSize: 20,
      readPreference: 'primary',
      w: 'majority',
      ...(config.NODE_ENV === 'production' ? { tls: true } : {}),
      autoIndex: false,
      autoCreate: false,
      bufferCommands: false,
    }),
  };
}

export async function waitForDatabase(connection: Connection, ready: Promise<Connection>) {
  try {
    await ready;
  } catch {
    await connection.close().catch(() => undefined);
    throw new Error('Could not connect to MongoDB');
  }
}

export async function databaseReady(connection: Connection) {
  if (connection.readyState !== 1 || !connection.db) return false;
  try {
    await connection.db.command({ ping: 1 }, { timeoutMS: 1500 });
    return true;
  } catch {
    return false;
  }
}
