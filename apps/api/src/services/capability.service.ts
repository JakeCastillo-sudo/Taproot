/**
 * capability.service — the v2.0 capability spine.
 *
 * Reads/writes organizations.capabilities (JSONB). This generalizes the
 * products.recipe_mode gate to the ORG level: UI/routes/features render on these
 * flags so one codebase serves restaurants, studios, retail, and hybrids.
 *
 * GRACEFUL DEGRADATION (mirrors ingredientSystemReady / deadLetterTableReady):
 * the `capabilities` column does NOT exist until migration 032 runs. Every read
 * defaults to food_service:true (DEFAULT_CAPABILITIES) when the column is absent,
 * the row is missing, or the value is null/empty — so existing restaurants behave
 * EXACTLY as today, both before and after the migration. Reads NEVER throw.
 */
import { query } from '../db/client';
import { ValidationError } from '../errors';
import type { Capabilities, BillingModels } from '@taproot/shared';

// Default-on: a fully-absent/empty capability set means "restaurant", exactly
// today's behavior. Single source of the default-on rule on the backend.
export const DEFAULT_CAPABILITIES: Capabilities = {
  food_service: true,
  studio: false,
  retail: false,
  billing_models: {
    drop_in: false,
    class_packs: false,
    free_trial: false,
    memberships: false,
    classpass: false,
  },
};

export type PresetName = 'restaurant' | 'studio_cafe' | 'retail';

// Presets are just capability bundles an onboarding choice maps to.
export const PRESETS: Record<PresetName, Capabilities> = {
  restaurant: {
    food_service: true, studio: false, retail: false,
    billing_models: { drop_in: false, class_packs: false, free_trial: false, memberships: false, classpass: false },
  },
  studio_cafe: {
    food_service: true, studio: true, retail: false,
    billing_models: { drop_in: true, class_packs: true, free_trial: true, memberships: false, classpass: false },
  },
  retail: {
    food_service: false, studio: false, retail: true,
    billing_models: { drop_in: false, class_packs: false, free_trial: false, memberships: false, classpass: false },
  },
};

export interface CapabilitiesPatch {
  food_service?: boolean;
  studio?: boolean;
  retail?: boolean;
  billing_models?: Partial<BillingModels>;
}

// Deep-clone so callers can never mutate the shared default/preset constants.
function clone(c: Capabilities): Capabilities {
  return { ...c, billing_models: { ...c.billing_models } };
}

