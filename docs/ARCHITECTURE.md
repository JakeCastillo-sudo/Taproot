# Taproot POS — Architecture Decisions

## Product State Machine

Products have three distinct states. Every query that surfaces products to cashiers
or the POS register **must** filter on both `deleted_at` AND `archived_at`.

| State    | `deleted_at` | `archived_at` | Visible in POS | Visible in Admin |
|----------|-------------|---------------|----------------|------------------|
| Active   | `NULL`      | `NULL`        | ✅ Yes          | ✅ Yes            |
| Archived | `NULL`      | `SET`         | ❌ No           | ✅ Archive tab    |
| Deleted  | `SET`       | any           | ❌ No           | ❌ No             |

### Canonical query pattern — use everywhere

```sql
WHERE p.deleted_at  IS NULL
  AND p.archived_at IS NULL
```

### ❌ Never do this (accidentally shows archived items)

```sql
WHERE p.deleted_at IS NULL
-- Missing: AND p.archived_at IS NULL
```

### Use cases for each state

**Archive** (temporary hidden):
- Seasonal items (pumpkin spice latte — archive in January)
- 86'd dishes (out of an ingredient tonight — archive until restocked)
- Items under reformulation (tweaking the recipe — archive until ready)
- Rapid response during service (cashier long-presses → Archive → POS update is instant)

**Delete** (permanent removal):
- Test / duplicate products
- Items never going back on the menu
- Cleaning up after a migration

### How to archive a product

1. **From Inventory → Stock Levels**: click the Archive icon (📦) on any row
2. **From POS register**: long-press a product tile → Archive icon in the modifier sheet header
3. **From API**: `POST /api/v1/products/:id/archive` with optional `{ reason: string }`

### How to restore a product

1. **From Inventory → Archived tab**: click "Restore" on any row
2. **From API**: `POST /api/v1/products/:id/restore`

---

## Day-Part Filtering

Products can be restricted to specific meal periods:

| `day_parts` value  | Visible when |
|--------------------|-------------|
| `NULL` or `[]`     | Always (all day parts, including 'all') |
| `['breakfast']`    | Only when activeDayPart === 'breakfast' or 'all' |
| `['lunch','dinner']` | Only when activeDayPart === 'lunch', 'dinner', or 'all' |

Filter rule (additive — items without assignment always visible):
```sql
WHERE (
  p.day_parts IS NULL
  OR p.day_parts = '{}'
  OR $dayPart = ANY(p.day_parts)
)
```

---

## Auth & JWT

- Access token: 15 min, HS256 (or RS256 when RSA keys configured)
- Refresh token: 30 days
- `TOKEN_KEY` / `REFRESH_TOKEN_KEY` / `USER_KEY` in localStorage
- `apiFetch()` auto-attaches token; auto-refreshes on 401; `PUBLIC_PATHS` guard prevents
  redirect-to-login from `/register` and `/login`

---

## Cart & Receipt State

- **Cart** (`pos.store`): persisted to `sessionStorage` (survives refresh, clears on tab close)
- **`lastCompletedOrder`** (`pos.store`): NOT persisted — memory only; cleared on "New Order"
- **`activeDayPart`** (`ui.store`): NOT persisted — always `'all'` on page load
- **`sidebarCollapsed`** (`ui.store`): persisted to `localStorage` (user preference)
- **`posViewMode`** (`ui.store`): NOT persisted — always `'categories'` on page load

---

## Database Conventions

- All soft-delete tables use `deleted_at TIMESTAMPTZ NULL` (NULL = active)
- Product archive uses `archived_at TIMESTAMPTZ NULL` (NULL = active)
- Timestamps stored as UTC ISO-8601 strings; display converted in UI
- UUIDs throughout (no integer sequences for primary keys)
- `organization_id` on every multi-tenant table; all queries filter by it
