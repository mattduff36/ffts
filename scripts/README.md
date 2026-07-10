# Forest Farm Operational Scripts

This directory contains production bootstrap, database migration, verification, release, and maintenance tooling for FFTS.

## Main Commands

```bash
npm run forest:bootstrap-production
npm run db:baseline
npm run db:validate
npm run setup:storage
npm run fixerrors
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
