-- ════════════════════════════════════════════════════════════════════════
-- ADMIN USER CHECK — run in Railway → Database → Data tab (SQL editor)
-- ════════════════════════════════════════════════════════════════════════
-- Jake runs this manually; Claude cannot run it.
-- ════════════════════════════════════════════════════════════════════════

SELECT
  email,
  role,
  is_active,
  failed_login_attempts,
  locked_until,
  last_login_at,
  created_at
FROM admin_users;

-- Expected:
--   email:                 admin@taproot-pos.com
--   role:                  super_admin
--   is_active:             true
--   failed_login_attempts: 0
--   locked_until:          null  (NULL = not locked)
--   last_login_at:         a recent timestamp (logins were tested)
--
-- NOTE: As of 2026-06-10 the password was rotated OFF the seeded default.
-- Live login is verified working with the new password (HTTP 200), and the
-- old seeded password `TaprootAdmin2026!` now returns 401. The password_hash
-- column is intentionally NOT selected above (don't echo secrets).

-- ── If locked_until IS set (account locked) — unlock: ───────────────────
-- UPDATE admin_users
-- SET failed_login_attempts = 0,
--     locked_until = NULL
-- WHERE email = 'admin@taproot-pos.com';

-- ── If NO rows returned ─────────────────────────────────────────────────
-- migration 022 not applied AND startup self-seed didn't run.
--   1. Run migrations (see MIGRATIONS_CHECK.sql), then restart the service.
--   2. The app self-seeds admin@taproot-pos.com on boot (index.ts) with the
--      DEFAULT password TaprootAdmin2026! if the row is missing — so a fresh
--      seed resets to the default. Re-rotate the password afterward via the
--      admin portal Account tab (self-service change-password endpoint).

-- ── Rotate the admin password the SAFE way (no raw hash pasting) ────────
-- Use the admin portal: /admin → Account tab → Change password
-- (backend: POST /api/v1/admin/auth/change-password). This avoids the
-- copy/paste-a-bcrypt-hash failure mode entirely.
