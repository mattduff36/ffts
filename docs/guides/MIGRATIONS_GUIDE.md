# Database Migrations Guide

## 🎯 Overview

This project uses **direct PostgreSQL connections** to run database migrations programmatically using the `pg` library. This eliminates the need for manual SQL execution in the Supabase Dashboard.

The connected database currently holds only SAMPLE DATA. Do not classify migration work as CRITICAL until all SAMPLE data has been removed and real customer data is in use. See [SAMPLE_DATA_PHASE.md](SAMPLE_DATA_PHASE.md).

---

## 📋 Prerequisites

### Required Environment Variables

Your `.env.local` file **must** contain one of these database connection strings:

```bash
# Preferred for migrations (non-pooling connection)
POSTGRES_URL_NON_POOLING="postgresql://user:pass@host:5432/database"

# Fallback (pooled connection)
POSTGRES_URL="postgresql://user:pass@host:5432/database"
```

### Getting Your Connection String

1. Go to your Supabase project dashboard
2. Navigate to: **Settings → Database**
3. Scroll to **Connection string**
4. Select **URI** format
5. Choose **Session mode** (non-pooling) for migrations
6. Copy the connection string
7. Add it to `.env.local` as `POSTGRES_URL_NON_POOLING`

---

## 🚀 Running Migrations

### Method 1: Run a Specific Migration (Recommended)

Each migration has its own runner script in the `scripts/` directory:

```bash
# RAMS feature migration
npx tsx scripts/run-rams-migration.ts

# Other migrations
npx tsx scripts/run-db-migration.ts
npx tsx scripts/run-shift-type-migration.ts
npx tsx scripts/run-day-of-week-migration.ts
```

### Method 2: Run All Migrations

To run all pending migrations at once:

```bash
npx tsx scripts/run-all-migrations.ts
```

---

## 📝 Creating a New Migration

### Step 1: Create SQL File

Create your migration SQL in the `supabase/` directory:

```sql
-- supabase/my-new-feature.sql

CREATE TABLE IF NOT EXISTS my_new_table (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE my_new_table ENABLE ROW LEVEL SECURITY;

-- Add RLS policies
CREATE POLICY "Users can view their own records" ON my_new_table
  FOR SELECT USING (auth.uid() = user_id);
```

### Step 2: Create Runner Script

Create a runner script in `scripts/` directory:

