import { isIP } from 'node:net';
import { z } from 'zod';

const csv = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
const origin = z.url({ protocol: /^https?$/ }).refine((value) => new URL(value).origin === value);
const bool = z.enum(['true', 'false']).transform((value) => value === 'true');
const bounded = (fallback: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);
const proxy = z.string().refine((value) => {
  const [address, prefix, extra] = value.split('/');
  const version = isIP(address);
  if (extra !== undefined || !version) return false;
  return (
    prefix === undefined ||
    (/^[1-9]\d*$/.test(prefix) && Number(prefix) <= (version === 4 ? 32 : 128))
  );
});
const releaseVersion = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})$/);
const secureUrl = z.url({ protocol: /^https$/ }).refine((value) => {
  const url = new URL(value);
  return !url.username && !url.password;
});
const optional = <T extends z.ZodType>(value: T) =>
  z.preprocess((raw) => (raw === '' ? undefined : raw), value.optional());
const schema = z.object({
  METRICS_TOKEN: optional(
    z
      .string()
      .min(32)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/),
  ),
  MOBILE_RELEASE_APPROVED_ORIGINS: z.string().default('').transform(csv).pipe(z.array(origin)),
  MOBILE_DOWNLOAD_PAGE_URL: optional(secureUrl),
  ANDROID_APK_URL: optional(secureUrl),
  ANDROID_APK_SHA256: optional(z.string().regex(/^[a-f0-9]{64}$/)),
  ANDROID_RELEASE_DATE: optional(z.iso.date()),
  ANDROID_LATEST_VERSION: optional(releaseVersion),
  ANDROID_MIN_VERSION: optional(releaseVersion),
  IOS_INSTALL_URL: optional(secureUrl),
  IOS_LATEST_VERSION: optional(releaseVersion),
  IOS_MIN_VERSION: optional(releaseVersion),
  SUPPORT_EMAIL: optional(z.email()),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: bounded(3000, 1, 65535),
  ADMIN_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform(csv)
    .pipe(z.array(origin).min(1)),
  EMPLOYEE_WEB_ORIGINS: z.string().default('').transform(csv).pipe(z.array(origin)),
  TRUSTED_PROXY_CIDRS: z.string().default('').transform(csv).pipe(z.array(proxy)),
  BUSINESS_TIMEZONE: z
    .string()
    .default('Asia/Kolkata')
    .refine((value) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }),
  OFFLINE_VISITS_ENABLED: bool.default(true),
  OFFLINE_EVIDENCE_ENABLED: bool.default(true),
  OFFLINE_EVIDENCE_REQUIRES_REVIEW: bool.default(true),
  OFFLINE_SYNC_MAX_RETRIES: bounded(8, 1, 12),
  OFFLINE_EVIDENCE_MAX_DELAY_HOURS: bounded(24, 1, 48),

  ATTENDANCE_PREFERRED_ACCURACY: bounded(20, 1, 500),
  ATTENDANCE_MAX_ACCURACY: bounded(100, 1, 1000),
  ATTENDANCE_MAX_LOCATION_AGE_SECONDS: bounded(30, 5, 120),
  ATTENDANCE_MAX_SHIFT_HOURS: bounded(24, 12, 48),
  CLOUDINARY_URL: z
    .string()
    .regex(/^cloudinary:\/\/[^\s]+$/)
    .optional(),
  CLOUDINARY_CLOUD_NAME: z.string().min(1).optional(),
  CLOUDINARY_API_KEY: z.string().min(1).optional(),
  CLOUDINARY_API_SECRET: z.string().min(1).optional(),
  CLOUDINARY_FOLDER: z
    .string()
    .regex(/^[A-Za-z0-9_/-]+$/)
    .default('fieldforce/evidence'),
  GEOCODING_REVERSE_URL: z.url({ protocol: /^https$/ }).optional(),
  GEOCODING_USER_AGENT: z.string().min(8).optional(),
  GEOCODING_API_KEY: z.string().min(1).optional(),
  MONGODB_URI: z.string().regex(/^mongodb(?:\+srv)?:\/\/[^\s]+$/),
  MONGODB_CONNECT_TIMEOUT_MS: bounded(8000, 250, 30000),
  JWT_ACCESS_SECRET: z
    .string()
    .min(43)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/),
  JWT_ISSUER: z.string().min(1).default('renuka-api'),
  JWT_AUDIENCE: z.string().min(1).default('renuka-clients'),
  JWT_ACCESS_EXPIRES_IN: z
    .string()
    .regex(/^(?:[1-9]|1[0-5])m$/)
    .default('15m'),
  REFRESH_TOKEN_EXPIRES_DAYS: bounded(30, 1, 30),
  COOKIE_SECURE: bool.optional(),
  COOKIE_SAME_SITE: z.enum(['lax', 'strict']).default('lax'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  ARGON2_MEMORY_KIB: bounded(19456, 19456, 131072),
  ARGON2_TIME_COST: bounded(2, 2, 6),
  ARGON2_PARALLELISM: bounded(1, 1, 4),
  GLOBAL_RATE_LIMIT: bounded(300, 1, 5000),
  LOGIN_RATE_LIMIT: bounded(10, 1, 100),
  REFRESH_RATE_LIMIT: bounded(30, 1, 300),
});