// ── Graceful column-existence guard (cached positive, mirrors franchiseReady) ──
let _capabilitiesColumnReady: boolean | null = null;
async function capabilitiesColumnReady(): Promise<boolean> {
  if (_capabilitiesColumnReady !== null) return _capabilitiesColumnReady;
  try {
    const { rows } = await query<{ ready: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_name = 'organizations' AND column_name = 'capabilities'
       ) AS ready`,
    );
    _capabilitiesColumnReady = Boolean(rows[0]?.ready);
  } catch {
    _capabilitiesColumnReady = false;
  }
  return _capabilitiesColumnReady;
}

// Merge a (possibly partial / legacy) stored value onto the default so every field
// is always present — callers never have to null-check a capability. An empty `{}`
// (the column default before backfill) therefore reads as food_service:true.
function normalize(raw: unknown): Capabilities {
  const v = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const bmRaw = (v.billing_models && typeof v.billing_models === 'object')
    ? v.billing_models as Record<string, unknown> : {};
  const bm: BillingModels = {
    drop_in:     Boolean(bmRaw.drop_in     ?? DEFAULT_CAPABILITIES.billing_models.drop_in),
    class_packs: Boolean(bmRaw.class_packs ?? DEFAULT_CAPABILITIES.billing_models.class_packs),
    free_trial:  Boolean(bmRaw.free_trial  ?? DEFAULT_CAPABILITIES.billing_models.free_trial),
    memberships: Boolean(bmRaw.memberships ?? DEFAULT_CAPABILITIES.billing_models.memberships),
    classpass:   Boolean(bmRaw.classpass   ?? DEFAULT_CAPABILITIES.billing_models.classpass),
  };
  return {
    food_service: Boolean(v.food_service ?? DEFAULT_CAPABILITIES.food_service),
    studio:       Boolean(v.studio       ?? DEFAULT_CAPABILITIES.studio),
    retail:       Boolean(v.retail       ?? DEFAULT_CAPABILITIES.retail),
    billing_models: bm,
  };
}

/**
 * Current org capabilities. THE most important function: must NEVER break existing
 * behavior when the column is absent/empty/errored — it returns the food_service
 * default in every such case. Never throws.
 */
export async function getCapabilities(orgId: string): Promise<Capabilities> {
  if (!(await capabilitiesColumnReady())) return clone(DEFAULT_CAPABILITIES);
  try {
    const { rows: [org] } = await query<{ capabilities: unknown }>(
      `SELECT capabilities FROM organizations WHERE id = $1 AND deleted_at IS NULL`,
      [orgId],
    );
    if (!org) return clone(DEFAULT_CAPABILITIES);
    return normalize(org.capabilities);
  } catch {
    // Fail safe to restaurant behavior — a read error must never hide the food UI.
    return clone(DEFAULT_CAPABILITIES);
  }
}

export async function hasCapability(
  orgId: string,
  key: 'food_service' | 'studio' | 'retail',
): Promise<boolean> {
  const caps = await getCapabilities(orgId);
  return Boolean(caps[key]);
}

function mergePatch(current: Capabilities, patch: CapabilitiesPatch): Capabilities {
  return {
    food_service: patch.food_service ?? current.food_service,
    studio:       patch.studio       ?? current.studio,
    retail:       patch.retail       ?? current.retail,
    billing_models: {
      drop_in:     patch.billing_models?.drop_in     ?? current.billing_models.drop_in,
      class_packs: patch.billing_models?.class_packs ?? current.billing_models.class_packs,
      free_trial:  patch.billing_models?.free_trial  ?? current.billing_models.free_trial,
      memberships: patch.billing_models?.memberships ?? current.billing_models.memberships,
      classpass:   patch.billing_models?.classpass   ?? current.billing_models.classpass,
    },
  };
}

/**
 * Merge a partial update into the org's capabilities (owner/manager gated at the
 * route). Validates the shape, then writes the FULL normalized object. Pre-migration
 * it cannot persist, so it returns the merged result the UI would see (the real
 * write lands once migration 032 runs).
 */
export async function updateCapabilities(orgId: string, patch: CapabilitiesPatch): Promise<Capabilities> {
  if (!patch || typeof patch !== 'object') throw new ValidationError('Invalid capabilities payload');

  for (const k of ['food_service', 'studio', 'retail'] as const) {
    if (patch[k] !== undefined && typeof patch[k] !== 'boolean') {
      throw new ValidationError(`capability ${k} must be a boolean`);
    }
  }
  if (patch.billing_models !== undefined) {
    if (typeof patch.billing_models !== 'object' || patch.billing_models === null) {
      throw new ValidationError('billing_models must be an object');
    }
    for (const [k, val] of Object.entries(patch.billing_models)) {
      if (val !== undefined && typeof val !== 'boolean') {
        throw new ValidationError(`billing_models.${k} must be a boolean`);
      }
    }
  }

  const next = mergePatch(await getCapabilities(orgId), patch);
  if (!(await capabilitiesColumnReady())) return next; // pre-migration: echo merged result

  await query(
    `UPDATE organizations SET capabilities = $2::jsonb, updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL`,
    [orgId, JSON.stringify(next)],
  );
  return next;
}

/** Resolve a named onboarding preset to its capability bundle (clone). */
export function getPreset(name: string): Capabilities | null {
  const preset = PRESETS[name as PresetName];
  return preset ? clone(preset) : null;
}

export function listPresets(): Array<{ name: PresetName; capabilities: Capabilities }> {
  return (Object.keys(PRESETS) as PresetName[]).map((name) => ({ name, capabilities: clone(PRESETS[name]) }));
}

/** Apply a named preset to an org (full replace). Pre-migration: echo only. */
export async function applyPreset(orgId: string, name: string): Promise<Capabilities> {
  const preset = getPreset(name);
  if (!preset) throw new ValidationError(`Unknown preset: ${name}`);
  if (!(await capabilitiesColumnReady())) return preset;
  await query(
    `UPDATE organizations SET capabilities = $2::jsonb, updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL`,
    [orgId, JSON.stringify(preset)],
  );
  return preset;
}
