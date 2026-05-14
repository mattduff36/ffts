# FieldOps Template

A reusable Next.js App Router starter for field operations, workforce workflows, inspections, maintenance, messaging, reporting, and role-based administration. This repository is a sanitised template copy: client data, production links, credentials, generated reports, and customer-specific branding have been removed or replaced with placeholders.

## What This Template Includes

- Next.js 15 App Router, React 19, TypeScript, Tailwind, Radix, and shadcn/ui patterns
- Supabase Auth, PostgreSQL schema, RLS policies, migrations, storage-oriented workflows, and admin clients
- Timesheets, inspections, maintenance, workshop tasks, RAMS, quotes/customers, inventory, absence, notifications, messages, reports, and admin modules
- Role and permission architecture with manager/admin/superadmin flows
- PDF and Excel export infrastructure
- Vitest and Playwright-style test structure
- Vercel deployment configuration with cron routes

## Setup

```bash
npm install
npm run template:setup -- --defaults --force
npm run template:validate
npm run dev
```

Fill any missing values in `.env.local` with values from your own Supabase, Resend, Vercel, and optional vehicle-data providers. Do not reuse production credentials from another client.

## Productisation Modes

- `template`: local setup and buyer handover mode for a new customer project.
- `demo`: public sales demo mode with fake users, fake data, email safety, and guarded reset.
- `development`: local engineering mode.
- `production`: a real customer deployment.

Set `APP_MODE` and `NEXT_PUBLIC_APP_MODE` explicitly per environment.

## Environment

`.env.example` documents the expected variables. Required service credentials are intentionally blank and must be supplied per deployment. Branding values are centralised through `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_COMPANY_NAME`, support/admin email variables, logo paths, and brand colour variables.

## Database

There are two database paths:

- Fresh demo/customer install: run `npm run db:baseline`, then `npm run db:validate`. This applies the starter schema, the restored foundation SQL in `supabase/baseline/`, and every preserved migration in `supabase/migrations/` in filename order.
- Ongoing development or an existing deployment: apply only the new migration files introduced by your branch, then run `npm run db:validate`.

Before running migrations, read `docs/guides/HOW_TO_RUN_MIGRATIONS.md`.

## Demo Site

Demo mode must use its own Supabase project, Vercel project, and fake data only.

```bash
DEMO_RESET_CONFIRM=RESET_DEMO_DATABASE APP_MODE=demo NEXT_PUBLIC_APP_MODE=demo npm run demo:wipe-database
npm run db:baseline
npm run db:validate
APP_MODE=demo NEXT_PUBLIC_APP_MODE=demo npm run demo:setup-storage
APP_MODE=demo NEXT_PUBLIC_APP_MODE=demo npm run demo:seed
DEMO_RESET_CONFIRM=RESET_DEMO_DATA APP_MODE=demo NEXT_PUBLIC_APP_MODE=demo npm run demo:reset
```

The wipe and reset commands refuse to run unless the app is in demo mode, the confirmation flag is set, and `DEMO_SUPABASE_PROJECT_REF` matches the Supabase URL project ref.

## Template Audit

Run `npm run template:audit` before packaging or selling the template. It scans for common secret formats, real-looking email domains, placeholder app URLs, and branding drift.

## Template Review

See `export-summary/` for the sanitisation report, removed files list, manual review notes, and recommended follow-up actions before selling or deploying this template.

## License

Template product. Add your chosen commercial licence before distribution.
