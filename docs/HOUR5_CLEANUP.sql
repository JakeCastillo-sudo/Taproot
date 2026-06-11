-- ════════════════════════════════════════════════════════════════════════
-- HOUR 5 CLEANUP — remove all automated-test data (run in Railway → Data tab)
-- ════════════════════════════════════════════════════════════════════════
-- Jake runs this manually. Claude cannot run it (no direct DB write access).
--
-- Demo org id: 10000000-0000-0000-0000-000000000001 (demo-restaurant)
-- NOTE: Hour 5 created NO data on demo-restaurant (mutating tests ran on a
-- disposable test org). The demo items below are leftovers from Hours 3–4.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Soft-delete the Hour-4 test products on demo-restaurant ──────────────
-- (soft delete keeps referential integrity; they vanish from POS immediately)
UPDATE products
SET deleted_at = NOW()
WHERE organization_id = '10000000-0000-0000-0000-000000000001'
  AND name IN ('Import Test Burger', 'Import Test Fries', 'Import Test Shake')
  AND deleted_at IS NULL;

-- ── 2. (Optional) void the Hour-3 test order on demo so it leaves sales ─────
-- A single $11.98 cash order (Acai Yogurt Parfait). Voiding removes it from
-- gross-sales/EOD. Skip if you don't mind one test ticket in demo history.
UPDATE orders
SET status = 'voided', void_reason = 'hour-3 automated test', voided_at = NOW()
WHERE organization_id = '10000000-0000-0000-0000-000000000001'
  AND order_number = 'T-2026-000008'
  AND status <> 'voided';

-- ── 3. Delete the automated-test organizations (CASCADE removes their data) ─
-- These are empty trial orgs created by Hours 3–5 registration/isolation tests.
-- Review first:
SELECT id, name, slug, created_at
FROM organizations
WHERE slug LIKE 'production-test-%'   -- Hour 5 (e.g. production-test-1781148870)
   OR slug LIKE 'iso-test-%'          -- Hour 3 isolation test
   OR slug = 'hour-3-test-restaurant' -- Hour 3 registration test
ORDER BY created_at;

-- Then delete them (organizations FKs are ON DELETE CASCADE → employees,
-- locations, products, orders, import_jobs, etc. for those orgs are removed):
DELETE FROM organizations
WHERE slug LIKE 'production-test-%'
   OR slug LIKE 'iso-test-%'
   OR slug = 'hour-3-test-restaurant';

-- ── 4. Verify demo is intact ───────────────────────────────────────────────
SELECT COUNT(*) AS demo_active_products
FROM products
WHERE organization_id = '10000000-0000-0000-0000-000000000001'
  AND deleted_at IS NULL
  AND archived_at IS NULL;
-- Expect ~84 (the seeded demo menu, minus the 3 soft-deleted test items above).

-- Confirm no test orgs remain:
SELECT COUNT(*) AS leftover_test_orgs
FROM organizations
WHERE slug LIKE 'production-test-%' OR slug LIKE 'iso-test-%'
   OR slug = 'hour-3-test-restaurant';
-- Expect 0.
