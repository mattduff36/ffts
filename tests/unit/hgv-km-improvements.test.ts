/**
 * HGV KM Improvements – Unit Tests
 *
 * Tests the formatMilesUntil unit parameter, KM label presence in
 * HGV-specific files, and the mileage reconciliation logic in the
 * HGV inspection delete route.
 */
import { describe, it, expect } from 'vitest';
import { formatMilesUntil } from '@/lib/utils/maintenanceCalculations';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// 1. formatMilesUntil — unit parameter
// ============================================================================

describe('formatMilesUntil — unit parameter', () => {
  it('defaults to "miles" when no unit is provided', () => {
    expect(formatMilesUntil(500)).toBe('500 miles remaining');
    expect(formatMilesUntil(-200)).toBe('200 miles overdue');
  });

  it('uses "km" when unit is explicitly set', () => {
    expect(formatMilesUntil(1200, 'km')).toBe('1,200 km remaining');
    expect(formatMilesUntil(-350, 'km')).toBe('350 km overdue');
  });

  it('uses "miles" when unit is explicitly set', () => {
    expect(formatMilesUntil(3000, 'miles')).toBe('3,000 miles remaining');
    expect(formatMilesUntil(-750, 'miles')).toBe('750 miles overdue');
  });

  it('returns "Not Set" for null/undefined regardless of unit', () => {
    expect(formatMilesUntil(null, 'km')).toBe('Not Set');
    expect(formatMilesUntil(undefined, 'miles')).toBe('Not Set');
    expect(formatMilesUntil(null)).toBe('Not Set');
    expect(formatMilesUntil(undefined)).toBe('Not Set');
  });

  it('handles zero correctly', () => {
    expect(formatMilesUntil(0, 'km')).toBe('0 km remaining');
    expect(formatMilesUntil(0, 'miles')).toBe('0 miles remaining');
  });

  it('handles large numbers with locale formatting', () => {
    expect(formatMilesUntil(150000, 'km')).toContain('km remaining');
    expect(formatMilesUntil(-25000, 'km')).toContain('km overdue');
  });
});

// ============================================================================
// 2. KM labels in HGV-specific source files (static analysis)
// ============================================================================

describe('KM labels present in HGV-specific files', () => {
  const root = path.resolve(__dirname, '..', '..');

  function readSource(relativePath: string): string {
    return fs.readFileSync(path.join(root, relativePath), 'utf-8');
  }

  it('HGV inspection new page uses "Current KM" not "Current Mileage"', () => {
    const src = readSource('app/(dashboard)/hgv-inspections/new/page.tsx');
    expect(src).toContain('Current KM');
    expect(src).not.toMatch(/Current Mileage/);
  });

  it('HGV inspection view page uses "KM" label', () => {
    const src = readSource('app/(dashboard)/hgv-inspections/[id]/page.tsx');
    expect(src).toContain('KM');
  });

  it('HGV fleet history page uses "Current KM" and "Service Due KM"', () => {
    const src = [
      readSource('app/(dashboard)/fleet/hgvs/[hgvId]/history/page.tsx'),
      readSource('lib/fleet/asset-history-field-labels.ts'),
    ].join('\n');
    expect(src).toContain('Current KM');
    expect(src).toContain('Service Due KM');
    expect(src).toContain('Last Service KM');
  });

  it('HGV inspection PDF uses "HOURS / KM"', () => {
    const src = readSource('lib/pdf/hgv-inspection-pdf.tsx');
    expect(src).toContain('HOURS / KM');
    expect(src).not.toContain('HOURS / MILEAGE');
  });
});

// ============================================================================
// 3. Conditional KM labels in shared components (static analysis)
// ============================================================================

describe('Conditional KM labels in shared components', () => {
  const root = path.resolve(__dirname, '..', '..');

  function readSource(relativePath: string): string {
    return fs.readFileSync(path.join(root, relativePath), 'utf-8');
  }

  it('MaintenanceTable conditionally shows "KM" for HGV tables', () => {
    const src = readSource('app/(dashboard)/maintenance/components/MaintenanceTable.tsx');
    expect(src).toContain("isHgvTable");
    expect(src).toContain("'KM'");
    expect(src).toContain("'Current KM'");
  });

  it('EditMaintenanceDialog uses conditional distance labels', () => {
    const src = readSource('app/(dashboard)/maintenance/components/EditMaintenanceDialog.tsx');
    expect(src).toContain("isHgvAsset");
    expect(src).toContain("'KM'");
    expect(src).toContain("'Current KM'");
  });

  it('MaintenanceOverview passes distanceUnit to formatMilesUntil', () => {
    const src = readSource('app/(dashboard)/maintenance/components/MaintenanceOverview.tsx');
    expect(src).toContain("distanceUnit");
    expect(src).toMatch(/formatMilesUntil\([^)]*distanceUnit/);
  });

  it('MaintenanceOverview shows the HGV fleet maintenance category strip from category items', () => {
    const src = readSource('app/(dashboard)/maintenance/components/MaintenanceOverview.tsx');
    expect(src).toContain('getHgvMaintenanceSummaryItems');
    expect(src).toContain('vehicle.maintenance_items');
    expect(src).toContain('item.category_name');
    expect(src).toContain('item.display_value');
  });

  it('MaintenanceHistoryDialog handles HGV KM labels', () => {
    const src = readSource('app/(dashboard)/maintenance/components/MaintenanceHistoryDialog.tsx');
    expect(src).toContain("isHgvAsset");
    expect(src).toContain("KM");
  });

  it('QuickEditPopover handles HGV KM labels', () => {
    const src = readSource('app/(dashboard)/maintenance/components/QuickEditPopover.tsx');
    expect(src).toContain("isHgvAsset");
    expect(src).toContain("KM");
  });
});

