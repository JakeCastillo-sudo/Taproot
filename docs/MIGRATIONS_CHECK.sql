-- ════════════════════════════════════════════════════════════════════════
-- MIGRATIONS CHECK — run in Railway → Database → Data tab (SQL editor)
-- ════════════════════════════════════════════════════════════════════════
-- Jake runs this manually; Claude cannot run it (no DB access from the session).
--
-- Local migration files: 22 (001_initial_schema … 022_admin_users)
-- Expected applied rows: 22
-- ════════════════════════════════════════════════════════════════════════

SELECT name, run_on::date AS applied_on
FROM pgmigrations
ORDER BY run_on;

-- Expected: 22 rows, in this order:
--   001_initial_schema
--   002_seed_data
--   003_password_reset_tokens
--   004_mfa_backup_codes
--   005_stripe_connect
--   006_customer_search
--   007_db_security
--   008_demo_enrich
--   009_subscriptions
--   010_partner_codes
--   011_day_parts
--   012_product_archive
--   013_org_settings
--   014_employee_hourly_rate
--   015_cash_drawer
--   016_reservations
--   017_franchise
--   018_api_keys
--   019_allergens
--   020_performance_indexes
--   021_time_clock
--   022_admin_users
--
-- Quick count check (should return 22):
--   SELECT COUNT(*) FROM pgmigrations;
--
-- ── If any are MISSING ──────────────────────────────────────────────────
-- Run in the Railway service **Console/Shell** tab (NOT the Data tab):
--   npx node-pg-migrate up --migrations-dir migrations
--
-- NOTE: migration 022_admin_users creates admin_users/admin_sessions/
-- helpdesk_* tables AND seeds the super admin. If row 022 is present, the
-- admin portal schema exists. (The app also self-seeds the admin user at
-- startup via index.ts as a backstop — see ADMIN_USER_CHECK.sql.)
