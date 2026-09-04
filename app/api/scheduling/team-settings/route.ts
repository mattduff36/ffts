import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireSchedulingManagerAccess } from '@/lib/server/scheduling-auth';
import {
  loadScheduleTeamSettings,
  mapTeamSettingsRpcError,
  normalizeTeamSettingsSaveInput,
} from '@/lib/server/scheduling-team-settings';
import type { ScheduleEmployeeResource } from '@/types/scheduling';

const leaderSchema = z.object({
  slot_index: z.number().int().min(1).max(5),
  profile_id: z.uuid().nullable(),
});

const saveSchema = z.object({
  visible_slot_count: z.number().int().min(5).max(10),
  leaders: z.array(leaderSchema).max(5),
});

export async function PUT(request: NextRequest) {
  try {
    const access = await requireSchedulingManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const parsed = saveSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Choose valid team settings.' },
        { status: 400 }
      );
    }

    const payload = normalizeTeamSettingsSaveInput(parsed.data);
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('save_schedule_team_settings_v1', {
      p_visible_slot_count: payload.visible_slot_count,
      p_leaders: payload.leaders,
      p_actor_user_id: access.userId,
    });
    if (error) {
      const mapped = mapTeamSettingsRpcError(error);
      if (mapped) {
        return NextResponse.json({ error: mapped.error }, { status: mapped.status });
      }
      throw error;
    }

    const employeesResult = await admin
      .from('profiles')
      .select('id, full_name, employee_id, team_id, is_placeholder, team:org_teams!profiles_team_id_fkey(name)')
      .eq('is_placeholder', false);
    if (employeesResult.error) throw employeesResult.error;
    const employeesById = new Map(
      ((employeesResult.data || []) as Array<Record<string, unknown>>).map((row) => {
        const team = row.team as { name?: string } | { name?: string }[] | null;
        const teamName = Array.isArray(team) ? team[0]?.name : team?.name;
        const employee: ScheduleEmployeeResource = {
          id: String(row.id),
          full_name: String(row.full_name || 'Employee'),
          employee_id: typeof row.employee_id === 'string' ? row.employee_id : null,
          team_id: typeof row.team_id === 'string' ? row.team_id : null,
          team_name: typeof teamName === 'string' ? teamName : null,
        };
        return [employee.id, employee] as const;
      })
    );
    const settings = await loadScheduleTeamSettings(admin, employeesById);
    const row = Array.isArray(data) ? data[0] : data;
    return NextResponse.json({
      settings: {
        ...settings,
        visible_slot_count: Number(
          (row as { visible_slot_count?: number } | null)?.visible_slot_count
          || settings.visible_slot_count
        ),
      },
    });
  } catch (error) {
    console.error('Error saving schedule team settings:', error);
    return NextResponse.json({ error: 'Unable to save team settings.' }, { status: 500 });
  }
}
