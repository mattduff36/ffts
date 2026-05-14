# Demo Operator Guide

Use this guide for the hosted demo at `https://digidocs.mpdee.co.uk/`.

## Required Environment

The demo deployment must use its own Supabase project and these values:

```bash
APP_MODE=demo
NEXT_PUBLIC_APP_MODE=demo
NEXT_PUBLIC_APP_URL=https://digidocs.mpdee.co.uk
NEXT_PUBLIC_SITE_URL=https://digidocs.mpdee.co.uk
NEXT_PUBLIC_DEMO_EMAIL_DOMAIN=demo.example.test
DEMO_SUPABASE_PROJECT_REF=<supabase-project-ref>
```

Also set the Supabase URL, anon key, service role key, `POSTGRES_URL_NON_POOLING`, `APP_SESSION_SECRET`, `APP_SESSION_HASH_SECRET`, and any harmless demo-only email or optional integration credentials.

## Rebuild Demo Database

Only run this against the dedicated demo Supabase project:

```bash
DEMO_RESET_CONFIRM=RESET_DEMO_DATABASE APP_MODE=demo NEXT_PUBLIC_APP_MODE=demo npm run demo:wipe-database
npm run db:baseline
npm run db:validate
APP_MODE=demo NEXT_PUBLIC_APP_MODE=demo npm run demo:setup-storage
APP_MODE=demo NEXT_PUBLIC_APP_MODE=demo npm run demo:seed
```

## Refresh Demo Data

Use this when the schema is already correct and you only need to reset fictional demo records:

```bash
DEMO_RESET_CONFIRM=RESET_DEMO_DATA APP_MODE=demo NEXT_PUBLIC_APP_MODE=demo npm run demo:reset
```

## Safety Rules

- Never reuse a customer Supabase project for the demo.
- Never put real customer data in the demo database.
- Keep demo email addresses on `NEXT_PUBLIC_DEMO_EMAIL_DOMAIN`.
- Keep real Resend, DVLA, MOT, MapTiler, and FleetSmart credentials out of the demo unless the account is dedicated to harmless demo use.
- Treat the admin HTTP demo reset route as optional until it is proven reliable on the Vercel runtime.
