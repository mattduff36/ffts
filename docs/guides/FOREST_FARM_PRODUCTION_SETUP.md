# Forest Farm Tree Services Production Setup

Use this guide in the `ffts` project after the productionised code has been pushed.

## 1. Environment

1. Copy `.env.forest.example` to `.env.local`.
2. Fill in the values from the dedicated Forest Farm Supabase project.
3. Generate unique values for `APP_SESSION_SECRET` and `APP_SESSION_HASH_SECRET`.
4. Set `FOREST_FARM_SUPERADMIN_PASSWORD` locally for the one-time bootstrap run.
5. Do not set any `DEMO_*` variables, `NEXT_PUBLIC_DEMO_EMAIL_DOMAIN`, `DEMO_USER_PASSWORD`, or `NODE_ENV`.

Vercel production must use:

```env
APP_MODE=production
NEXT_PUBLIC_APP_MODE=production
NEXT_PUBLIC_APP_URL=https://<forest-farm-domain>
NEXT_PUBLIC_SITE_URL=https://<forest-farm-domain>
```

Redeploy Vercel after changing any `NEXT_PUBLIC_*` value.

## 2. Fresh Database Bootstrap

Run this from the root of the `ffts` project after `.env.local` is complete:

```bash
npm install
npm run forest:bootstrap-production
```

The script will:

- Apply the full baseline schema and preserved migrations.
- Validate the live schema.
- Create required storage buckets and storage policies.
- Create or update only `admin@mpdee.co.uk` as Matt Duffill SuperAdmin.
- Validate the live schema again.

The script intentionally does not:

- Run `demo:seed`.
- Create demo personas.
- Create Joe Cane or Forest Farm staff accounts.
- Set demo passwords.
- Run demo reset, wipe, snapshot, or bootstrap scripts.

After bootstrap succeeds, remove `FOREST_FARM_SUPERADMIN_PASSWORD` from `.env.local`.

## 3. First Login

Log in with:

- Email: `admin@mpdee.co.uk`
- Password: the temporary value used for `FOREST_FARM_SUPERADMIN_PASSWORD`

The account is marked `must_change_password`, so change the password immediately.

Create Forest Farm user accounts manually from the app/admin workflow once the production app has been verified.

## 4. Useful Verification Commands

```bash
npm run template:validate
npm run db:validate
npm run typecheck
npm run build
```

Use `npm run finalise:push` only after reviewing local changes and confirming the target remote is correct.