```typescript
// scripts/run-my-migration.ts

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/my-new-feature.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('🚀 Running My Feature Migration...\n');

  // Parse connection string with SSL config
  const url = new URL(connectionString);
  
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    console.log('📡 Connecting to database...');
    await client.connect();
    console.log('✅ Connected!\n');

    // Read and execute migration
    const migrationSQL = readFileSync(
      resolve(process.cwd(), sqlFile),
      'utf-8'
    );

    console.log('📄 Executing migration...');
    await client.query(migrationSQL);

    console.log('✅ MIGRATION COMPLETED!\n');
    
    // Verify changes
    const { rows } = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_name = 'my_new_table'
    `);

    if (rows.length > 0) {
      console.log('✅ Table created successfully');
    }

  } catch (error: any) {
    console.error('❌ MIGRATION FAILED:', error.message);
    
    if (error.message?.includes('already exists')) {
      console.log('✅ Already applied - no action needed!');
      process.exit(0);
    }
    
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch(console.error);
```

### Step 3: Run Your Migration

```bash
npx tsx scripts/run-my-migration.ts
```

---

## 🔧 Migration Best Practices

### 1. Always Use IF NOT EXISTS

This makes migrations idempotent (safe to run multiple times):

```sql
CREATE TABLE IF NOT EXISTS my_table (...);
CREATE INDEX IF NOT EXISTS idx_name ON my_table(column);
CREATE POLICY IF NOT EXISTS "policy_name" ON my_table ...;
```

### 2. Handle Existing Objects

Your migration script should gracefully handle already-applied migrations:

```typescript
if (error.message?.includes('already exists')) {
  console.log('✅ Already applied - no action needed!');
  process.exit(0);
}
```

### 3. Test Locally First

Always run migrations on your development database first:

```bash
# Set to your local dev database
POSTGRES_URL_NON_POOLING="postgresql://postgres:postgres@localhost:54322/postgres"
```

### 4. Verify After Migration

Include verification queries in your runner:

```typescript
// Verify table exists
const { rows } = await client.query(`
  SELECT table_name 
  FROM information_schema.tables 
  WHERE table_name = 'my_table'
`);

console.log(rows.length > 0 ? '✅ Verified' : '❌ Not found');
```

### 5. Never Use Pooled Connections for DDL

Always use **non-pooling** connections for migrations:

```bash
# ✅ Good (Session mode)
POSTGRES_URL_NON_POOLING="postgresql://..."

# ❌ Bad for migrations (Transaction mode)
POSTGRES_URL="postgresql://..."
```

---

## 🐛 Troubleshooting

### Error: "Missing database connection string"

**Solution**: Add `POSTGRES_URL_NON_POOLING` or `POSTGRES_URL` to `.env.local`

### Error: "already exists"

**Solution**: Migration already applied - this is usually fine. Script will exit with success.

### Error: "permission denied"

**Solution**: Check that your database user has sufficient privileges. The service role key should have full access.

### Error: "connect ECONNREFUSED"

**Solution**: Check that:
1. Your connection string is correct
2. Database is accessible (not behind firewall)
3. SSL settings are correct

### Error: "syntax error at or near..."

**Solution**: SQL syntax issue. Check your SQL file for errors.

---

## 📚 Common Migration Patterns

### Creating a Table with RLS

```sql
CREATE TABLE IF NOT EXISTS my_table (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE my_table ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own records" ON my_table
  FOR SELECT USING (auth.uid() = user_id);
```

### Adding a Column

```sql
-- Check if column exists, then add
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='my_table' AND column_name='new_column'
  ) THEN
    ALTER TABLE my_table ADD COLUMN new_column TEXT;
  END IF;
END $$;
```

### Creating an Index

```sql
CREATE INDEX IF NOT EXISTS idx_user_created 
  ON my_table(user_id, created_at DESC);
```

### Updating RLS Policies

```sql
-- Drop old policy
DROP POLICY IF EXISTS "old_policy_name" ON my_table;

-- Create new policy
CREATE POLICY "new_policy_name" ON my_table
  FOR SELECT USING (true);
```

---

## 🎯 Why This Approach?

### ✅ Advantages

1. **Automated**: No manual copy-paste in dashboard
2. **Version Controlled**: All migrations tracked in Git
3. **Repeatable**: Can run on multiple environments
4. **Verifiable**: Built-in verification checks
5. **Error Handling**: Graceful failure and rollback
6. **CI/CD Ready**: Can integrate into deployment pipelines

### ❌ Previous Issues (Now Solved)

- ~~Had to manually run SQL in Supabase Dashboard~~
- ~~Copy-paste errors and formatting issues~~
- ~~No verification of successful migration~~
- ~~Difficult to track which migrations were applied~~

---

## 📖 Additional Resources

- **PostgreSQL Docs**: https://www.postgresql.org/docs/
- **Supabase Database**: https://supabase.com/docs/guides/database
- **node-postgres (pg)**: https://node-postgres.com/
- **Migration Best Practices**: https://supabase.com/docs/guides/database/migrations

---

## ✅ Quick Reference

| Task | Command |
|------|---------|
| Run RAMS migration | `npx tsx scripts/run-rams-migration.ts` |
| Run all migrations | `npx tsx scripts/run-all-migrations.ts` |
| Check migration status | Check console output after running |
| Verify tables | Use SQL in script or check Supabase Dashboard |
| Rollback (manual) | Write a down migration and run it |

---

**Last Updated**: October 31, 2025  
**Maintainer**: Development Team  
**Related Docs**: 
- `docs/RAMS_IMPLEMENTATION_PROGRESS.md`
- `docs/SETUP_COMPLETE.md`

