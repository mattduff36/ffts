# FFTS Vitest Suites

The `tests/` workspace contains unit, integration, regression, and UI-component coverage for Forest Farm Operations.

## Layout

- `unit/` — pure business rules, helpers, migrations, PDF data, and server utilities.
- `integration/` — API routes, persistence workflows, RLS behavior, and module integrations.
- `regression/` — targeted regression coverage.
- `ui/` — React component tests in Happy DOM.

## Commands

```bash
npm test
npm run typecheck
npx vitest run tests/unit/<file>.test.ts
npx vitest run tests/integration/<file>.test.ts
```

Browser workflows live in `testsuite/`; see [`../testsuite/README.md`](../testsuite/README.md).

## Live Database Tests

Tests that require a configured Supabase target must remain skipped unless `RUN_LIVE_DB_TESTS=true`. Use an approved isolated target, dedicated fictional users, and `ZZ99`-prefixed fleet fixtures. Never select or mutate an arbitrary existing production row.

## Current Fleet Routes

- `/fleet/vans/[vanId]/history`
- `/fleet/hgvs/[hgvId]/history`
- `/fleet/plant/[plantId]/history`

Tests must clean up only records they created and use `example.test` addresses and fictional names.

Quote identity fixtures distinguish the saved site name from its address snapshot. Release-command contract tests follow the current explicit-action wording in .cursor/rules/finalise-commands.mdc while preserving the local-finalise/no-push boundary.

The combined Git rehome fixture has a 120-second budget, matching the standard suite timeout: its many real Git repositories take about 70 seconds on this Windows host. Its validation assertions are unchanged.
