# Testsuite

Comprehensive test suite for TemplateApp (FieldOps Template). Converted from the legacy `testsprite_tests/` Python scripts into Playwright (TypeScript) for UI workflows and Vitest for API/integration checks.

## Data Safety

**Non-destructive guarantee**: the suite never edits, deletes, or mutates pre-existing records. It creates dedicated TEST accounts, TEST vehicles, and TEST tasks — all clearly tagged with a `TESTSUITE-<timestamp>` prefix — and cleans up only what it created.

## Prerequisites

1. Copy `.env.local` must have:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

2. Provision test users (first time only):
   ```bash
   npm run testsuite:setup
   ```

3. Ensure the dev server is running:
   ```bash
   npm run dev
   ```

## Running Tests

### Run everything (API + UI)
```bash
npm run testsuite
```

### Run only UI (Playwright) tests
```bash
npm run testsuite:ui
```

### Run only API (Vitest) tests
```bash
npm run testsuite:api
```

### Filter by tag / module
```bash
# Run only tests tagged @fleet
npm run testsuite:ui -- --grep "@fleet"

# Run only tests tagged @timesheets
npm run testsuite:ui -- --grep "@timesheets"

# Run only tests tagged @critical
npm run testsuite:ui -- --grep "@critical"
```

### Available tags
- `@auth` — Authentication and login flows
- `@fleet` — Fleet page, tabs, vehicle history
- `@workshop` — Workshop tasks, comments, taxonomy
- `@timesheets` — Timesheet creation, submission, approval
- `@permissions` — Role-based access control
- `@inspections` — Vehicle inspections
- `@rams` — RAMS workflows
- `@messages` — Internal messaging
- `@errors` — Error logging and console error checks
- `@perf` — Performance benchmarks (optional)
- `@critical` — Critical path flows (also checks for console errors)

## Reports

After a run, reports are written to `testsuite/reports/`:
- `results.json` — Raw Playwright JSON output
- `html/` — Playwright HTML report
- `latest.md` — Markdown summary of failures (auto-generated)

## Folder Structure

```
testsuite/
  ui/          Playwright specs (browser-based workflow tests)
  api/         Vitest integration specs (API-level tests)
  helpers/     Shared auth, data, selector, and fixture helpers
  config/      Playwright config for the suite
  runner/      CLI runner + report generator
  reports/     Generated reports (.gitignored)
  .state/      Test user credentials + storage state (.gitignored)
```
