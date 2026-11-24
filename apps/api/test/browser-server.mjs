import { createApp } from '../dist/app.js';
import { readConfig } from '../dist/config.js';
import { createLogger } from '../dist/config/logger.js';
import { openDatabase, waitForDatabase, databaseReady } from '../dist/config/database.js';
import {
  createModels,
  requireIndexes,
  requireAttendanceIndexes,
  requireVisitIndexes,
} from '../dist/models/index.js';

const config = readConfig(process.env);
if (
  config.NODE_ENV !== 'test' ||
  !config.MONGODB_URI.startsWith('mongodb://127.0.0.1:') ||
  !config.MONGODB_URI.endsWith('/renuka_browser_test')
)
  throw new Error('A dedicated local browser test database is required.');
const logger = createLogger(config);
const { connection, ready } = openDatabase(config, logger);
await waitForDatabase(connection, ready);
const models = createModels(connection);
await requireIndexes(models);
await requireAttendanceIndexes(models);
await requireVisitIndexes(models);
const images = new Map();
const app = createApp({
  config,
  models,
  logger,
  ready: () => databaseReady(connection),
  connected: () => connection.readyState === 1,
  geocoder: async () => ({ address: null, provider: null }),
  evidenceStore: {
    async upload(publicId, bytes) {
      if (images.has(publicId)) throw new Error('Unexpected overwrite');
      images.set(publicId, bytes);
      return { publicId, assetId: 'browser-fixture' };
    },
    async read(publicId) {
      const bytes = images.get(publicId);
      return bytes ? new Response(new Uint8Array(bytes)) : new Response(null, { status: 404 });
    },
    async remove(publicId) {
      images.delete(publicId);
    },
  },
});
const server = app.listen(config.PORT, config.HOST);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => server.close(() => void connection.close()));