export function readConfig(env: NodeJS.ProcessEnv) {
  const result = schema.safeParse({
    ...env,
    OFFLINE_VISITS_ENABLED:
      env.OFFLINE_VISITS_ENABLED ?? (env.NODE_ENV === 'production' ? 'false' : undefined),
    OFFLINE_EVIDENCE_ENABLED:
      env.OFFLINE_EVIDENCE_ENABLED ?? (env.NODE_ENV === 'production' ? 'false' : undefined),
    CLOUDINARY_URL: env.CLOUDINARY_URL || undefined,
    CLOUDINARY_CLOUD_NAME: env.CLOUDINARY_CLOUD_NAME || undefined,
    CLOUDINARY_API_KEY: env.CLOUDINARY_API_KEY || undefined,
    CLOUDINARY_API_SECRET: env.CLOUDINARY_API_SECRET || undefined,
    GEOCODING_REVERSE_URL: env.GEOCODING_REVERSE_URL || undefined,
    GEOCODING_USER_AGENT: env.GEOCODING_USER_AGENT || undefined,
    GEOCODING_API_KEY: env.GEOCODING_API_KEY || undefined,
    ADMIN_ORIGINS: env.ADMIN_ORIGINS ?? env.ADMIN_WEB_ORIGIN,
    EMPLOYEE_WEB_ORIGINS: env.EMPLOYEE_WEB_ORIGINS,
  });
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error('Invalid environment configuration: ' + fields);
  }
  const config = result.data;
  if (
    !config.CLOUDINARY_URL &&
    [config.CLOUDINARY_CLOUD_NAME, config.CLOUDINARY_API_KEY, config.CLOUDINARY_API_SECRET].filter(
      Boolean,
    ).length %
      3 !==
      0
  ) {
    throw new Error('Configure all Cloudinary credential fields');
  }
  if (config.ATTENDANCE_PREFERRED_ACCURACY > config.ATTENDANCE_MAX_ACCURACY) {
    throw new Error('Attendance preferred accuracy cannot exceed maximum accuracy');
  }
  for (const url of [
    config.MOBILE_DOWNLOAD_PAGE_URL,
    config.ANDROID_APK_URL,
    config.IOS_INSTALL_URL,
  ]) {
    if (url && !config.MOBILE_RELEASE_APPROVED_ORIGINS.includes(new URL(url).origin))
      throw new Error('Mobile release URLs must use explicitly approved HTTPS origins');
  }
  const versionKey = (value: string) =>
    value.split('.').reduce((total, part) => total * 100_000 + Number(part), 0);
  for (const [min, latest] of [
    [config.ANDROID_MIN_VERSION, config.ANDROID_LATEST_VERSION],
    [config.IOS_MIN_VERSION, config.IOS_LATEST_VERSION],
  ]) {
    if (min && latest && versionKey(min) > versionKey(latest))
      throw new Error('Minimum mobile version cannot exceed the latest version');
  }
  const secure = config.COOKIE_SECURE ?? config.NODE_ENV === 'production';
  if (
    config.NODE_ENV === 'production' &&
    (!secure ||
      [...config.ADMIN_ORIGINS, ...config.EMPLOYEE_WEB_ORIGINS].some(
        (value) => !value.startsWith('https://'),
      ))
  ) {
    throw new Error('Production requires secure cookies and HTTPS admin origins');
  }
  if (config.NODE_ENV === 'production') {
    const parameters = new URLSearchParams(config.MONGODB_URI.split('?')[1]);
    for (const [name, value] of parameters) {
      if (/^(tls|ssl)$/i.test(name) && value.toLowerCase() === 'false') {
        throw new Error('Production MongoDB connections require TLS');
      }
      if (
        /^(tlsInsecure|tlsAllowInvalidCertificates|tlsAllowInvalidHostnames)$/i.test(name) &&
        value.toLowerCase() !== 'false'
      ) {
        throw new Error(
          'Production MongoDB connections require certificate and hostname validation',
        );
      }
    }
  }
  return { ...config, COOKIE_SECURE: secure };
}
export type Config = ReturnType<typeof readConfig>;
