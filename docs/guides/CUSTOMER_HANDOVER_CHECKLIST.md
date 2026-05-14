# Customer Handover Checklist

Use this checklist when cloning the template for a real customer.

## Local Setup

```bash
npm install
npm run template:setup
npm run template:validate
```

Confirm `.env.local` contains customer-owned values for Supabase, Resend, Vercel URLs, branding, support/admin emails, and app session secrets. Do not commit `.env.local`, `template-setup.local.json`, or `template-setup-checklist.md`.

## Database

```bash
npm run db:baseline
npm run db:validate
```

Use a fresh customer-owned Supabase project. Do not apply demo wipe/reset commands to a customer project.

## Storage And Data

```bash
npm run setup:storage
```

Only seed dummy data if the customer explicitly wants a training/demo environment. Production customer databases should start with real onboarding data created through an agreed import or admin process.

## Deployment

- Create a customer-owned Vercel project.
- Add all production environment variables in Vercel.
- Configure DNS for the customer domain.
- Verify Resend sender domains before enabling real email flows.
- Disable optional integrations until customer-owned API credentials are available.

## Final Verification

```bash
npm run template:validate
npm run template:audit
npm run typecheck
npm run lint
npm run build
```

Before handover, confirm login, PDFs, emails, manifests, browser metadata, and support/admin UI use the customer branding and not demo/template placeholders.
