# How To Bootstrap And Validate The Database

This template supports two database paths. Choose one deliberately before creating a customer project.

## Path A: Fresh Demo Or Customer Database

Use this for a brand-new customer Supabase project that does not need historical branch context.

```bash
npm run db:baseline
npm run db:validate
```

`db:baseline` uses `POSTGRES_URL_NON_POOLING` and applies:

1. `supabase/schema.sql`
2. foundation SQL files in `supabase/baseline/`
3. every SQL migration in `supabase/migrations/` in filename order

After it finishes, run `db:validate` before seeding data or deploying.

## Path B: Preserved Migration History

Use this for ongoing development after a database has already been bootstrapped.

```bash
# Apply only new migration files introduced by your branch using your chosen Supabase workflow.
npm run db:validate
```

Avoid older one-off migration runners unless you have checked the file path and SQL target. `npm run migrate` delegates to `db:baseline` for fresh installs.

## Required Environment

Your `.env.local` file must include:

```bash
POSTGRES_URL_NON_POOLING="postgresql://postgres.[project-ref]:[password]@db.[project-ref].supabase.co:5432/postgres"
```

Get this from Supabase Dashboard -> Settings -> Database -> Connection string -> URI.

## Why db:validate Is Mandatory

PostgreSQL trigger functions store column names as plain text. When you rename a column (`vehicle_id → van_id`), **the trigger is not updated automatically** and PostgreSQL won't warn you — the error only appears when a user fires the trigger in production.

`npm run db:validate` catches this by:
- Scanning every trigger function body for `NEW.col` / `OLD.col` references and checking those columns exist on the trigger's table
- Checking that all required columns exist on core tables (`van_inspections`, `vehicle_maintenance`, etc.)
- Verifying critical FK relationships (`plant.category_id → van_categories`, etc.)

**Rule:** If your migration renames a column, renames a table, or drops a column — run `npm run db:validate` before committing.

## Common Issues

### "Missing database connection string"

**Fix:** Add `POSTGRES_URL_NON_POOLING` to `.env.local`

### "already exists"  

**Fix:** This is fine! Migration was already run. Script exits successfully.

### "permission denied"

**Fix:** Use the direct database connection string for the project owner account.

Never apply migrations, baseline SQL, seeds, or demo reset commands against a customer production database without a backup and an explicit deployment plan.

