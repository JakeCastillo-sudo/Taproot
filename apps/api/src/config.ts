export const config = {
  NODE_ENV: (process.env.NODE_ENV ?? 'development') as 'development' | 'production' | 'test',
  PORT: parseInt(process.env.PORT ?? '3001', 10),
  DATABASE_URL: process.env.DATABASE_URL ?? '',

  // JWT — HS256 by default; RS256 if both RSA keys are set
  JWT_SECRET: process.env.JWT_SECRET ?? '',
  JWT_RS256_PRIVATE_KEY: process.env.JWT_RS256_PRIVATE_KEY,
  JWT_RS256_PUBLIC_KEY: process.env.JWT_RS256_PUBLIC_KEY,

  // Separate secret for the short-lived MFA pending token
  MFA_TOKEN_SECRET: process.env.MFA_TOKEN_SECRET ?? '',

  // 32-byte key as 64 hex chars, used for AES-256-GCM encryption of TOTP secrets
  MFA_ENCRYPTION_KEY: process.env.MFA_ENCRYPTION_KEY ?? '',

  // SMTP for transactional email (optional in dev)
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: parseInt(process.env.SMTP_PORT ?? '587', 10),
  SMTP_SECURE: process.env.SMTP_SECURE === 'true',
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  SMTP_FROM: process.env.SMTP_FROM ?? 'noreply@taproot.pos',
  APP_URL: process.env.APP_URL ?? 'http://localhost:5173',

  // Token lifetimes
  ACCESS_TOKEN_EXPIRY: '15m' as const,
  REFRESH_TOKEN_EXPIRY: '30d' as const,
  MFA_TOKEN_EXPIRY: '5m' as const,
  ACCESS_TOKEN_EXPIRY_SECONDS: 900,
  REFRESH_TOKEN_EXPIRY_MS: 30 * 24 * 60 * 60 * 1000,
  MFA_TOKEN_EXPIRY_SECONDS: 300,

  // Auth policy
  BCRYPT_ROUNDS: 12,
  PIN_BCRYPT_ROUNDS: 10,
  LOCKOUT_MAX_ATTEMPTS: 5,
  LOCKOUT_DURATION_MINUTES: 15,
  PASSWORD_RESET_EXPIRY_MS: 60 * 60 * 1000, // 1 hour
} as const;

export function validateConfig(): void {
  const required: Array<keyof typeof config> = [
    'DATABASE_URL',
    'JWT_SECRET',
    'MFA_TOKEN_SECRET',
    'MFA_ENCRYPTION_KEY',
  ];

  for (const key of required) {
    if (!config[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  if (config.MFA_ENCRYPTION_KEY.length !== 64) {
    throw new Error('MFA_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)');
  }

  if (config.JWT_RS256_PRIVATE_KEY && !config.JWT_RS256_PUBLIC_KEY) {
    throw new Error('JWT_RS256_PUBLIC_KEY is required when JWT_RS256_PRIVATE_KEY is set');
  }
}
