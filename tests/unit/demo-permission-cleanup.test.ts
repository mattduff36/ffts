import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('private folder git safeguards', () => {
  it('keeps the private reference tree ignored at the repo root', () => {
    const gitignore = readSource('.gitignore');

    expect(gitignore).toContain('/private/');
  });

  it('keeps finalise from committing or pushing tracked private files', () => {
    const source = readSource('scripts/finalise.ts');

    expect(source).toContain("const PRIVATE_PATH_PREFIX = 'private/'");
    expect(source).toContain('function assertNoTrackedPrivateFiles()');
    expect(source).toContain("runCommand('git', ['ls-files', '--', 'private']");
    expect(source).toContain('assertNoTrackedPrivateFiles();');
    expect(source).toContain("runCommand('git', ['add', '-A'])");
  });
});

describe('demo permission cleanup contracts', () => {
  it('declares only the expected active demo teams', () => {
    const source = readSource('scripts/demo/seed.ts');

    expect(source).toContain('const DEMO_TEAM_IDS = [');
    [
      'accounts',
      'civils',
      'management',
      'plant',
      'transport',
      'workshop',
    ].forEach((teamId) => {
      expect(source).toContain(`'${teamId}'`);
    });

    ['surfacing', 'drainage', 'traffic'].forEach((teamId) => {
      expect(source).not.toContain(`'${teamId}'`);
    });
  });

  it('keeps demo daily-check and workshop modules scoped to the correct teams', () => {
    const source = readSource('scripts/demo/seed.ts');

    expect(source).toContain('const demoCivilsModules');
    expect(source).toContain("'inspections'");
    expect(source).toContain('const demoPlantModules');
    expect(source).toContain("'plant-inspections'");
    expect(source).toContain('const demoTransportModules');
    expect(source).toContain("'hgv-inspections'");
    expect(source).toContain('const demoWorkshopModules');
    expect(source).toContain("'workshop-tasks'");
  });

  it('deactivates non-demo teams and writes matrix rows for every available module', () => {
    const source = readSource('scripts/demo/seed.ts');

    expect(source).toContain("from('org_teams')");
    expect(source).toContain('.update({ active: false })');
    expect(source).toContain("from('team_module_permissions')");
    expect(source).toContain('ALL_MODULES');
    expect(source).toContain("onConflict: 'team_id,module_name'");
  });

  it('keeps the contractor demo persona on the contractor role', () => {
    const source = readSource('scripts/demo/seed.ts');

    expect(source).toContain("key === 'contractor' ? 'contractor' : 'employee'");
    expect(source).toContain("name: 'contractor'");
    expect(source).toContain('hierarchy_rank: 1');
  });

  it('resets RAMS assignments by the current schema column', () => {
    const source = readSource('scripts/demo/reset.ts');

    expect(source).toContain("['rams_assignments', 'employee_id']");
    expect(source).not.toContain("['rams_assignments', 'profile_id']");
  });

  it('resets absences and all daily-check types by their current schema columns', () => {
    const source = readSource('scripts/demo/reset.ts');

    expect(source).toContain(".from('absences')");
    expect(source).toContain(".in('profile_id', demoUserIds)");
    expect(source).toContain("['van_inspections', 'hgv_inspections', 'plant_inspections']");
    expect(source).toContain("await clearDemoInspections(supabase);");
    expect(source).not.toContain("['absences', 'user_id']");
  });

  it('resets timesheet entries through timesheet ids instead of a missing user column', () => {
    const source = readSource('scripts/demo/reset.ts');

    expect(source).toContain('async function clearDemoTimesheets');
    expect(source).toContain("await deleteFromTable(supabase, 'timesheet_entries', 'timesheet_id', timesheetIds)");
    expect(source).not.toContain("['timesheet_entries', 'user_id']");
  });

  it('returns active teams from the admin team directory', () => {
    const source = readSource('app/api/admin/hierarchy/teams/route.ts');

    expect(source).toContain(".eq('active', true)");
  });
});
