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

## Isolated quote SELECT InitPlan validation

`tests/integration/quote-select-initplan.test.ts` is skipped by default, including normal suite discovery. It never reads the application's database URL and does not use `RUN_LIVE_DB_TESTS`. No shared database fixtures are permitted.

To opt in, provision a new, empty FFTS-only PostgreSQL cluster (18.1 was used for local evidence), listening only on `127.0.0.1:55439`, with data directory ending `/06-pg-data`. Create database `ffts_perf_isolated`, owner `ffts_perf_owner`, and database comment `ffts-performance-isolated-20261030`. Record that cluster's `pg_control_system().system_identifier`. Do not reuse another project's service or credentials.

Set these variables only in the invoking process, keeping the URL/password private:

- `RUN_FFTS_QUOTE_INITPLAN_ISOLATED=1`
- `FFTS_INITPLAN_TEST_URL` � the dedicated `postgresql://` URL above, without query parameters
- `FFTS_INITPLAN_TEST_SYSTEM_ID` � the independently recorded cluster identifier

Run `npm.cmd run test:run -- tests/integration/quote-select-initplan.test.ts`. The suite refuses target/marker/cluster/path mismatch and existing fixture tables/functions/reader role before writes. It creates only fictional local rows, actual snapshotted permission helpers and a non-bypass reader role, verifies old/new/rollback row sets and metadata, exercises drift guards, and measures real helper calls via transaction statistics with estimated/analysed plans. Cleanup removes only this empty-target fixture's objects. Stop the dedicated cluster after validation; do not register it as a service.

Private apply/rollback drafts must exist in `docs_private/performance-drafts/`; they are deliberately ignored and outside automatic migration discovery. A normal clone does not contain them. Recheck live policy and helper drift and recreate/review the drafts before a future approved apply. Local PostgreSQL 18.1 evidence does not certify production's PostgreSQL 17 engine, deployment or latency. Production application, migration packaging and provider changes require separate approval.
