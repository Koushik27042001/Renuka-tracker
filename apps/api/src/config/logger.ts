import pino from 'pino';
import type { Config } from '../config.js';

export function createLogger(config: Config) {
  return pino({
    level: config.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers',
        'req.body',
        'res.headers',
        'password',
        'passwordHash',
        'token',
        'accessToken',
        'refreshToken',
        'uri',
        'coordinates',
        'latitude',
        'longitude',
      ],
      remove: true,
    },
  });
}
