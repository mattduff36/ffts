# Demo Operator Guide

Use this guide for the hosted demo at `https://digidocs.mpdee.co.uk/`.

## Required Environment

The demo deployment must use its own Supabase project and these values in Vercel Production. Redeploy after changing any `NEXT_PUBLIC_*` value because those values are bundled into the client build.

```bash
APP_MODE=demo
NEXT_PUBLIC_APP_MODE=demo
NEXT_PUBLIC_APP_URL=https://digidocs.mpdee.co.uk
NEXT_PUBLIC_SITE_URL=https://digidocs.mpdee.co.uk
NEXT_PUBLIC_DEMO_EMAIL_DOMAIN=demo.example.test
DEMO_SUPABASE_PROJECT_REF=<supabase-project-ref>
NEXT_PUBLIC_APP_NAME=DigiDocs
NEXT_PUBLIC_SHORT_APP_NAME=DigiDocs
NEXT_PUBLIC_COMPANY_NAME=DigiDocs Demo Ltd
TEMPLATE_SUPERADMIN_EMAIL=admin@mpdee.co.uk
```

Also set the Supabase URL, anon key, service role key, `POSTGRES_URL_NON_POOLING`, `APP_SESSION_SECRET`, `APP_SESSION_HASH_SECRET`, `ADMIN_EMAIL`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and any harmless demo-only optional integration credentials. Use a demo-owned verified Resend sender. `RESEND_API_KEY_2` / `RESEND_FROM_EMAIL_2` can be set if quote/customer emails should use a different sender.

## Demo Accounts

The login screen shows demo personas only in demo mode. The hidden superadmin account is not shown on the login screen.

| Account | Purpose |
| --- | --- |
| `admin@mpdee.co.uk` | Hidden owner superadmin. Change the temporary password after bootstrap. |
| `avery.stone@demo.example.test` | Visible Admin persona, not a superadmin. |
| `morgan.reid@demo.example.test` | Manager persona. |
| `jamie.carter@demo.example.test` | Employee persona. |
| `taylor.brooks@demo.example.test` | Contractor persona. |

## Rebuild Demo Database

Only run this against the dedicated demo Supabase project:

```bash
DEMO_RESET_CONFIRM=RESET_DEMO_DATABASE APP_MODE=demo NEXT_PUBLIC_APP_MODE=demo npm run demo:wipe-database
npm run db:baseline
npm run db:validate
APP_MODE=demo NEXT_PUBLIC_APP_MODE=demo npm run demo:setup-storage
APP_MODE=demo NEXT_PUBLIC_APP_MODE=demo npm run demo:seed
```

## Bootstrap Hidden Superadmin

Create or repair the hidden superadmin after the schema exists:

```bash
DEMO_SUPERADMIN_EMAIL=admin@mpdee.co.uk DEMO_SUPERADMIN_PASSWORD=<temporary-password> APP_MODE=demo NEXT_PUBLIC_APP_MODE=demo npm run demo:bootstrap-superadmin
```

Do not commit or document the temporary password. Change it after first login.

## Refresh Demo Data

Use this when the schema is already correct and you only need to reset fictional demo records:

```bash
DEMO_RESET_CONFIRM=RESET_DEMO_DATA APP_MODE=demo NEXT_PUBLIC_APP_MODE=demo npm run demo:reset
```

## Approved Snapshot Reset

After the demo has been manually checked and approved, capture a private database snapshot outside the repository:

```bash
DEMO_SNAPSHOT_CONFIRM=CAPTURE_APPROVED_DEMO DEMO_SNAPSHOT_PATH=<private-path>/approved-demo.dump APP_MODE=demo NEXT_PUBLIC_APP_MODE=demo npm run demo:snapshot:capture
```

Restore that approved state only against the dedicated demo project:

```bash
DEMO_SNAPSHOT_CONFIRM=RESTORE_APPROVED_DEMO DEMO_SNAPSHOT_PATH=<private-path>/approved-demo.dump APP_MODE=demo NEXT_PUBLIC_APP_MODE=demo npm run demo:snapshot:restore
```

Snapshot files are private operational artifacts. Store them outside the repo or in ignored backup storage.

## Email Safety

In demo mode, emails to `NEXT_PUBLIC_DEMO_EMAIL_DOMAIN` recipients are simulated. Real accounts created during a demo may receive real emails when Resend is configured. Use a dedicated demo sender so live customer email reputation is never affected.

## Safety Rules

- Never reuse a customer Supabase project for the demo.
- Never put real customer data in the demo database.
- Keep demo email addresses on `NEXT_PUBLIC_DEMO_EMAIL_DOMAIN`.
- Keep real Resend, DVLA, MOT, MapTiler, and FleetSmart credentials out of the demo unless the account is dedicated to harmless demo use.
- Treat the admin HTTP demo reset route as optional until it is proven reliable on the Vercel runtime.
