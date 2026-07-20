# FFTS Project Setup Instructions

This is the primary local development and production bootstrap guide for Forest Farm Tree Services.

## Project Status

This repository is the production app for Forest Farm Tree Services, branded in-product as Forest Farm Operations.

Expected production mode:

```env
APP_MODE=production
NEXT_PUBLIC_APP_MODE=production
```

Do not use demo mode variables, demo seed data, demo reset scripts, or demo personas in this project.

## Important Folder Structure

The codebase is a Next.js App Router application. Keep new work aligned with the existing structure:

- `app/`: Next.js routes, route groups, API routes, and pages.
- `components/`: shared React components, layout components, UI primitives, and feature components.
- `lib/`: shared business logic, Supabase clients, auth/session helpers, config, permissions, PDF utilities, and server helpers.
- `scripts/`: operational scripts for finalise, database setup, storage setup, production bootstrap, and maintenance.
- `scripts/production/`: client-specific production bootstrap scripts, currently including `bootstrap-forest-farm.ts`.
- `supabase/`: baseline schema, foundation SQL, and migrations.
- `docs/`: setup and operational docs.
- `types/`: generated/shared TypeScript types.
- `public/images/forest-farm/`: stable Forest Farm branding assets.

Prefer existing local patterns over new abstractions. Use named exports for components, TypeScript interfaces for object shapes, and functional React components.

## First Local Setup

From the root of the `ffts` project:

```bash
npm install
```

Copy the packaged env template:

```bash
cp .env.forest.example .env.local
```

On Windows, copy/rename `.env.forest.example` to `.env.local` manually if preferred.

