-- ════════════════════════════════════════════════════════════════════════
-- PSR CLEANUP — remove automated-test data (run in Railway → Data tab)
-- ════════════════════════════════════════════════════════════════════════
-- Jake runs this manually; Claude has no DB write access.
-- Demo org id: 10000000-0000-0000-0000-000000000001
--
-- NOTE: The PSR ran all data-MUTATING tests (product create, XSS, negative
-- price, order/void/refund, lifecycle) on a DISPOSABLE test org — NOT on
-- demo-restaurant. So deleting the test orgs (step 2) removes almost everything.
-- Step 1 is a safety net for any stray demo test rows from earlier sessions.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Soft-delete any stray test products on demo (from earlier sessions) ──
UPDATE products
SET deleted_at = NOW()
WHERE organization_id = '10000000-0000-0000-0000-000000000001'
  AND deleted_at IS NULL
  AND (name LIKE 'PSR%'
    OR name LIKE 'CP2%'
    OR name LIKE 'Import Test%'
    OR name LIKE 'Negative Price%'
    OR name = 'alert(document.cookie)');

-- ── 2. Delete the automated-test organizations (CASCADE removes all children:
--       employees, locations, products, variants, prices, orders, payments,
--       import_jobs, etc. for those orgs) ───────────────────────────────────
-- Review first:
SELECT id, name, slug, created_at
FROM organizations
WHERE slug LIKE 'psr-isolation-test-%'   -- PSR isolation test orgs
   OR slug LIKE 'production-test-%'       -- Hour 5 cert test
   OR slug LIKE 'iso-test-%'              -- Hour 3 isolation test
   OR slug = 'hour-3-test-restaurant'     -- Hour 3 registration test
ORDER BY created_at;

-- Then delete:
DELETE FROM organizations
WHERE slug LIKE 'psr-isolation-test-%'
   OR slug LIKE 'production-test-%'
   OR slug LIKE 'iso-test-%'
   OR slug = 'hour-3-test-restaurant';

-- ── 3. (Optional) clear the demo password-reset token created by test 1.1.6 ─
-- Harmless (single-use, time-limited) but removable:
DELETE FROM password_reset_tokens
WHERE employee_id IN (
  SELECT id FROM employees WHERE email = 'demo@taproot.pos'
) AND used_at IS NULL AND created_at > NOW() - INTERVAL '1 day';

-- ── 4. Unlock the demo account IF it ever got locked (PSR did NOT lock it,
--       but include for safety) ──────────────────────────────────────────────
UPDATE employees
SET failed_login_attempts = 0, locked_until = NULL
WHERE email = 'demo@taproot.pos' AND locked_until IS NOT NULL;

-- ── 5. Verify demo intact (sellable product count) ──────────────────────────
SELECT COUNT(DISTINCT p.id) AS demo_sellable_products
FROM products p
JOIN product_variants pv ON pv.product_id = p.id
JOIN product_prices pp ON pp.variant_id = pv.id
WHERE p.organization_id = '10000000-0000-0000-0000-000000000001'
  AND p.deleted_at IS NULL
  AND p.archived_at IS NULL;
-- Expect ~84.

-- Confirm no test orgs remain:
SELECT COUNT(*) AS leftover_test_orgs
FROM organizations
WHERE slug LIKE 'psr-isolation-test-%' OR slug LIKE 'production-test-%'
   OR slug LIKE 'iso-test-%' OR slug = 'hour-3-test-restaurant';
-- Expect 0.
