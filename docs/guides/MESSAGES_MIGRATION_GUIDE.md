# Messages System Migration Guide

The messages and recipients tables are part of the Forest baseline in `supabase/baseline/create-messages-tables.sql`. Later module-key changes are under `supabase/migrations/`.

## Fresh Forest Database

Use the production bootstrap:

```bash
npm run forest:bootstrap-production
```

This applies the complete baseline and migration history. Do not execute the messages SQL separately on a fresh project.

## Existing Forest Database

Follow [`HOW_TO_RUN_MIGRATIONS.md`](HOW_TO_RUN_MIGRATIONS.md) and apply only the new SQL migration through `POSTGRES_URL_NON_POOLING` and `pg.Client`. Then run:

```bash
npm run db:validate
```

## Schema

- **messages** table: Stores Toolbox Talk and Reminder messages
- **message_recipients** table: Tracks per-user message status (pending/signed/dismissed)
- Indexes for performance
- Row Level Security (RLS) policies
- Triggers for updated_at timestamps

## Verification

Use a read-only check:

```sql
SELECT COUNT(*) FROM messages;
SELECT COUNT(*) FROM message_recipients;
```

The queries may return existing production rows. Only table and permission errors indicate a schema problem.

