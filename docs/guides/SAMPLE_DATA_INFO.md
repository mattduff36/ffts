# Sample And Demo Data Information

## Overview

The template has two fake-data paths:

- `npm run seed:sample-data`: developer sample data for local reporting/testing.
- `npm run demo:seed`: sales-demo personas and demo-owned data for a dedicated demo deployment.

Demo data must only be used with `APP_MODE=demo`, `NEXT_PUBLIC_APP_MODE=demo`, and a dedicated demo Supabase project.

## Hosted Demo Target

The rich demo seed is designed to make `https://digidocs.mpdee.co.uk/` feel like a live mid-sized contractor over a six-month period. It should include:

- 1 hidden owner superadmin: `admin@mpdee.co.uk`.
- 2 visible Admin users.
- 4 Managers.
- 20 Employees/contractors split across teams.
- 20-30 vans, HGVs, and plant assets.
- Six months of timesheets, absence/leave, inspections, maintenance, workshop tasks, inventory, RAMS/project documents, messages, customers, quotes, and reportable history.

All fictional users use the fake demo domain configured by `NEXT_PUBLIC_DEMO_EMAIL_DOMAIN`, which defaults to `demo.example.test`, except the hidden owner superadmin and any real accounts manually created during a demo.

## Demo Mode Commands

```bash
APP_MODE=demo NEXT_PUBLIC_APP_MODE=demo npm run demo:setup-storage
APP_MODE=demo NEXT_PUBLIC_APP_MODE=demo npm run demo:seed
DEMO_RESET_CONFIRM=RESET_DEMO_DATA APP_MODE=demo NEXT_PUBLIC_APP_MODE=demo npm run demo:reset
```

Create or repair the hidden owner superadmin with:

```bash
DEMO_SUPERADMIN_EMAIL=admin@mpdee.co.uk DEMO_SUPERADMIN_PASSWORD=<temporary-password> APP_MODE=demo NEXT_PUBLIC_APP_MODE=demo npm run demo:bootstrap-superadmin
```

## Approved Fresh Demo State

After the live demo has been manually checked, capture a private approved snapshot:

```bash
DEMO_SNAPSHOT_CONFIRM=CAPTURE_APPROVED_DEMO DEMO_SNAPSHOT_PATH=<private-path>/approved-demo.dump APP_MODE=demo NEXT_PUBLIC_APP_MODE=demo npm run demo:snapshot:capture
```

Restore that approved snapshot when the public demo needs to return to the official fresh state:

```bash
DEMO_SNAPSHOT_CONFIRM=RESTORE_APPROVED_DEMO DEMO_SNAPSHOT_PATH=<private-path>/approved-demo.dump APP_MODE=demo NEXT_PUBLIC_APP_MODE=demo npm run demo:snapshot:restore
```

Do not commit snapshots, dumps, or temporary passwords.

## Login Credentials Summary

The public login screen shows only demo personas in demo mode:

| Role | Email | Access |
| --- | --- | --- |
| Admin | `avery.stone@demo.example.test` | Admin controls, reports, and setup screens |
| Manager | `morgan.reid@demo.example.test` | Team oversight, approvals, reports |
| Employee | `jamie.carter@demo.example.test` | Timesheets, inspections, messages |
| Contractor | `taylor.brooks@demo.example.test` | Limited worker-style access |

The hidden superadmin account is `admin@mpdee.co.uk`; it is intentionally not shown as a login persona.

## Email Safety

Demo emails to fake demo/sample users are simulated and not delivered. Real accounts manually created during a demo may receive real Resend emails if the hosted demo has a demo-owned verified Resend sender configured.

## Verification Scenarios

Before approving the snapshot, check:

- Admin > Users shows the visible admins, managers, employees, teams, and roles.
- Dashboard and reports show non-empty six-month data.
- Fleet, maintenance, workshop, inspections, inventory, timesheets, absence, RAMS/projects, messages, customers, and quotes all have believable fictional records.
- PDFs/exports use DigiDocs demo branding and dummy data only.
- Demo persona login works after a reset.
- Hidden superadmin login works and can access protected operator/admin functions.
- Fake demo recipients are simulated; real newly created demo accounts can receive email when Resend is configured.