Then fill in:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_JWT_SECRET`
- `POSTGRES_URL_NON_POOLING`
- `POSTGRES_URL`
- `APP_SESSION_SECRET`
- `APP_SESSION_HASH_SECRET`
- Vercel/public URLs
- Resend/email values if email should send from this app
- `FOREST_FARM_SUPERADMIN_PASSWORD` only for the one-time bootstrap run
- `TESTSUITE_SETUP_PASSWORD` only in local `.env.local` when the production testsuite identities are used

Generate unique strong values for the session secrets. Do not reuse demo secrets from another project.

Run local development:

```bash
npm run dev
```

The app runs on port `4000`.

## Fresh Database Setup

Use a dedicated Forest Farm Supabase project. Do not connect to a demo database.

Once `.env.local` is complete:

```bash
npm run forest:bootstrap-production
```

This script:

- Applies the baseline schema and preserved migrations via `npm run db:baseline`.
- Runs `npm run db:validate`.
- Sets up inspection photo storage.
- Sets up RAMS document storage.
- Sets up toolbox talk PDF storage.
- Sets up quote attachment storage.
- Creates or updates only `admin@mpdee.co.uk` as Matt Duffill SuperAdmin.
- Runs `npm run db:validate` again.

It intentionally does not create Forest Farm staff accounts, demo personas, sample data, or demo passwords.

After successful bootstrap:

1. Log in as `admin@mpdee.co.uk`.
2. Change the temporary password immediately.
3. Remove `FOREST_FARM_SUPERADMIN_PASSWORD` from `.env.local`.
4. Create Forest Farm user accounts manually from the app/admin workflow after verifying the app.

## Migration Rules

For a brand-new Forest Farm database:

```bash
npm run db:baseline
npm run db:validate
```

For ongoing development after the initial bootstrap:

- Add new SQL migrations under `supabase/migrations/`.
- Apply only the new migration(s) using the documented `pg.Client` workflow.
- Always run:

```bash
npm run db:validate
```

Avoid one-off migration scripts unless you have inspected the SQL target and know why the existing baseline/migration flow is not sufficient.

Database reset, demo seed, and wipe scripts are not part of FFTS and must not be reintroduced.

## Development Workflow

Before changing code:

```bash
git status --short --branch
```

Create a feature branch from `main` for meaningful work:

```bash
git switch -c feature/<short-description>
```

Useful checks during development:

```bash
npm run typecheck
npm run lint
npm run build
```

For targeted linting, prefer linting the files you changed:

```bash
npx eslint path/to/file.ts path/to/component.tsx
```

## `finalise` Scripts

Use these before commits/pushes when preparing work for review or deployment.

```bash
npm run finalise
```

Standard finalise:

- Stops a repo dev server if detected.
- Runs pending local migration files introduced by the branch.
- Runs DB validation when schema-risk migrations are detected.
- Removes `.next`.
- Runs a clean production build.
- Commits current workspace changes with an automatically summarized conventional commit message.
- Validates and commits release version JSON, history JSON, and the tracked private release log as one release unit.
- Does not push.
- Skips the full automated test suite.

```bash
npm run finalise:push
```

Same as standard finalise, then pushes the current branch.

Use this only after confirming the current branch and remote target are correct.

```bash
npm run finalise:full
```

Runs the fuller finalise path, including the full automated test suite configured by the script, then commits but does not push.

```bash
npm run finalise:full:push
```

Full finalise plus push. Use for high-confidence deployment-ready changes.

Important:

- Do not set `NODE_ENV` manually in Vercel.
- Do not commit `.env.local`.
- If `finalise` changes files through hooks or formatters, review the diff before pushing.
- If a release step fails after the local product commit, no push occurs. Keep the commit and follow the exact recovery commands printed by finalise.
- Generated finalise summaries are under ignored `docs_private/automation/runs/finalise/`.

## `fixerrors`

Run:

```bash
npm run fixerrors
```

To write and validate the same local artifacts without clearing remote error rows:

```bash
npm run fixerrors -- --no-clear
```

This script reads recent production error logs from Supabase, groups them by pattern, parses stack traces, and writes reports to:

- `docs_private/error-analysis.md`
- `docs_private/error-fix-log.md`
- `docs_private/automation/runs/fixerrors/`

Requirements:

- `.env.local` must point at the live Supabase project.
- `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` must be set.
- The `error_logs` table must exist from the database baseline/migrations.

Use `fixerrors` to understand recurring production problems before making fixes. It does not replace normal debugging, tests, or code review.

## Production Testsuite

Set a strong, uncommitted `TESTSUITE_SETUP_PASSWORD`, review the configured Supabase host, then explicitly provision or refresh the three hidden fictional accounts:

```bash
npm run testsuite:setup:production
```

Credentials and browser storage are written only under ignored `testsuite/.state/`. The command is idempotent; normal test commands never provision users. Run `npm run testsuite:api`, `npm run testsuite:ui`, or `npm run testsuite`. Each command performs read-only state and database preflight checks, and cleanup residue fails the run.

## Vercel Setup

Set the same production env values in Vercel Production environment.

Minimum:

```env
APP_MODE=production
NEXT_PUBLIC_APP_MODE=production
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_JWT_SECRET=
APP_SESSION_SECRET=
APP_SESSION_HASH_SECRET=
NEXT_PUBLIC_APP_URL=https://www.fftsapp.com
NEXT_PUBLIC_SITE_URL=https://www.fftsapp.com
```

Also set Resend and provider keys if enabled.

Redeploy after changing any `NEXT_PUBLIC_*` variable because those values are baked into the client bundle.

Do not set:

```env
NODE_ENV
DEMO_SUPABASE_PROJECT_REF
NEXT_PUBLIC_DEMO_EMAIL_DOMAIN
DEMO_USER_PASSWORD
DEMO_RESET_CONFIRM
DEMO_SNAPSHOT_CONFIRM
DEMO_SNAPSHOT_PATH
```

## Common Gotchas

- If the site builds but shows no data, verify the Vercel project is using the Forest Farm Supabase URL and anon key in the correct environment.
- If login works but data queries are empty/unauthorized, verify `SUPABASE_JWT_SECRET`, `APP_SESSION_SECRET`, `APP_SESSION_HASH_SECRET`, and RLS migrations are correct.
- If local scripts fail with database connection errors, check `POSTGRES_URL_NON_POOLING`.
- If email does not send, check Resend keys, sender domain verification, and `RESEND_FROM_EMAIL`.
- If public branding or URLs look stale, redeploy Vercel after env changes.
- If you add migrations, run `npm run db:validate` before finalise.

