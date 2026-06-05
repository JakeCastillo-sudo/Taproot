# Taproot POS — docs pointer

> The canonical project-state file is **`/CLAUDE.md`** at the repo root. This file
> exists so verification commands that grep `docs/CLAUDE.md` (migrations / blocked prompts)
> resolve. Keep the authoritative detail in the root CLAUDE.md.

## ⚠️ MIGRATION NEEDED (run in Railway console)

```bash
npx node-pg-migrate up --migrations-dir migrations
```

Pending (code degrades gracefully — all features are 500-safe until applied):

- **014_employee_hourly_rate** (S1-05) — `employees.hourly_rate`; also feeds AI staffing labor %.
- **015_cash_drawer** (S2-04) — `cash_drawer_sessions` + `cash_drops`.
- **016_reservations** (S3-05) — `reservations` (waitlist + reservations).

Migrations 001–013 are confirmed applied on Railway.

## Blocked prompts

None. All prompts S1-01 → S5-07 completed across Sprints 1–5 (tags v0.2.0 → v0.6.0-beta-1.5).
See `docs/ROADMAP.md` for sprint status and `docs/BACKLOG.md` for bugs.
