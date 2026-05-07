# Day 10b — Quick Wins Sprint Report

**Date**: 2026-04-29
**Agent**: Tool Specialist
**Duration**: ~15 min
**Status**: ALL 5 FIXES APPLIED, ALL ACCEPTANCE CRITERIA MET

---

## Fix 1 — P1-1 (P0): Auth audit_log column name

**File**: `apps/api/src/routes/auth/index.ts`
**Lines changed**: 470, 542, 887

**Before** (all 3 occurrences):
```sql
INSERT INTO audit_log
  (actor_user_id, action, target_type, target_id, ip_address, user_agent, outcome)
```

**After** (login, logout, password_reset — each with context-appropriate payload):
```sql
INSERT INTO audit_log
  (actor_user_id, action, target_type, target_id, ip, user_agent, outcome, payload)
VALUES
  (..., ${request.ip}::inet, ..., 'success',
   ${JSON.stringify({ firmSlug: firm.slug, jti })}::jsonb)
```

- Column renamed: `ip_address` → `ip` (matches `inet` schema column)
- Added `payload` JSONB column (P4-5 combined): `{firmSlug, jti}` on login/logout; `{firmSlug}` on password_reset

**Verify**: `grep -n ip_address apps/api/src/routes/auth/index.ts` → 0 results ✓

---

## Fix 2 — P1-2 (P0): greek-utils build

**Files changed**:
- `packages/greek-utils/tsconfig.json` — added `"outDir": "./dist"`, explicit `declaration: true`, `declarationMap: true`, added `dist` to exclude
- `packages/greek-utils/package.json` — added `"build": "tsc"` script; updated `main`/`types`/`exports` to point to `./dist/`; added `./afm.js` export entry
- `package.json` (root) — added `"build:packages": "pnpm -r --filter './packages/*' build"`

**Before** (package.json exports):
```json
"main": "./src/index.ts",
"exports": { ".": "./src/index.ts" }
```

**After**:
```json
"main": "./dist/index.js",
"exports": {
  ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" },
  "./afm.js": { "import": "./dist/afm.js", "types": "./dist/afm.d.ts" }
}
```

**Build output**: `pnpm --filter @themisos/greek-utils build` → exit 0

**Verify**: `ls packages/greek-utils/dist/` → afm.js, afm.d.ts, index.js, index.d.ts, normalize.js, normalize.d.ts (+ maps) ✓

---

## Fix 3 — P1-4 (P1): r2_key strip from versions response

**File**: `apps/api/src/routes/documents/index.ts`
**Lines changed**: 738-752

**Before**: `return reply.code(200).send({ data: versions })` — raw rows including `r2_key`

**After**:
```ts
const sanitizedVersions = versions.map(({ r2_key: _r2, ...v }) => ({
  ...v,
  download_url: `/api/v1/documents/${id}/versions/${v.version}/content`,
}));
return reply.code(200).send({ data: sanitizedVersions });
```

- Strips `r2_key` (internal R2 storage path) using same destructuring pattern as `sanitizeDocument()`
- Adds `download_url` per version pointing to versioned content endpoint

---

## Fix 4 — P2-2 (P2): DRAFT invoice number collision

**File**: `apps/api/src/routes/invoices/index.ts`
**Lines changed**: line 336 + added `import * as crypto from 'node:crypto'`

**Before**:
```ts
const draftNumber = `DRAFT-${Date.now()}-${party_id.slice(0, 8)}`;
```

**After**:
```ts
const draftNumber = `DRAFT-${crypto.randomUUID()}`;
```

- Eliminates 1ms collision window in concurrent requests
- `crypto` import added (was missing from file)

**Verify**: `grep "Date.now()" apps/api/src/routes/invoices/index.ts | grep -i draft` → empty ✓

---

## Fix 5 — P3-11 (P3): pdf-parse dependency

**Command**: `pnpm --filter @themisos/api add pdf-parse @types/pdf-parse`
**Result**: +6 packages, done in 7.1s ✓

No code changes required — `document-processing.ts:151` dynamic import already correct and gracefully catches failure.

---

## Acceptance Criteria

| # | Criterion | Result |
|---|-----------|--------|
| 1 | `pnpm --filter @themisos/api typecheck` → exit 0 | ✓ PASS |
| 2 | `pnpm --filter @themisos/web typecheck` → exit 0 | ✓ PASS |
| 3 | `grep -rn ip_address apps/api/src/routes/auth/index.ts` → empty | ✓ PASS |
| 4 | `ls packages/greek-utils/dist/afm.js` → exists | ✓ PASS |
| 5 | `grep "Date.now()" apps/api/src/routes/invoices/index.ts` → no DRAFT context | ✓ PASS |

## Out-of-scope verification

- P1-3 billing: `billable_rate_eur_cents` confirmed in `apps/web/types/billing.ts` lines 35+56 — already fixed Day 9.5 ✓

---

## Files Changed

| File | Change |
|------|--------|
| `apps/api/src/routes/auth/index.ts` | 3× `ip_address`→`ip` + `payload` JSONB column |
| `packages/greek-utils/tsconfig.json` | Added `outDir`, `declaration`, `declarationMap` |
| `packages/greek-utils/package.json` | Added `build` script, `dist/` exports |
| `package.json` | Added `build:packages` script |
| `apps/api/src/routes/documents/index.ts` | Strip `r2_key`, add `download_url` per version |
| `apps/api/src/routes/invoices/index.ts` | `Date.now()`→`crypto.randomUUID()`, added crypto import |
| `apps/api/package.json` | Added `pdf-parse` + `@types/pdf-parse` (via pnpm) |
