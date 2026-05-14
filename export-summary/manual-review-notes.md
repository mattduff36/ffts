# Manual Review Notes

Review these areas before selling or deploying the template:

- Hosted demo mode must be set through Vercel Production environment variables: `APP_MODE=demo`, `NEXT_PUBLIC_APP_MODE=demo`, public URLs, demo email domain, and `DEMO_SUPABASE_PROJECT_REF`. Redeploy after changing `NEXT_PUBLIC_*` values.
- The hidden superadmin account is `admin@mpdee.co.uk`. It must not appear in the public demo persona list.
- Visible demo admins, including Avery Stone, must be normal Admin users rather than superadmins.
- The approved fresh demo state should be captured as a private snapshot outside the repository after manual approval. Do not commit snapshots or database dumps.
- Demo email sends to fake demo/sample users should be simulated. Real emails may be sent to real accounts created in the demo, using a demo-owned verified Resend sender.
- Placeholder emails such as `template-admin@example.com`, `priority.manager@example.com`, and `debug.user@example.com` are safe examples, but should be replaced or configured per client.
- Some legacy migrations preserve placeholder superadmin email checks so the migration history remains coherent. Review these before applying to a brand-new production database.
- `NEXT_PUBLIC_ABSENCE_MANAGE_UNLOCK_CODE` is a template placeholder for an existing client-side unlock flow. Treat it as a convenience gate, not a secret security boundary.
- PDF headers now use generic company/address placeholders. Replace these with client branding in a new client project.
- `supabase/migrations/` was preserved as the reusable product architecture. Fresh installs now use the baseline/foundation/migration bootstrap path, which still needs validating against a clean Supabase project before sale.
- Seed/test users use example domains and demo passwords only. Rotate or regenerate all real onboarding data per client.
- External integrations remain as architecture placeholders: Supabase, Resend, Vercel, DVLA/MOT, MapTiler, and FleetSmart require new client-owned credentials.
