#!/usr/bin/env node
/**
 * release.js — Semantic version bump + CHANGELOG + git tag helper.
 *
 * Usage:
 *   node scripts/release.js patch   → 1.0.0 → 1.0.1
 *   node scripts/release.js minor   → 1.0.0 → 1.1.0
 *   node scripts/release.js major   → 1.0.0 → 2.0.0
 *
 * Steps performed:
 *   1. Validate working tree is clean (no uncommitted changes)
 *   2. Bump version in root package.json
 *   3. Generate CHANGELOG entry from commits since last tag
 *   4. Commit: "chore: release v{version}"
 *   5. Tag:    v{version}
 *   6. Push commit + tag
 */

'use strict';

const { execSync } = require('child_process');
const fs           = require('fs');
const path         = require('path');

// ── Helpers ───────────────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], ...opts }).trim();
}

function runIO(cmd) {
  execSync(cmd, { stdio: 'inherit' });
}

// ── Validate input ────────────────────────────────────────────────────────────

const bumpType = process.argv[2];
if (!['patch', 'minor', 'major'].includes(bumpType)) {
  console.error('Usage: node scripts/release.js <patch|minor|major>');
  process.exit(1);
}

// ── Check working tree ────────────────────────────────────────────────────────

const status = run('git status --porcelain');
if (status.length > 0) {
  console.error('❌  Working tree is dirty. Commit or stash changes before releasing.\n');
  console.error(status);
  process.exit(1);
}

// ── Read current version ──────────────────────────────────────────────────────

const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg     = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

const [major, minor, patch] = pkg.version.split('.').map(Number);
let newMajor = major, newMinor = minor, newPatch = patch;

if (bumpType === 'major') { newMajor++; newMinor = 0; newPatch = 0; }
if (bumpType === 'minor') { newMinor++; newPatch = 0; }
if (bumpType === 'patch') { newPatch++; }

const newVersion = `${newMajor}.${newMinor}.${newPatch}`;
const newTag     = `v${newVersion}`;

console.log(`\n📦  Bumping ${pkg.version} → ${newVersion} (${bumpType})\n`);

// ── Bump version in package.json ──────────────────────────────────────────────

pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
console.log(`✓  Updated package.json version → ${newVersion}`);

// ── Generate CHANGELOG ────────────────────────────────────────────────────────

const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');
const existingChangelog = fs.existsSync(changelogPath)
  ? fs.readFileSync(changelogPath, 'utf-8')
  : '';

// Find previous tag to scope commits
let prevTag = '';
try {
  prevTag = run('git tag --sort=-version:refname | grep -E "^v[0-9]+\\.[0-9]+\\.[0-9]+$" | head -1');
} catch {
  // No previous tags — include all commits
}

const range = prevTag ? `${prevTag}..HEAD` : 'HEAD';

function getCommits(pattern) {
  try {
    return run(`git log ${range} --pretty="format:%s (%h)" --no-merges | grep "${pattern}"`);
  } catch {
    return '';
  }
}

const feats  = getCommits('^feat');
const fixes  = getCommits('^fix');
const perfs  = getCommits('^perf');
const docs   = getCommits('^docs');
const chores = getCommits('^chore');

const date = new Date().toISOString().split('T')[0];

let entry = `## [${newVersion}] — ${date}\n\n`;
if (feats)  entry += `### ✨ Features\n${feats.split('\n').map((l) => `- ${l}`).join('\n')}\n\n`;
if (fixes)  entry += `### 🐛 Bug Fixes\n${fixes.split('\n').map((l) => `- ${l}`).join('\n')}\n\n`;
if (perfs)  entry += `### ⚡ Performance\n${perfs.split('\n').map((l) => `- ${l}`).join('\n')}\n\n`;
if (docs)   entry += `### 📚 Documentation\n${docs.split('\n').map((l) => `- ${l}`).join('\n')}\n\n`;
if (chores) entry += `### 🔧 Maintenance\n${chores.split('\n').map((l) => `- ${l}`).join('\n')}\n\n`;

const header = `# Changelog\n\nAll notable changes to Taproot POS are documented here.\n\n`;
const newChangelog = existingChangelog.startsWith('# Changelog')
  ? existingChangelog.replace('# Changelog\n\nAll notable changes to Taproot POS are documented here.\n\n', header + entry)
  : header + entry + existingChangelog;

fs.writeFileSync(changelogPath, newChangelog, 'utf-8');
console.log(`✓  Updated CHANGELOG.md`);

// ── Commit, tag, push ─────────────────────────────────────────────────────────

runIO(`git add package.json CHANGELOG.md`);
runIO(`git commit -m "chore: release ${newTag}"`);
console.log(`✓  Committed release`);

runIO(`git tag -a ${newTag} -m "Release ${newTag}"`);
console.log(`✓  Tagged ${newTag}`);

runIO(`git push`);
runIO(`git push origin ${newTag}`);
console.log(`✓  Pushed to origin\n`);

console.log(`🚀  Released ${newTag}! GitHub Actions will create the release and trigger production deploy.\n`);
