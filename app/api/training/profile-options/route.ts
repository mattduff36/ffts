import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireTrainingAdminAccess } from '@/lib/server/training-auth';
import { filterHiddenSystemTestAccountProfiles } from '@/lib/server/system-test-accounts';
import { isSelectableProfile, toTrainingProfileOption, type ProfileCandidateRow } from '@/lib/server/training-profile-options';
import { logServerError } from '@/lib/utils/server-error-logger';

export async function GET(request: NextRequest) {
  try {
    const access = await requireTrainingAdminAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('profiles')
      .select('id, full_name, employee_id, is_placeholder')
      .eq('is_placeholder', false)
      .order('full_name', { ascending: true });

    if (error) throw error;

    const selectable = ((data || []) as ProfileCandidateRow[]).filter(isSelectableProfile);
    const visible = await filterHiddenSystemTestAccountProfiles(admin, selectable);

    return NextResponse.json({
      profiles: visible.map(toTrainingProfileOption),
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('Error loading training profile options:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/training/profile-options',
      additionalData: { endpoint: '/api/training/profile-options' },
    });
    return NextResponse.json({ error: 'Failed to load employees' }, { status: 500 });
  }
}
