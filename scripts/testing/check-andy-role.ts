import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const url = new URL(connectionString!);

const client = new Client({
  host: url.hostname,
  port: parseInt(url.port) || 5432,
  database: url.pathname.slice(1),
  user: url.username,
  password: url.password,
  ssl: { rejectUnauthorized: false }
});

async function check() {
  await client.connect();
  
  const { rows } = await client.query(`
    SELECT p.full_name, p.role as old_role_column, p.role_id, r.name as new_role_name
    FROM profiles p
    LEFT JOIN roles r ON p.role_id = r.id
    LEFT JOIN auth.users au ON p.id = au.id
    WHERE au.email = 'andy@example.com';
  `);
  
  console.log('Andy role column values:');
  console.table(rows);
  
  console.log('\nold_role_column:', JSON.stringify(rows[0]?.old_role_column));
  console.log('new_role_name:', rows[0]?.new_role_name);
  
  await client.end();
}

check().catch(console.error);

