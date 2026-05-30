import { z } from 'zod';

// ─── Reusable primitives ──────────────────────────────────────────────────────

const uuidSchema = z.string().uuid();

const emailSchema = z
  .string()
  .email('Invalid email address')
  .toLowerCase()
  .max(255);

const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?])/,
    'Password must contain uppercase, lowercase, number, and special character',
  );

const totpCodeSchema = z
  .string()
  .regex(/^\d{6}$/, 'TOTP code must be exactly 6 digits');

// ─── Request body schemas ─────────────────────────────────────────────────────

export const loginBodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(128),
  locationId: uuidSchema.optional(),
});

export const loginMfaBodySchema = z.object({
  mfaToken: z.string().min(1),
  totpCode: totpCodeSchema,
});

export const loginPinBodySchema = z.object({
  employeeId: uuidSchema,
  pin: z.string().regex(/^\d{4,6}$/, 'PIN must be 4–6 digits'),
  locationId: uuidSchema,
});

export const refreshBodySchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export const mfaSetupSchema = z.object({});

export const mfaVerifySchema = z.object({
  code: totpCodeSchema,
});

export const mfaDisableSchema = z.object({
  password: z.string().min(1),
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export const passwordResetRequestSchema = z.object({
  email: emailSchema,
});

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(1),
  newPassword: passwordSchema,
});

// ─── Inferred TypeScript types ────────────────────────────────────────────────

export type LoginBody             = z.infer<typeof loginBodySchema>;
export type LoginMfaBody          = z.infer<typeof loginMfaBodySchema>;
export type LoginPinBody          = z.infer<typeof loginPinBodySchema>;
export type RefreshBody           = z.infer<typeof refreshBodySchema>;
export type MfaVerifyBody         = z.infer<typeof mfaVerifySchema>;
export type MfaDisableBody        = z.infer<typeof mfaDisableSchema>;
export type PasswordChangeBody    = z.infer<typeof passwordChangeSchema>;
export type PasswordResetRequest  = z.infer<typeof passwordResetRequestSchema>;
export type PasswordResetConfirm  = z.infer<typeof passwordResetConfirmSchema>;

// ─── Fastify JSON response schemas (used by Fastify's serializer) ─────────────

export const employeeResponseSchema = {
  type: 'object',
  properties: {
    id:          { type: 'string' },
    email:       { type: 'string' },
    firstName:   { type: 'string' },
    lastName:    { type: 'string' },
    role:        { type: 'string' },
    permissions: { type: 'array', items: { type: 'string' } },
    locationIds: { type: 'array', items: { type: 'string' } },
  },
} as const;

export const loginResponseSchema = {
  type: 'object',
  properties: {
    accessToken:  { type: 'string' },
    refreshToken: { type: 'string' },
    expiresIn:    { type: 'number' },
    employee:     employeeResponseSchema,
  },
} as const;

export const mfaRequiredResponseSchema = {
  type: 'object',
  properties: {
    requiresMfa: { type: 'boolean' },
    mfaToken:    { type: 'string' },
  },
} as const;

export const successResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
  },
} as const;

export const mfaSetupResponseSchema = {
  type: 'object',
  properties: {
    secret:  { type: 'string' },
    qrUri:   { type: 'string' },
  },
} as const;

export const mfaVerifyResponseSchema = {
  type: 'object',
  properties: {
    success:     { type: 'boolean' },
    backupCodes: { type: 'array', items: { type: 'string' } },
  },
} as const;

// ─── Zod parse helper: throws ValidationError on failure ─────────────────────

import { ValidationError } from '../errors';

export function parseBody<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError(
      result.error.errors.map((e) => e.message).join('; '),
      result.error.flatten(),
    );
  }
  return result.data;
}
