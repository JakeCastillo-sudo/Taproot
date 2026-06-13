-- ═══════════════════════════════════════════════
-- REMOVE DEMO DATA FROM PRODUCTION
-- Run ONLY when ready — data cannot be recovered
-- Demo org kept for internal testing until then
-- ═══════════════════════════════════════════════

-- Step 1: Preview (safe to run anytime)
SELECT id, name, slug, subscription_status
FROM organizations
WHERE slug = 'demo-restaurant';

-- Step 2: Verify all real orgs are separate
SELECT id, name, slug, created_at
FROM organizations
WHERE slug != 'demo-restaurant'
ORDER BY created_at;

-- Step 3: Remove demo org and ALL related data
-- (CASCADE deletes products, orders, employees, etc.)
-- UNCOMMENT ONLY WHEN READY:
-- DELETE FROM organizations
-- WHERE slug = 'demo-restaurant';

-- Step 4: Verify after deletion
-- SELECT COUNT(*) as remaining_orgs
-- FROM organizations;
