#!/usr/bin/env node
/**
 * Regenerate apps/api/src/lib/techSpec.ts from docs/TECH_SPEC.md.
 *
 * docs/ is excluded from the Railway runtime image (.dockerignore), so the AI
 * helpdesk cannot read TECH_SPEC.md at runtime in production. This script bundles
 * the spec into a TypeScript constant that ships through tsc into dist/.
 *
 * Run after editing docs/TECH_SPEC.md:
 *   node scripts/bundle-tech-spec.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const md = fs.readFileSync(path.join(root, 'docs/TECH_SPEC.md'), 'utf-8');

const header = `/**
 * AUTO-BUNDLED Taproot technical specification.
 *
 * docs/TECH_SPEC.md is EXCLUDED from the Railway runtime image by .dockerignore
 * (\`docs\` is ignored), so the helpdesk cannot readFileSync it in production. This
 * module bundles the spec content THROUGH tsc so it always ships in dist/.
 *
 * KEEP IN SYNC with docs/TECH_SPEC.md (that file remains the human-readable source).
 * Regenerate after editing the spec:
 *   node scripts/bundle-tech-spec.js
 */
`;
const body = `export const BUNDLED_TECH_SPEC: string = ${JSON.stringify(md)};\n`;

const out = path.join(root, 'apps/api/src/lib/techSpec.ts');
fs.writeFileSync(out, header + body);
console.log(`Wrote ${out} (${md.length} spec chars).`);
