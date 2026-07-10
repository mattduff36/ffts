import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf-8');
}

describe('workshop task creation route', () => {
  it('creates manual workshop tasks through an authenticated admin-backed API route', () => {
    const src = read('app/api/workshop-tasks/tasks/route.ts');

    expect(src).toContain("import { createAdminClient } from '@/lib/supabase/admin';");
    expect(src).toContain("canEffectiveRoleAccessModule('workshop-tasks')");
    expect(src).toMatch(/admin\s*\n\s*\.from\('actions'\)\s*\n\s*\.insert\(taskData\)/);
    expect(src).toMatch(/admin\s*\n\s*\.from\('vehicle_maintenance'\)/);
  });

  it('routes workshop task create forms through the API instead of direct actions inserts', () => {
    const hookSrc = read('app/(dashboard)/workshop-tasks/hooks/useWorkshopTaskCrudActions.ts');
    const dialogSrc = read('components/workshop-tasks/CreateWorkshopTaskDialog.tsx');

    expect(hookSrc.split('const handleEditTask')[0]).toContain("fetch('/api/workshop-tasks/tasks'");
    expect(hookSrc.split('const handleEditTask')[0]).not.toContain(".from('actions')");
    expect(dialogSrc).toContain("fetch('/api/workshop-tasks/tasks'");
    expect(dialogSrc).not.toContain(".from('actions')");
  });
});
