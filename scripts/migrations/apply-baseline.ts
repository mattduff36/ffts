import { readFileSync } from 'fs';
import { resolve } from 'path';
import { config } from 'dotenv';
import { Client } from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

async function main() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString) {
    console.error('POSTGRES_URL_NON_POOLING is required to apply the baseline schema.');
    process.exit(1);
  }

  const schemaPath = resolve(process.cwd(), 'supabase', 'schema.sql');
  const sql = readFileSync(schemaPath, 'utf8');
  const client = new Client({ connectionString });

  try {
    await client.connect();
    await client.query(sql);
    console.log('Baseline schema applied successfully.');
    console.log('Next: run npm run db:validate');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
