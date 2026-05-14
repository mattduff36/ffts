# Buyer Setup Guide

Use this guide when creating a new customer project from the FieldOps template.

## 1. Run The Local Setup Wizard

```bash
npm install
npm run template:setup
npm run template:validate
```

The wizard writes `.env.local`, saves `template-setup.local.json`, and creates `template-setup-checklist.md`. Do not commit local setup state or secrets.

## 2. Create Customer-Owned Services

Create separate customer-owned accounts/projects for:

- Supabase project and database
- Resend sending domain and API key
- Vercel project
- DNS records
- Optional MapTiler, DVLA/MOT, and FleetSmart integrations

The wizard records the values needed, but it does not create third-party accounts for you.

## 3. Bootstrap The Database

For a fresh customer database:

```bash
npm run db:baseline
npm run db:validate
```

For an existing deployment or ongoing product branch, apply `supabase/migrations/` in timestamp order and then run:

```bash
npm run db:validate
```

## 4. Configure Storage

```bash
npm run setup:storage
```

Demo deployments can also create RAMS and toolbox buckets:

```bash
APP_MODE=demo NEXT_PUBLIC_APP_MODE=demo npm run demo:setup-storage
```

## 5. Configure Email

Add `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and `ADMIN_EMAIL` after verifying the sending domain in Resend.

In demo mode, emails sent to `NEXT_PUBLIC_DEMO_EMAIL_DOMAIN` are simulated so prospects cannot accidentally send to fake accounts.

## 6. Deploy To Vercel

Create or link a Vercel project, add the production environment variables, and deploy from the customer-owned repository. Keep demo and production as separate Vercel projects connected to separate Supabase projects.

## 7. Final Checks

Run:

```bash
npm run typecheck
npm run lint
npm run template:audit
npm run template:validate
```

Before handover, confirm PDFs, emails, metadata, manifests, and login screens show the customer branding from the central template config.
