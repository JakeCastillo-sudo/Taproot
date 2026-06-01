import 'dotenv/config';

/**
 * Taproot POS — centralised configuration.
 *
 * All values are read from environment variables with sensible dev defaults.
 * Call validateConfig() once at startup — it will throw immediately if any
 * required variable is missing or malformed, preventing silent mis-configs.
 *
 * @see docs/API.md → "Environment Variables" section for required values.
 */
export const config = {
  // ─── Core ────────────────────────────────────────────────────────────────────

  /** Runtime environment. Defaults to 'development'. */
  NODE_ENV: (process.env.NODE_ENV ?? 'development') as 'development' | 'production' | 'test',

  /** HTTP port the API server listens on. Default: 3001. */
  PORT: parseInt(process.env.PORT ?? '3001', 10),

  /**
   * PostgreSQL connection string.
   * Format: postgres://user:pass@host:5432/dbname
   * Production: must include ?sslmode=require
   * @example DATABASE_URL=postgres://taproot_app:secret@db:5432/taproot_prod?sslmode=require
   */
  DATABASE_URL: process.env.DATABASE_URL ?? '',

  // ─── JWT ─────────────────────────────────────────────────────────────────────

  /**
   * HMAC secret for signing/verifying JWT access tokens (HS256).
   * Production: must be >= 64 characters (512 bits).
   * Generate: openssl rand -hex 64
   */
  JWT_SECRET: process.env.JWT_SECRET ?? '',

  /**
   * RSA private key for RS256 JWT signing (optional — overrides HS256 when set).
   * Format: PEM-encoded RSA private key.
   * Both RSA keys must be set together or not at all.
   */
  JWT_RS256_PRIVATE_KEY: process.env.JWT_RS256_PRIVATE_KEY,

  /**
   * RSA public key for RS256 JWT verification (required if private key is set).
   * Format: PEM-encoded RSA public key.
   */
  JWT_RS256_PUBLIC_KEY: process.env.JWT_RS256_PUBLIC_KEY,

  /**
   * Short-lived MFA pending token secret (separate from JWT_SECRET).
   * Used for the 5-minute MFA challenge token.
   * Generate: openssl rand -hex 32
   */
  MFA_TOKEN_SECRET: process.env.MFA_TOKEN_SECRET ?? '',

  /**
   * AES-256-GCM key for encrypting TOTP secrets at rest.
   * Must be exactly 64 hex characters (32 bytes).
   * Generate: openssl rand -hex 32
   */
  MFA_ENCRYPTION_KEY: process.env.MFA_ENCRYPTION_KEY ?? '',

  /**
   * AES-256-GCM key for encrypting offline card data in Redis.
   * Must be exactly 64 hex characters (32 bytes).
   * Generate: openssl rand -hex 32
   */
  OFFLINE_ENCRYPTION_KEY: process.env.OFFLINE_ENCRYPTION_KEY ?? '',

  // ─── Redis ───────────────────────────────────────────────────────────────────

  /**
   * Redis connection URL. Optional in development — degrades real-time features
   * gracefully when unavailable.
   * @example REDIS_URL=redis://:password@redis:6379/0
   */
  REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',

  // ─── Stripe ──────────────────────────────────────────────────────────────────

  /**
   * Stripe platform secret key.
   * Development: sk_test_...
   * Production:  sk_live_... (validated at startup in production)
   * @see https://dashboard.stripe.com/apikeys
   */
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ?? '',

  /**
   * Webhook signing secret for direct Stripe events (charges, refunds).
   * Production: must start with 'whsec_'.
   * @see https://dashboard.stripe.com/webhooks
   */
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET ?? '',

  /**
   * Webhook signing secret for Stripe Connect account events.
   * Production: must start with 'whsec_'.
   */
  STRIPE_CONNECT_WEBHOOK_SECRET: process.env.STRIPE_CONNECT_WEBHOOK_SECRET ?? '',

  /**
   * Webhook signing secret for Stripe Terminal reader events.
   * Production: must start with 'whsec_'.
   */
  STRIPE_TERMINAL_WEBHOOK_SECRET: process.env.STRIPE_TERMINAL_WEBHOOK_SECRET ?? '',

  /**
   * ISV application fee as a fraction of GPV.
   * Default: 0.003 (0.3%).
   * @example TAPROOT_APPLICATION_FEE_RATE=0.005
   */
  TAPROOT_APPLICATION_FEE_RATE: parseFloat(
    process.env.TAPROOT_APPLICATION_FEE_RATE ?? '0.003',
  ),

  // ─── SMTP ────────────────────────────────────────────────────────────────────

  /** SMTP hostname for transactional email. Optional in development. */
  SMTP_HOST: process.env.SMTP_HOST,

  /** SMTP port. Default: 587 (STARTTLS). */
  SMTP_PORT: parseInt(process.env.SMTP_PORT ?? '587', 10),

  /** Use SMTP TLS. Set to 'true' for port 465. */
  SMTP_SECURE: process.env.SMTP_SECURE === 'true',

  /** SMTP username / login. */
  SMTP_USER: process.env.SMTP_USER,

  /** SMTP password. */
  SMTP_PASS: process.env.SMTP_PASS,

  /**
   * From address for all outgoing email.
   * @example SMTP_FROM=receipts@myrestaurant.com
   */
  SMTP_FROM: process.env.SMTP_FROM ?? 'noreply@taproot.pos',

  /**
   * Public URL of the web app — used in email links and CORS.
   * @example APP_URL=https://pos.myrestaurant.com
   */
  APP_URL: process.env.APP_URL ?? 'http://localhost:5173',

  // ─── AI ──────────────────────────────────────────────────────────────────────

  /**
   * Anthropic API key for Claude document parsing and NL analytics.
   * @see https://console.anthropic.com/account/keys
   * @example ANTHROPIC_API_KEY=sk-ant-api03-...
   */
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',

  // ─── File storage ─────────────────────────────────────────────────────────────

  /**
   * Local upload directory relative to CWD. Used in development.
   * Production: files are written here then uploaded to S3.
   */
  UPLOADS_DIR: process.env.UPLOADS_DIR ?? 'uploads',

  /** S3 bucket name for uploaded documents. Optional in dev. */
  S3_BUCKET: process.env.S3_BUCKET,

  /** AWS region for S3. */
  S3_REGION: process.env.S3_REGION,

  /** AWS access key ID. */
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,

  /** AWS secret access key. */
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,

  // ─── Token lifetimes ──────────────────────────────────────────────────────────

  /** JWT access token expiry string (jsonwebtoken format). */
  ACCESS_TOKEN_EXPIRY:         '15m'     as const,
  /** JWT refresh token expiry string. */
  REFRESH_TOKEN_EXPIRY:        '30d'     as const,
  /** MFA pending token expiry string. */
  MFA_TOKEN_EXPIRY:            '5m'      as const,
  /** Access token expiry in seconds (for cookie maxAge). */
  ACCESS_TOKEN_EXPIRY_SECONDS: 900,
  /** Refresh token expiry in milliseconds (for DB expiry calculation). */
  REFRESH_TOKEN_EXPIRY_MS:     30 * 24 * 60 * 60 * 1000,
  /** MFA token expiry in seconds. */
  MFA_TOKEN_EXPIRY_SECONDS:    300,

  // ─── Auth policy ─────────────────────────────────────────────────────────────

  /** bcrypt rounds for employee password hashing. */
  BCRYPT_ROUNDS:              12,
  /** bcrypt rounds for PIN hashing (faster for cashier PINs). */
  PIN_BCRYPT_ROUNDS:          10,
  /** Failed login attempts before account lockout. */
  LOCKOUT_MAX_ATTEMPTS:       5,
  /** Account lockout duration in minutes. */
  LOCKOUT_DURATION_MINUTES:   15,
  /** Password reset token expiry (1 hour). */
  PASSWORD_RESET_EXPIRY_MS:   60 * 60 * 1000,
} as const;

