# Inspections Verification Runbook

## Overview

This document defines the complete verification sequence for the `vehicle_inspections` → `van_inspections` + `plant_inspections` table split. Every step must pass before production deployment.

## Prerequisites

| Requirement | Details |
|---|---|
| Node.js | LTS (v20+) |
| Dev server | Running at `http://localhost:4000` (for API/E2E tests) |
| `.env.local` | Contains `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `POSTGRES_URL_NON_POOLING` |
| Test users | Provisioned via `npm run testsuite:setup` |
| Playwright | Browsers installed via `npx playwright install --with-deps` |

## Step-by-Step Verification Sequence

### 1. Static Guards (no runtime dependency)

```bash
# TypeScript type check
npm run typecheck

# ESLint
npm run lint

# Forbidden reference guard
npm run test:guard:vehicle-inspections
```

**Pass criteria**: All three commands exit 0.

### 2. Unit Tests

```bash
npm run test:run -- tests/unit/inspections
```

**Pass criteria**: All tests pass. Covers:
- Checklist selection logic (van 15-item, HGV/truck 26-item, plant 23-item)
- Navigation/form config rename verification
- Type contract assertions (VanInspection, PlantInspection)
- Static guard: no `vehicle_inspections` in runtime code

### 3. DB Integrity + RLS Tests

```bash
npm run test:run -- tests/integration/db
```

**Pass criteria**: All tests pass. Covers:
- Table existence (van_inspections, plant_inspections)
- Schema shape (expected columns present)
- CHECK constraints enforced (draft rejection for plant, vehicle_id required for van)
- Child table integrity (no orphan inspection_items)
- Row count parity
- RLS enabled on both tables
- Anon key blocked from reading data

### 4. API Integration Tests

```bash
# Requires dev server running
npm run testsuite:api
```

**Pass criteria**: All tests pass. Covers:
- Van inspection API auth guards (401 for all unauthenticated requests)
- Plant inspection API auth guards (401 for all unauthenticated requests)
- Report API auth guards
- Response schema validation (JSON, error property)
- No 500 errors on any endpoint

### 5. E2E Tests (Playwright)

```bash
# Requires dev server running + test users provisioned
npm run testsuite:ui
```

**Pass criteria**: All tests pass. Covers:
- Van inspections: list loads, new form loads, navigation works, no 404s
- Plant inspections: list loads, new form loads, navigation works, no 404s
- Regression smoke: dashboard, fleet, workshop, reports, actions, timesheets
- Renamed text verification (no "Vehicle Inspection" in headings)
- No hydration errors
- No console errors
- Network failure detection (500s captured)

### 6. Production Build

```bash
npm run build
```

**Pass criteria**: Build succeeds with zero errors.

### 7. Data Safety Verification

```bash
npm run verify:data-safety
```

**Pass criteria**: Script exits 0. Validates:
- van_inspections and plant_inspections tables exist
- Row counts reported
- Data separation (van has no plant_id, plant has valid ownership)
- No orphan child rows (inspection_items, inspection_daily_hours, inspection_photos, actions)
- No NULL user_id in either table
- RLS enabled on both tables
- CHECK constraints present
- Indexes present on plant_inspections
- JSON report written to `testsuite/reports/inspection-data-safety.json`

### 8. Full CI Gate (single command)

```bash
npm run ci:inspections
```

Runs: typecheck → lint → static guard → unit tests → build.

## Report Artifacts

| Artifact | Location |
|---|---|
| Unit test results | Terminal output / CI logs |
| API test results | `testsuite/reports/vitest-results.json` |
| E2E test results | `testsuite/reports/results.json` |
| Data safety report | `testsuite/reports/inspection-data-safety.json` |
| Playwright traces | `test-results/` (on failure) |
| Playwright screenshots | `test-results/` (on failure) |
| Coverage manifest | `tests/inspections-coverage-manifest.json` |

## Sign-Off Checklist

- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm run test:guard:vehicle-inspections` passes
- [ ] All unit tests pass (`tests/unit/inspections/`)
- [ ] All DB integrity tests pass (`tests/integration/db/`)
- [ ] All API integration tests pass (`testsuite/api/`)
- [ ] All E2E tests pass (`testsuite/ui/`)
- [ ] `npm run build` succeeds
- [ ] `npm run verify:data-safety` reports all PASS
- [ ] No `from('vehicle_inspections')` in app/lib/components
- [ ] No `Tables['vehicle_inspections']` in app/lib/components
- [ ] No "Vehicle Inspection" text in UI
- [ ] PDF generation works for van and plant
- [ ] Row counts verified (van + plant = original total)

## Troubleshooting

**Tests fail with missing env vars**: Ensure `.env.local` has all required variables. Run `head -1 .env.local` to verify it exists.

**E2E tests fail with auth errors**: Run `npm run testsuite:setup` to provision test users.

**Data safety script fails to connect**: Verify `POSTGRES_URL_NON_POOLING` in `.env.local` is correct and accessible.

**Static guard shows false positives**: FK constraint hint names (`!vehicle_inspections_*_fkey`) are allowed. Only `from('vehicle_inspections')` calls are forbidden.
