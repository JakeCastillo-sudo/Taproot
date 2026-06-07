-- ============================================================================
-- DEMO DATA FIX — run in Railway console (Taproot → Console)
-- ============================================================================
-- Demo org: Haven Health Bar = 10000000-0000-0000-0000-000000000001
--
-- NOTE (2026-06-07): the demo's $0.00 products were ALREADY fixed in the
-- "perfection pass" — placeholder café prices were assigned via the products
-- API, so all 50 demo products should already have a price (50/50 priced).
-- This file is therefore a DIAGNOSTIC + a SAFE guarded cleanup, NOT a blind
-- delete. Run step 1 first; only run step 2/3 if step 1 shows $0 items.
-- ============================================================================

-- 1) DIAGNOSTIC — list any products whose ACTIVE price is $0 (should be none)
SELECT p.name, COALESCE(pp.price, 0) AS price_cents
FROM products p
LEFT JOIN product_variants pv
       ON pv.product_id = p.id AND pv.deleted_at IS NULL
LEFT JOIN product_prices pp
       ON pp.variant_id = pv.id AND pp.is_active = true
WHERE p.organization_id = '10000000-0000-0000-0000-000000000001'
  AND p.deleted_at IS NULL
  AND p.archived_at IS NULL
  AND COALESCE(pp.price, 0) = 0
ORDER BY p.name;

-- 2) SAFE CLEANUP (only if step 1 returns rows) — ARCHIVE the priceless items
--    (reversible: sets archived_at, hides from POS; does NOT hard-delete).
--    Prefer archiving over DELETE so nothing is lost irreversibly.
-- UPDATE products
--    SET archived_at = now(), archive_reason = 'priceless demo import cleanup'
--  WHERE organization_id = '10000000-0000-0000-0000-000000000001'
--    AND deleted_at IS NULL
--    AND archived_at IS NULL
--    AND id NOT IN (
--      SELECT pv.product_id FROM product_variants pv
--      JOIN product_prices pp ON pp.variant_id = pv.id
--      WHERE pp.is_active = true AND pp.price > 0
--    );

-- 3) VERIFY — every active demo product should now have a price > 0
SELECT p.name, pp.price AS price_cents
FROM products p
JOIN product_variants pv ON pv.product_id = p.id AND pv.deleted_at IS NULL
JOIN product_prices pp   ON pp.variant_id = pv.id AND pp.is_active = true
WHERE p.organization_id = '10000000-0000-0000-0000-000000000001'
  AND p.deleted_at IS NULL
  AND p.archived_at IS NULL
ORDER BY pp.price DESC
LIMIT 50;
