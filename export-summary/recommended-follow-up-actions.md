# Recommended Follow-Up Actions

- Keep the hosted demo in `APP_MODE=demo` / `NEXT_PUBLIC_APP_MODE=demo` with a dedicated Supabase project, dedicated Resend sender, and `DEMO_SUPABASE_PROJECT_REF` set in Vercel Production.
- Maintain the rich six-month demo seed and snapshot workflow as the source for the approved sales-demo state.
- Keep `admin@mpdee.co.uk` as the only hidden superadmin account; visible demo personas should use admin/manager/employee/contractor roles only.
- Keep buyer/operator setup guides current as Supabase, Vercel, Resend, and optional integration setup flows change.
- Continue routing brand/company details through the central config modules so each client project can be customised without searching through PDF and email templates.
- Expand `template:audit` over time with any new private domains, generated files, snapshots, or client-specific strings discovered during exports.
- Add a commercial template licence and terms before selling the repository.
- Consider consolidating the restored foundation SQL plus preserved migration history into a generated single-file baseline once a clean demo database has been validated.
