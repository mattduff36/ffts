import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('maintenance placeholder records', () => {
  it('returns a null maintenance id when an active asset has no maintenance row', () => {
    const source = readSource('app/api/maintenance/route.ts');
    const noMaintenanceBranch = source.slice(
      source.indexOf('if (!maintenance)'),
      source.indexOf('const tax_status = getDateBasedStatus')
    );

    expect(noMaintenanceBranch).toContain('id: null');
    expect(noMaintenanceBranch).not.toContain('id: asset.id');
  });

  it('uses a null maintenance id for HGV history fallback records', () => {
    const source = readSource('app/(dashboard)/fleet/hgvs/[hgvId]/history/page.tsx');
    const fallbackRecord = source.slice(
      source.indexOf('maintenanceRecord || {'),
      source.indexOf('vehicle: {')
    );

    expect(fallbackRecord).toContain('id: null');
    expect(fallbackRecord).not.toMatch(/^\s*id:\s*resolvedParams\.hgvId/m);
  });

  it('plant history edits already route missing maintenance records through the create path', () => {
    const source = readSource('app/(dashboard)/maintenance/components/EditPlantRecordDialog.tsx');

    expect(source).toContain('let maintenanceId = maintenanceRecord?.id ?? null');
    expect(source).toContain('if (!maintenanceId)');
    expect(source).toContain('.insert({');
    expect(source).toContain('plant_id: plant.id');
  });

  it('shared TE57 integration helpers repair missing test asset maintenance rows', () => {
    const source = readSource('tests/integration/helpers/test-assets.ts');

    expect(source).toContain('ensureTestVanMaintenanceRecord');
    expect(source).toContain('await ensureTestVanMaintenanceRecord(supabase, data.id)');
    expect(source).toContain('await ensureTestHgvMaintenanceRecord(supabase, data.id)');
    expect(source).toContain('await ensureTestPlantMaintenanceRecord(supabase, data.id)');
  });
});
