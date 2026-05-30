import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { authenticator } from 'otplib';
import { config } from '../config';
import { AuthError } from '../errors';

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{10,}$/;
const PIN_REGEX = /^\d{4,6}$/;

// ─── Password ────────────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  if (!PASSWORD_REGEX.test(password)) {
    throw new AuthError(
      'PASSWORD_TOO_WEAK',
      'Password must be at least 10 characters and include uppercase, lowercase, number, and special character.',
      400,
    );
  }
  return bcrypt.hash(password, config.BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

// ─── PIN ─────────────────────────────────────────────────────────────────────

export async function hashPin(pin: string): Promise<string> {
  if (!PIN_REGEX.test(pin)) {
    throw new AuthError('PIN_INVALID', 'PIN must be 4–6 digits.', 400);
  }
  return bcrypt.hash(pin, config.PIN_BCRYPT_ROUNDS);
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(pin, hash);
  } catch {
    return false;
  }
}

// ─── Token hashing ───────────────────────────────────────────────────────────

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateSecureToken(byteLength = 32): string {
  return crypto.randomBytes(byteLength).toString('base64url');
}

// ─── TOTP ─────────────────────────────────────────────────────────────────────

authenticator.options = { window: 1, step: 30 };

export function generateTotpSecret(): string {
  // Returns a 20-byte (160-bit) base32-encoded secret
  return authenticator.generateSecret(20);
}

export function verifyTotpCode(secret: string, code: string): boolean {
  try {
    return authenticator.verify({ token: code, secret });
  } catch {
    return false;
  }
}

export function generateTotpQrUri(secret: string, email: string, issuer: string): string {
  return authenticator.keyuri(email, issuer, secret);
}

// ─── AES-256-GCM encryption for TOTP secrets ─────────────────────────────────

export function encryptTotpSecret(plaintext: string): string {
  const key = Buffer.from(config.MFA_ENCRYPTION_KEY, 'hex');
  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv_hex:tag_hex:ciphertext_hex
  return [iv.toString('hex'), tag.toString('hex'), encrypted.toString('hex')].join(':');
}

export function decryptTotpSecret(encryptedStr: string): string {
  const parts = encryptedStr.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted TOTP secret format');
  const [ivHex, tagHex, ciphertextHex] = parts;
  const key = Buffer.from(config.MFA_ENCRYPTION_KEY, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// ─── MFA backup codes ─────────────────────────────────────────────────────────

export function generateBackupCodes(count = 8): string[] {
  // Each code is 8 alphanumeric characters grouped as XXXX-XXXX
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars (0/O, 1/I)
  return Array.from({ length: count }, () => {
    const half = Array.from({ length: 4 }, () => chars[crypto.randomInt(chars.length)]).join('');
    const other = Array.from({ length: 4 }, () => chars[crypto.randomInt(chars.length)]).join('');
    return `${half}-${other}`;
  });
}

export function hashBackupCode(code: string): string {
  // Normalize: strip dashes and uppercase before hashing
  const normalized = code.replace(/-/g, '').toUpperCase();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

// Prevent timing attacks when no hash to compare against
export async function dummyPasswordDelay(): Promise<void> {
  await bcrypt.compare('dummy_plaintext_for_timing', '$2b$12$invalidhashpadding.invalidhashpadding.invalidhashpadding');
}