// ============================================================================
// 4. Workshop task components — conditional KM labels
// ============================================================================

describe('Workshop task components — KM labels', () => {
  const root = path.resolve(__dirname, '..', '..');

  function readSource(relativePath: string): string {
    return fs.readFileSync(path.join(root, relativePath), 'utf-8');
  }

  it('CreateWorkshopTaskDialog uses dynamic KM labels for HGV', () => {
    const src = readSource('components/workshop-tasks/CreateWorkshopTaskDialog.tsx');
    expect(src).toContain('KM');
    expect(src).toMatch(/meterFieldLabel|meterUnit|meterInputDescriptor/);
  });

  it('WorkshopTaskFormDialogs uses dynamic KM labels for HGV', () => {
    const src = readSource('app/(dashboard)/workshop-tasks/components/WorkshopTaskFormDialogs.tsx');
    expect(src).toContain('KM');
    expect(src).toMatch(/addUsesKm|editUsesKm|addMeterLabel|editMeterLabel/);
  });

  it('MarkTaskCompleteDialog uses conditional KM copy for HGV', () => {
    const src = readSource('components/workshop-tasks/MarkTaskCompleteDialog.tsx');
    expect(src).toContain('isHgvTask');
    expect(src).toContain('KM');
  });
});

// ============================================================================
// 5. HGV inspection delete route — mileage reconciliation logic
// ============================================================================

describe('HGV inspection delete route — mileage reconciliation', () => {
  const root = path.resolve(__dirname, '..', '..');

  function readSource(relativePath: string): string {
    return fs.readFileSync(path.join(root, relativePath), 'utf-8');
  }

  it('looks up the hgv_id before deletion', () => {
    const src = readSource('app/api/hgv-inspections/[id]/delete/route.ts');
    expect(src).toContain("select('id, hgv_id')");
  });

  it('queries the latest remaining inspection after deletion', () => {
    const src = readSource('app/api/hgv-inspections/[id]/delete/route.ts');
    expect(src).toMatch(/\.from\(['"]hgv_inspections['"]\)/);
    expect(src).toContain("order('inspection_date'");
    expect(src).toContain("maybeSingle()");
  });

  it('updates hgvs.current_mileage with the latest remaining value', () => {
    const src = readSource('app/api/hgv-inspections/[id]/delete/route.ts');
    expect(src).toContain(".from('hgvs')");
    expect(src).toContain("update({ current_mileage: latestMileage })");
  });

  it('updates vehicle_maintenance.current_mileage for reconciliation', () => {
    const src = readSource('app/api/hgv-inspections/[id]/delete/route.ts');
    expect(src).toContain(".from('vehicle_maintenance')");
    expect(src).toContain("current_mileage: latestMileage");
    expect(src).toContain("last_mileage_update");
  });

  it('inserts a vehicle_maintenance record if none exists but mileage is available', () => {
    const src = readSource('app/api/hgv-inspections/[id]/delete/route.ts');
    expect(src).toContain(".insert({");
    expect(src).toContain("hgv_id: hgvId");
  });
});

// ============================================================================
// 6. Database trigger SQL — covers HGV table
// ============================================================================

describe('Database trigger SQL includes HGV support', () => {
  const root = path.resolve(__dirname, '..', '..');

  function readSource(relativePath: string): string {
    return fs.readFileSync(path.join(root, relativePath), 'utf-8');
  }

  it('split migration defines the HGV-specific maintenance function', () => {
    const sql = readSource('supabase/migrations/20260322_split_maintenance_mileage_triggers.sql');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION update_hgv_maintenance_mileage()');
    expect(sql).toContain('NEW.hgv_id');
    expect(sql).toContain('WHERE hgv_id = NEW.hgv_id');
  });

  it('creates the HGV-specific trigger on hgv_inspections', () => {
    const sql = readSource('supabase/migrations/20260322_split_maintenance_mileage_triggers.sql');
    expect(sql).toContain('trigger_update_maintenance_mileage_hgv');
    expect(sql).toContain('ON hgv_inspections');
    expect(sql).toContain('EXECUTE FUNCTION update_hgv_maintenance_mileage()');
  });

  it('inserts a vehicle_maintenance row if no existing row found for HGV', () => {
    const sql = readSource('supabase/migrations/20260322_split_maintenance_mileage_triggers.sql');
    expect(sql).toContain("INSERT INTO vehicle_maintenance (hgv_id, current_mileage, last_mileage_update)");
  });
});
