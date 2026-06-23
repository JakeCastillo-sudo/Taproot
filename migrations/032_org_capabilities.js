/**
 * 032 — organizations.capabilities (v2.0 capability foundation)
 *
 * Adds a JSONB `capabilities` column to organizations — the per-org feature spine
 * the v2.x multi-vertical platform renders on (food_service / studio / retail +
 * a billing_models menu). This generalizes the products.recipe_mode gate to the
 * ORG level: UI/routes/features render on these flags so one codebase serves
 * restaurants, studios, retail, and hybrids. See docs/ROADMAP.md (v2.0.0) and
 * docs/V2_0_SANDBOX_NOTES.md.
 *
 * Shape (documented in capability.service.ts as the source of truth):
 *   {
 *     "food_service": true,
 *     "studio": false,
 *     "retail": false,
 *     "billing_models": {
 *       "drop_in": false, "class_packs": false, "free_trial": false,
 *       "memberships": false, "classpass": false
 *     }
 *   }
 *
 * BACKFILL / DEFAULT-ON: every existing org is a restaurant, so the backfill sets
 * them to food_service:true and nothing regresses. The column DEFAULT is the empty
 * object '{}'; capability.service ALSO treats an empty/absent value as
 * food_service:true (belt-and-suspenders), so existing behavior is identical
 * whether or not this backfill ran — and the code is safe BEFORE this migration runs.
 *
 * Pattern matches 029/030/031 (raw pgm.sql, IF NOT EXISTS). DO NOT run here —
 * Jake runs it in Railway after review (two-step verify in the sandbox notes).
 */

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS capabilities jsonb NOT NULL DEFAULT '{}'::jsonb;
  `);

  // Backfill existing orgs (all restaurants today) to the food_service default.
  // Only touches rows still at the empty default, so it is safe to re-run.
  pgm.sql(`
    UPDATE organizations
       SET capabilities = '{
         "food_service": true,
         "studio": false,
         "retail": false,
         "billing_models": {
           "drop_in": false,
           "class_packs": false,
           "free_trial": false,
           "memberships": false,
           "classpass": false
         }
       }'::jsonb
     WHERE capabilities = '{}'::jsonb;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE organizations DROP COLUMN IF EXISTS capabilities;`);
};
