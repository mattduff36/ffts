import { config } from 'dotenv';
import { resolve } from 'path';
import { createAdminClient } from '@/lib/supabase/admin';
import { syncActiveVanInventoryLocations } from '@/lib/server/inventory-van-location-sync';

config({ path: resolve(process.cwd(), '.env.local') });

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const admin = createAdminClient();
  const result = await syncActiveVanInventoryLocations(admin, null, { dryRun });

  console.log(dryRun ? 'Inventory van location sync dry run:' : 'Inventory van location sync applied:');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('Inventory van location sync failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
