# Forest Farm Tree Services Operations

FFTS is the production operations platform for Forest Farm Tree Services. It is a Next.js App Router application backed by Supabase and PostgreSQL.

## Product areas

- Dashboard, role-based navigation, permissions, usage analytics, and offline/PWA support
- Timesheets, absence, training, approvals, reminders, and actions
- Van, HGV, plant, fleet, maintenance, and workshop workflows
- Inventory, customers, quotes, Sage tracking, reports, and PDF generation
- WebAuthn biometric sign-in and sensitive-module PIN step-up
- Workshop display-board pairing and live status views

## Local setup

Follow [README-SETUP-FFTS.md](README-SETUP-FFTS.md) and copy the blank values from `.env.forest.example` into `.env.local`.
The maintained developer and feature documentation index is in [docs/README.md](docs/README.md).

```bash
npm install
npm run dev
```

The application is the production Forest Farm product. Built-in demo-reset, questionnaire, and generic template setup flows are intentionally not included. The connected database currently contains **only SAMPLE DATA**; see [docs/guides/SAMPLE_DATA_PHASE.md](docs/guides/SAMPLE_DATA_PHASE.md).

## Database

The database is not yet live customer data. All current records are sample or fixture data. While that remains true, do not plan work in the CRITICAL TEE lane. Resume CRITICAL where necessary only after all SAMPLE data has been removed.

Before applying any migration, read [docs/guides/HOW_TO_RUN_MIGRATIONS.md](docs/guides/HOW_TO_RUN_MIGRATIONS.md).

- Fresh Forest install: `npm run forest:bootstrap-production`
- Existing deployment health check: `npm run db:validate`
- Fresh schema baseline only: `npm run db:baseline`

Use `POSTGRES_URL_NON_POOLING` through the repository's `pg` migration scripts. Never apply migrations through a browser or a client-side Supabase API.

## Validation

```bash
npm run lint
npm run typecheck
npm run test:run
npm run db:validate
```

The release label is maintained by the local finalisation workflow and begins at `0726.1.0` for the July 2026 Forest release.

Production deployments are built by Vercel from the `main` branch.
