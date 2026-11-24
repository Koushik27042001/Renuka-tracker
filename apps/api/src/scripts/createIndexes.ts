import { config as loadEnv } from 'dotenv';
import { readConfig } from '../config.js';
import { openDatabase, waitForDatabase } from '../config/database.js';
import { createLogger } from '../config/logger.js';
import { createIndexes, createModels } from '../models/index.js';

loadEnv({ quiet: true });

async function run() {
  const config = readConfig(process.env);
  const { connection, ready } = openDatabase(config, createLogger(config));
  try {
    await waitForDatabase(connection, ready);
    await createIndexes(createModels(connection));
    console.info('Declared MongoDB indexes are present');
  } finally {
    await connection.close();
  }
}

run().catch(() => {
  console.error(
    'Could not create MongoDB indexes. Check permissions, connectivity and conflicting existing indexes.',
  );
  process.exitCode = 1;
});
