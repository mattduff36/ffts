import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

describe('absence archive run route security', () => {
  it('requires admin absence access and passes profile id to the archive RPC', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'app/api/absence/archive/run/route.ts'),
      'utf-8'
    );

    expect(source).toContain("import { requireAdminAbsenceAccess } from '@/lib/server/absence-work-shift-auth';");
    expect(source).toContain('const auth = await requireAdminAbsenceAccess();');
    expect(source).toContain('const profile = await getProfileWithRole(auth.user.id);');
    expect(source).toContain('actorId: profile.id');
    expect(source).not.toContain("canEffectiveRoleAccessModule('absence')");
    expect(source).not.toContain('actorId: user.id');
  });
});
