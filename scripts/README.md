# Forest Farm Operational Scripts

This directory contains production bootstrap, database migration, verification, release, and maintenance tooling for FFTS.

## Main Commands

```bash
npm run forest:bootstrap-production
npm run db:baseline
npm run db:validate
npm run setup:storage
npm run fixerrors
npm run fixerrors -- --no-clear
npm run finalise
```

See `README-SETUP-FFTS.md` and `docs/guides/HOW_TO_RUN_MIGRATIONS.md` before running database operations.

## Directory Structure

- `production/` — Forest Farm bootstrap entry points.
- `migrations/` — `pg`-based migration runners, schema inventory, and parity-state checks.
- `maintenance/` — explicit operational repair, backup, and storage tasks.
- `testing/` — non-production verification helpers.
- `automation/` — release/finalisation automation.

## Safety Rules

1. Load credentials only from `.env.local`; never print environment values.
2. Use `POSTGRES_URL_NON_POOLING` with the documented `pg.Client` pattern for migrations.
3. Inspect target SQL and take a schema inventory before a live migration.
4. Run `npm run db:validate` after schema changes.
5. Do not add demo seeds, customer exports, employee records, fleet records, or one-off client repair scripts.
6. Test helpers must use deterministic fictional fixtures and must not alter production data unless a runbook explicitly authorizes it.

### Scheduling sample-data exception

The only approved production sample fixture is `scripts/testing/scheduling-sample.ts`. It is limited to
fictional `example.test` data marked `scheduling-sample-v1`, requires the configured production project
reference, validates the timed scheduling schema, creates no resource assignments, and has a matching
ownership-checked cleanup command.

Follow `docs/guides/SCHEDULING_SAMPLE_DATA_RUNBOOK.md`. Never run the apply or destructive cleanup
commands without the exact confirmation token and an operator review of the generated manifest.

## Automation Artifacts

`fixerrors` creates `docs_private/` when needed and writes the ignored analysis, fix-log, and structured automation-run files there. Use `--no-clear` to generate and validate those artifacts without deleting production error rows.

`finalise` preflights the three release artifacts before making a product commit:

- `lib/config/release-version.json`
- `lib/config/release-history.json`
- `docs_private/release-log.md`

The Markdown release log is the only tracked file under `docs_private/`. If release generation unexpectedly fails after the product commit, finalise blocks the push, preserves the local commit and generated files, and prints exact recovery commands.

Project rules under `.cursor/rules/` map finalise/fixerrors requests, require push-content reporting, and keep all workflows self-contained in FFTS.