// ─── Startup validation ───────────────────────────────────────────────────────

export function validateConfig(): void {
  const errors: string[] = [];

  // ── Always required ─────────────────────────────────────────────────────────
  const required: Array<keyof typeof config> = [
    'DATABASE_URL',
    'JWT_SECRET',
    'MFA_TOKEN_SECRET',
    'MFA_ENCRYPTION_KEY',
  ];

  for (const key of required) {
    if (!config[key]) errors.push(`Missing required environment variable: ${key}`);
  }

  // ── Key-length checks ───────────────────────────────────────────────────────
  if (config.MFA_ENCRYPTION_KEY && config.MFA_ENCRYPTION_KEY.length !== 64) {
    errors.push('MFA_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)');
  }

  if (config.OFFLINE_ENCRYPTION_KEY && config.OFFLINE_ENCRYPTION_KEY.length !== 64) {
    errors.push('OFFLINE_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)');
  }

  if (config.JWT_RS256_PRIVATE_KEY && !config.JWT_RS256_PUBLIC_KEY) {
    errors.push('JWT_RS256_PUBLIC_KEY is required when JWT_RS256_PRIVATE_KEY is set');
  }

  // ── Production-only strict checks ──────────────────────────────────────────
  if (config.NODE_ENV === 'production') {
    if (config.JWT_SECRET.length < 64) {
      errors.push('JWT_SECRET must be >= 64 characters in production (use openssl rand -hex 64)');
    }

    if (config.STRIPE_SECRET_KEY && !config.STRIPE_SECRET_KEY.startsWith('sk_live_')) {
      errors.push('STRIPE_SECRET_KEY must start with "sk_live_" in production');
    }

    if (config.STRIPE_WEBHOOK_SECRET && !config.STRIPE_WEBHOOK_SECRET.startsWith('whsec_')) {
      errors.push('STRIPE_WEBHOOK_SECRET must start with "whsec_" in production');
    }

    if (config.STRIPE_CONNECT_WEBHOOK_SECRET &&
        !config.STRIPE_CONNECT_WEBHOOK_SECRET.startsWith('whsec_')) {
      errors.push('STRIPE_CONNECT_WEBHOOK_SECRET must start with "whsec_" in production');
    }

    if (!config.DATABASE_URL.includes('sslmode=require') &&
        !config.DATABASE_URL.includes('ssl=true')) {
      errors.push('DATABASE_URL must use SSL in production (append ?sslmode=require)');
    }

    if (!config.ANTHROPIC_API_KEY) {
      errors.push('ANTHROPIC_API_KEY is required in production for AI features');
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Configuration errors:\n${errors.map((e) => `  • ${e}`).join('\n')}`,
    );
  }
}
