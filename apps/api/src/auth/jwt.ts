import jwt from 'jsonwebtoken';
import { config } from '../config';
import { TokenExpiredError, TokenInvalidError } from '../errors';
import type { EmployeeRole } from '@taproot/shared';

// ─── Payload interfaces ───────────────────────────────────────────────────────

export interface AccessTokenPayload {
  sub: string;           // employee.id
  orgId: string;         // organization.id
  locationIds: string[]; // accessible location IDs; [] = all
  role: EmployeeRole;
  permissions: string[];
  sessionId: string;     // refresh_tokens.id — used for revocation
  iat: number;
  exp: number;
}

export interface RefreshTokenPayload {
  sub: string;      // employee.id
  sessionId: string;
  iat: number;
  exp: number;
}

export interface MfaTokenPayload {
  sub: string;        // employee.id
  orgId: string;
  mfaPending: true;
  iat: number;
  exp: number;
}

// ─── Key resolution ───────────────────────────────────────────────────────────

const useRsa = !!(config.JWT_RS256_PRIVATE_KEY && config.JWT_RS256_PUBLIC_KEY);
const algorithm: jwt.Algorithm = useRsa ? 'RS256' : 'HS256';
const accessSignKey = useRsa
  ? Buffer.from(config.JWT_RS256_PRIVATE_KEY!, 'utf8')
  : config.JWT_SECRET;
const accessVerifyKey = useRsa
  ? Buffer.from(config.JWT_RS256_PUBLIC_KEY!, 'utf8')
  : config.JWT_SECRET;

// ─── Access tokens ────────────────────────────────────────────────────────────

export function signAccessToken(
  payload: Omit<AccessTokenPayload, 'iat' | 'exp'>,
): string {
  return jwt.sign(payload, accessSignKey, {
    algorithm,
    expiresIn: config.ACCESS_TOKEN_EXPIRY,
    notBefore: 0,
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    return jwt.verify(token, accessVerifyKey, {
      algorithms: [algorithm],
    }) as AccessTokenPayload;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) throw new TokenExpiredError();
    throw new TokenInvalidError();
  }
}

// ─── Refresh tokens ───────────────────────────────────────────────────────────
// Always HS256 regardless of access token algorithm — refresh tokens are server-only

export function signRefreshToken(employeeId: string, sessionId: string): string {
  return jwt.sign({ sub: employeeId, sessionId }, config.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: config.REFRESH_TOKEN_EXPIRY,
  });
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  try {
    return jwt.verify(token, config.JWT_SECRET, {
      algorithms: ['HS256'],
    }) as RefreshTokenPayload;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) throw new TokenExpiredError();
    throw new TokenInvalidError();
  }
}

// ─── MFA pending tokens ───────────────────────────────────────────────────────

export function signMfaToken(employeeId: string, orgId: string): string {
  const payload: Omit<MfaTokenPayload, 'iat' | 'exp'> = {
    sub: employeeId,
    orgId,
    mfaPending: true,
  };
  return jwt.sign(payload, config.MFA_TOKEN_SECRET, {
    algorithm: 'HS256',
    expiresIn: config.MFA_TOKEN_EXPIRY,
  });
}

export function verifyMfaToken(token: string): MfaTokenPayload {
  try {
    const payload = jwt.verify(token, config.MFA_TOKEN_SECRET, {
      algorithms: ['HS256'],
    }) as MfaTokenPayload;
    if (!payload.mfaPending) throw new TokenInvalidError('Not an MFA pending token');
    return payload;
  } catch (err) {
    if (err instanceof TokenInvalidError || err instanceof TokenExpiredError) throw err;
    if (err instanceof jwt.TokenExpiredError) throw new TokenExpiredError();
    throw new TokenInvalidError();
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

export function extractBearerToken(authHeader: string | undefined): string {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new TokenInvalidError('Missing or malformed Authorization header');
  }
  const token = authHeader.slice(7).trim();
  if (!token) throw new TokenInvalidError('Empty bearer token');
  return token;
}
