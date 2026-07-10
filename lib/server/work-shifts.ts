import type { SupabaseClient } from '@supabase/supabase-js';
import { cloneWorkShiftPattern, STANDARD_WORK_SHIFT_PATTERN, calculateDurationDaysForShiftPattern, serializePatternToTemplateSlots } from '@/lib/utils/work-shifts';
import { getCurrentFinancialYear } from '@/lib/utils/date';
import { filterHiddenSystemTestAccounts } from '@/lib/utils/system-test-accounts';
import type {
  EmployeeWorkShiftRow,
  WorkShiftPattern,
  WorkShiftTemplate,
} from '@/types/work-shifts';

type AnySupabase = SupabaseClient;

interface WorkShiftTemplateDbRow {
  id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

interface WorkShiftTemplateSlotDbRow {
  template_id: string;
  day_of_week: number;
  am_working: boolean;
  pm_working: boolean;
}

interface EmployeeWorkShiftDbRow {
  id: string;
  profile_id: string;
  template_id: string | null;
  monday_am: boolean;
  monday_pm: boolean;
  tuesday_am: boolean;
  tuesday_pm: boolean;
  wednesday_am: boolean;
  wednesday_pm: boolean;
  thursday_am: boolean;
  thursday_pm: boolean;
  friday_am: boolean;
  friday_pm: boolean;
  saturday_am: boolean;
  saturday_pm: boolean;
  sunday_am: boolean;
  sunday_pm: boolean;
  created_at: string;
  updated_at: string;
}

interface ProfileDirectoryRow {
  id: string;
  full_name: string | null;
  employee_id: string | null;
  team_id: string | null;
  team?: { id?: string | null; name?: string | null } | null;
}

interface WorkShiftTemplateSummary {
  template: WorkShiftTemplate;
  slotRows: WorkShiftTemplateSlotDbRow[];
}

function normalizePatternFromEmployeeRow(row: Partial<EmployeeWorkShiftDbRow> | null | undefined): WorkShiftPattern {
  return cloneWorkShiftPattern({
    monday_am: row?.monday_am,
    monday_pm: row?.monday_pm,
    tuesday_am: row?.tuesday_am,
    tuesday_pm: row?.tuesday_pm,
    wednesday_am: row?.wednesday_am,
    wednesday_pm: row?.wednesday_pm,
    thursday_am: row?.thursday_am,
    thursday_pm: row?.thursday_pm,
    friday_am: row?.friday_am,
    friday_pm: row?.friday_pm,
    saturday_am: row?.saturday_am,
    saturday_pm: row?.saturday_pm,
    sunday_am: row?.sunday_am,
    sunday_pm: row?.sunday_pm,
  });
}

function normalizePatternFromTemplateSlots(slotRows: WorkShiftTemplateSlotDbRow[]): WorkShiftPattern {
  const pattern = cloneWorkShiftPattern(STANDARD_WORK_SHIFT_PATTERN);

  for (const slotRow of slotRows) {
    switch (slotRow.day_of_week) {
      case 1:
        pattern.monday_am = slotRow.am_working;
        pattern.monday_pm = slotRow.pm_working;
        break;
      case 2:
        pattern.tuesday_am = slotRow.am_working;
        pattern.tuesday_pm = slotRow.pm_working;
        break;
      case 3:
        pattern.wednesday_am = slotRow.am_working;
        pattern.wednesday_pm = slotRow.pm_working;
        break;
      case 4:
        pattern.thursday_am = slotRow.am_working;
        pattern.thursday_pm = slotRow.pm_working;
        break;
      case 5:
        pattern.friday_am = slotRow.am_working;
        pattern.friday_pm = slotRow.pm_working;
        break;
      case 6:
        pattern.saturday_am = slotRow.am_working;
        pattern.saturday_pm = slotRow.pm_working;
        break;
      case 7:
        pattern.sunday_am = slotRow.am_working;
        pattern.sunday_pm = slotRow.pm_working;
        break;
      default:
        break;
    }
  }

  return pattern;
}

function buildEmployeeWorkShiftMutation(
  profileId: string,
  pattern: WorkShiftPattern,
  templateId: string | null
) {
  const resolvedPattern = cloneWorkShiftPattern(pattern);

  return {
    profile_id: profileId,
    template_id: templateId,
    monday_am: resolvedPattern.monday_am,
    monday_pm: resolvedPattern.monday_pm,
    tuesday_am: resolvedPattern.tuesday_am,
    tuesday_pm: resolvedPattern.tuesday_pm,
    wednesday_am: resolvedPattern.wednesday_am,
    wednesday_pm: resolvedPattern.wednesday_pm,
    thursday_am: resolvedPattern.thursday_am,
    thursday_pm: resolvedPattern.thursday_pm,
    friday_am: resolvedPattern.friday_am,
    friday_pm: resolvedPattern.friday_pm,
    saturday_am: resolvedPattern.saturday_am,
    saturday_pm: resolvedPattern.saturday_pm,
    sunday_am: resolvedPattern.sunday_am,
    sunday_pm: resolvedPattern.sunday_pm,
  };
}

async function saveTemplateSlots(
  supabase: AnySupabase,
  templateId: string,
  pattern: WorkShiftPattern
): Promise<void> {
  const slotRows = serializePatternToTemplateSlots(pattern).map((slot) => ({
    template_id: templateId,
    ...slot,
  }));

  const { error } = await supabase
    .from('work_shift_template_slots')
    .upsert(slotRows, { onConflict: 'template_id,day_of_week' });

  if (error) {
    throw error;
  }
}

async function loadTemplatePattern(
  supabase: AnySupabase,
  templateId: string
): Promise<WorkShiftPattern | null> {
  const { data, error } = await supabase
    .from('work_shift_template_slots')
    .select('template_id, day_of_week, am_working, pm_working')
    .eq('template_id', templateId)
    .order('day_of_week', { ascending: true });

  if (error) {
    throw error;
  }

  const slotRows = (data || []) as WorkShiftTemplateSlotDbRow[];
  if (slotRows.length === 0) {
    return null;
  }

  return normalizePatternFromTemplateSlots(slotRows);
}

async function fetchTemplateSummaries(supabase: AnySupabase): Promise<WorkShiftTemplateSummary[]> {
  const [{ data: templates, error: templateError }, { data: slots, error: slotError }] = await Promise.all([
    supabase
      .from('work_shift_templates')
      .select('id, name, description, is_default, created_at, updated_at')
      .order('is_default', { ascending: false })
      .order('name', { ascending: true }),
    supabase
      .from('work_shift_template_slots')
      .select('template_id, day_of_week, am_working, pm_working')
      .order('day_of_week', { ascending: true }),
  ]);

  if (templateError) {
    throw templateError;
  }
  if (slotError) {
    throw slotError;
  }

  const slotRows = (slots || []) as WorkShiftTemplateSlotDbRow[];
  const templateRows = (templates || []) as WorkShiftTemplateDbRow[];

  return templateRows.map((templateRow) => {
    const rowsForTemplate = slotRows.filter((slotRow) => slotRow.template_id === templateRow.id);
    return {
      template: {
        ...templateRow,
        pattern: normalizePatternFromTemplateSlots(rowsForTemplate),
      },
      slotRows: rowsForTemplate,
    };
  });
}

export async function listWorkShiftTemplates(supabase: AnySupabase): Promise<WorkShiftTemplate[]> {
  const summaries = await fetchTemplateSummaries(supabase);
  return summaries.map((summary) => summary.template);
}

export async function ensureStandardWorkShiftTemplate(supabase: AnySupabase): Promise<WorkShiftTemplate> {
  const { data: existingDefault, error: existingError } = await supabase
    .from('work_shift_templates')
    .select('id, name, description, is_default, created_at, updated_at')
    .eq('is_default', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  let defaultTemplate = existingDefault as WorkShiftTemplateDbRow | null;
  let defaultPattern: WorkShiftPattern | null = null;

  if (!defaultTemplate) {
    const { data: inserted, error: insertError } = await supabase
      .from('work_shift_templates')
      .insert({
        name: 'Standard Week',
        description: 'Monday to Friday, AM and PM.',
        is_default: true,
      })
      .select('id, name, description, is_default, created_at, updated_at')
      .single();

    if (insertError) {
      throw insertError;
    }

    defaultTemplate = inserted as WorkShiftTemplateDbRow;
    defaultPattern = cloneWorkShiftPattern(STANDARD_WORK_SHIFT_PATTERN);
    await saveTemplateSlots(supabase, defaultTemplate.id, defaultPattern);
  } else {
    defaultPattern = await loadTemplatePattern(supabase, defaultTemplate.id);
    if (!defaultPattern) {
      defaultPattern = cloneWorkShiftPattern(STANDARD_WORK_SHIFT_PATTERN);
      await saveTemplateSlots(supabase, defaultTemplate.id, defaultPattern);
    }
  }

  return {
    ...defaultTemplate,
    pattern: defaultPattern,
  };
}

export async function ensureEmployeeWorkShiftRecords(
  supabase: AnySupabase,
  profileIds: string[]
): Promise<void> {
  const uniqueProfileIds = Array.from(new Set(profileIds.filter(Boolean)));
  if (uniqueProfileIds.length === 0) {
    return;
  }

  const defaultTemplate = await ensureStandardWorkShiftTemplate(supabase);
  const { data: existingRows, error: existingError } = await supabase
    .from('employee_work_shifts')
    .select('profile_id')
    .in('profile_id', uniqueProfileIds);

  if (existingError) {
    throw existingError;
  }

  const existingProfileIds = new Set(
    ((existingRows || []) as Array<{ profile_id: string }>).map((row) => row.profile_id)
  );
  const rowsToInsert = uniqueProfileIds
    .filter((profileId) => !existingProfileIds.has(profileId))
    .map((profileId) => buildEmployeeWorkShiftMutation(profileId, defaultTemplate.pattern, defaultTemplate.id));

  if (rowsToInsert.length === 0) {
    return;
  }

  const { error: insertError } = await supabase.from('employee_work_shifts').insert(rowsToInsert);
  if (insertError) {
    throw insertError;
  }
}

export async function loadEmployeeWorkShiftPatternMap(
  supabase: AnySupabase,
  profileIds: string[],
  options?: {
    ensureRecords?: boolean;
  }
): Promise<Map<string, WorkShiftPattern>> {
  const uniqueProfileIds = Array.from(new Set(profileIds.filter(Boolean)));
  const patternMap = new Map<string, WorkShiftPattern>();

  if (uniqueProfileIds.length === 0) {
    return patternMap;
  }

  if (options?.ensureRecords !== false) {
    await ensureEmployeeWorkShiftRecords(supabase, uniqueProfileIds);
  }

  const { data, error } = await supabase
    .from('employee_work_shifts')
    .select(`
      profile_id,
      monday_am,
      monday_pm,
      tuesday_am,
      tuesday_pm,
      wednesday_am,
      wednesday_pm,
      thursday_am,
      thursday_pm,
      friday_am,
      friday_pm,
      saturday_am,
      saturday_pm,
      sunday_am,
      sunday_pm
    `)
    .in('profile_id', uniqueProfileIds);

  if (error) {
    throw error;
  }

  for (const row of (data || []) as EmployeeWorkShiftDbRow[]) {
    patternMap.set(row.profile_id, normalizePatternFromEmployeeRow(row));
  }

  for (const profileId of uniqueProfileIds) {
    if (!patternMap.has(profileId)) {
      patternMap.set(profileId, cloneWorkShiftPattern(STANDARD_WORK_SHIFT_PATTERN));
    }
  }

  return patternMap;
}

export async function recalculateAbsenceDurationsForProfiles(
  supabase: AnySupabase,
  profileIds: string[]
): Promise<number> {
  const uniqueProfileIds = Array.from(new Set(profileIds.filter(Boolean)));
  if (uniqueProfileIds.length === 0) {
    return 0;
  }

  const currentFinancialYear = getCurrentFinancialYear();
  const financialYearStartIso = currentFinancialYear.start.toISOString().slice(0, 10);
  const patternMap = await loadEmployeeWorkShiftPatternMap(supabase, uniqueProfileIds);
  const { data, error } = await supabase
    .from('absences')
    .select('id, profile_id, date, end_date, is_half_day, half_day_session, duration_days, status')
    .in('profile_id', uniqueProfileIds)
    .gte('date', financialYearStartIso)
    .in('status', ['pending', 'approved', 'processed']);

  if (error) {
    throw error;
  }

  const absences = (data || []) as Array<{
    id: string;
    profile_id: string;
    date: string;
    end_date: string | null;
    is_half_day: boolean;
    half_day_session: 'AM' | 'PM' | null;
    duration_days: number | null;
    status: string | null;
  }>;

  let updatedCount = 0;
  for (const absence of absences) {
    const pattern = patternMap.get(absence.profile_id) || STANDARD_WORK_SHIFT_PATTERN;
    const nextDuration = calculateDurationDaysForShiftPattern(
      new Date(`${absence.date}T00:00:00`),
      absence.end_date ? new Date(`${absence.end_date}T00:00:00`) : null,
      pattern,
      {
        isHalfDay: absence.is_half_day,
        halfDaySession: absence.half_day_session,
      }
    );

    if ((absence.duration_days || 0) === nextDuration) {
      continue;
    }

    const { error: updateError } = await supabase
      .from('absences')
      .update({ duration_days: nextDuration })
      .eq('id', absence.id);

    if (updateError) {
      throw updateError;
    }

    updatedCount += 1;
  }

  return updatedCount;
}

export async function getWorkShiftMatrix(
  supabase: AnySupabase,
  options?: {
    enforceTeamScope?: boolean;
    teamId?: string | null;
  }
): Promise<{
  templates: WorkShiftTemplate[];
  employees: EmployeeWorkShiftRow[];
}> {
  await ensureStandardWorkShiftTemplate(supabase);

  const enforceTeamScope = Boolean(options?.enforceTeamScope);
  let profileRows: ProfileDirectoryRow[] = [];
  if (!enforceTeamScope || options?.teamId) {
    let profilesQuery = supabase
      .from('profiles')
      .select('id, full_name, employee_id, team_id, team:org_teams!profiles_team_id_fkey(id, name)')
      .order('full_name', { ascending: true });
    if (enforceTeamScope && options?.teamId) {
      profilesQuery = profilesQuery.eq('team_id', options.teamId);
    }

    const { data: profiles, error: profileError } = await profilesQuery;
    if (profileError) {
      throw profileError;
    }
    profileRows = filterHiddenSystemTestAccounts((profiles || []) as ProfileDirectoryRow[]);
  }
  await ensureEmployeeWorkShiftRecords(
    supabase,
    profileRows.map((profile) => profile.id)
  );

  const [templateSummaries, employeeRowsResult] = await Promise.all([
    fetchTemplateSummaries(supabase),
    profileRows.length === 0
      ? Promise.resolve({
          data: [] as EmployeeWorkShiftDbRow[],
          error: null,
        })
      : supabase
          .from('employee_work_shifts')
          .select(`
            id,
            profile_id,
            template_id,
            monday_am,
            monday_pm,
            tuesday_am,
            tuesday_pm,
            wednesday_am,
            wednesday_pm,
            thursday_am,
            thursday_pm,
            friday_am,
            friday_pm,
            saturday_am,
            saturday_pm,
            sunday_am,
            sunday_pm,
            created_at,
            updated_at
          `)
          .in(
            'profile_id',
            profileRows.map((profile) => profile.id)
          )
          .order('updated_at', { ascending: false }),
  ]);

  if (employeeRowsResult.error) {
    throw employeeRowsResult.error;
  }

  const templates = templateSummaries.map((summary) => summary.template);
  const templateNameById = new Map(templates.map((template) => [template.id, template.name]));
  const profileById = new Map(profileRows.map((profile) => [profile.id, profile]));
  const employeeRows = (employeeRowsResult.data || []) as EmployeeWorkShiftDbRow[];

  const employees = employeeRows
    .map((row) => {
      const profile = profileById.get(row.profile_id);
      if (!profile) {
        return null;
      }

      return {
        id: row.id,
        profile_id: row.profile_id,
        full_name: profile.full_name || 'Unknown employee',
        employee_id: profile.employee_id,
        team_id: profile.team_id || null,
        team_name: profile.team?.name || null,
        template_id: row.template_id,
        template_name: row.template_id ? templateNameById.get(row.template_id) || null : null,
        updated_at: row.updated_at,
        pattern: normalizePatternFromEmployeeRow(row),
      } as EmployeeWorkShiftRow;
    })
    .filter((row): row is EmployeeWorkShiftRow => row !== null)
    .sort((left, right) => left.full_name.localeCompare(right.full_name));

  return { templates, employees };
}

export async function getCurrentUserWorkShift(
  supabase: AnySupabase,
  profileId: string
): Promise<{ templateId: string | null; templateName: string | null; pattern: WorkShiftPattern }> {
  await ensureEmployeeWorkShiftRecords(supabase, [profileId]);
  const [templateSummaries, employeeRowResult] = await Promise.all([
    fetchTemplateSummaries(supabase),
    supabase
      .from('employee_work_shifts')
      .select(`
        id,
        profile_id,
        template_id,
        monday_am,
        monday_pm,
        tuesday_am,
        tuesday_pm,
        wednesday_am,
        wednesday_pm,
        thursday_am,
        thursday_pm,
        friday_am,
        friday_pm,
        saturday_am,
        saturday_pm,
        sunday_am,
        sunday_pm,
        created_at,
        updated_at
      `)
      .eq('profile_id', profileId)
      .single(),
  ]);

  if (employeeRowResult.error) {
    throw employeeRowResult.error;
  }

  const templateNameById = new Map(templateSummaries.map((summary) => [summary.template.id, summary.template.name]));
  const row = employeeRowResult.data as EmployeeWorkShiftDbRow;

  return {
    templateId: row.template_id,
    templateName: row.template_id ? templateNameById.get(row.template_id) || null : null,
    pattern: normalizePatternFromEmployeeRow(row),
  };
}

export async function createWorkShiftTemplate(
  supabase: AnySupabase,
  input: { name: string; description?: string | null; pattern: WorkShiftPattern }
): Promise<WorkShiftTemplate> {
  const { data, error } = await supabase
    .from('work_shift_templates')
    .insert({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      is_default: false,
    })
    .select('id, name, description, is_default, created_at, updated_at')
    .single();

  if (error) {
    throw error;
  }

  const templateRow = data as WorkShiftTemplateDbRow;
  const pattern = cloneWorkShiftPattern(input.pattern);
  await saveTemplateSlots(supabase, templateRow.id, pattern);

  return {
    ...templateRow,
    pattern,
  };
}

export async function updateWorkShiftTemplate(
  supabase: AnySupabase,
  templateId: string,
  input: {
    name?: string;
    description?: string | null;
    pattern?: WorkShiftPattern;
    is_default?: boolean;
  }
): Promise<WorkShiftTemplate> {
  const updatePayload: Record<string, unknown> = {};

  if (typeof input.name === 'string') {
    updatePayload.name = input.name.trim();
  }
  if (Object.prototype.hasOwnProperty.call(input, 'description')) {
    updatePayload.description = input.description?.trim() || null;
  }

  if (input.is_default === true) {
    const { error: resetError } = await supabase
      .from('work_shift_templates')
      .update({ is_default: false })
      .neq('id', templateId);

    if (resetError) {
      throw resetError;
    }

    updatePayload.is_default = true;
  }

  const query = Object.keys(updatePayload).length > 0
    ? supabase
        .from('work_shift_templates')
        .update(updatePayload)
        .eq('id', templateId)
        .select('id, name, description, is_default, created_at, updated_at')
        .single()
    : supabase
        .from('work_shift_templates')
        .select('id, name, description, is_default, created_at, updated_at')
        .eq('id', templateId)
        .single();

  const { error } = await query;
  if (error) {
    throw error;
  }

  if (input.pattern) {
    await saveTemplateSlots(supabase, templateId, input.pattern);
  }

  const templateSummaries = await fetchTemplateSummaries(supabase);
  const updatedTemplate = templateSummaries.find((summary) => summary.template.id === templateId)?.template;
  if (!updatedTemplate) {
    throw new Error('Updated template could not be loaded');
  }

  return updatedTemplate;
}

export async function deleteWorkShiftTemplate(
  supabase: AnySupabase,
  templateId: string
): Promise<void> {
  const { data: templateRow, error: templateError } = await supabase
    .from('work_shift_templates')
    .select('id, is_default')
    .eq('id', templateId)
    .single();

  if (templateError) {
    throw templateError;
  }

  if ((templateRow as { is_default?: boolean } | null)?.is_default) {
    throw new Error('The default Standard Week template cannot be deleted');
  }

  const { error: clearEmployeeError } = await supabase
    .from('employee_work_shifts')
    .update({ template_id: null })
    .eq('template_id', templateId);

  if (clearEmployeeError) {
    throw clearEmployeeError;
  }

  const { error: deleteSlotError } = await supabase
    .from('work_shift_template_slots')
    .delete()
    .eq('template_id', templateId);

  if (deleteSlotError) {
    throw deleteSlotError;
  }

  const { error: deleteTemplateError } = await supabase
    .from('work_shift_templates')
    .delete()
    .eq('id', templateId);

  if (deleteTemplateError) {
    throw deleteTemplateError;
  }
}

export async function applyTemplateToProfiles(
  supabase: AnySupabase,
  templateId: string,
  profileIds: string[]
): Promise<{ affectedProfiles: number; recalculatedAbsences: number }> {
  const templateSummaries = await fetchTemplateSummaries(supabase);
  const template = templateSummaries.find((summary) => summary.template.id === templateId)?.template;
  if (!template) {
    throw new Error('Template not found');
  }

  const uniqueProfileIds = Array.from(new Set(profileIds.filter(Boolean)));
  if (uniqueProfileIds.length === 0) {
    return { affectedProfiles: 0, recalculatedAbsences: 0 };
  }

  const payload = uniqueProfileIds.map((profileId) =>
    buildEmployeeWorkShiftMutation(profileId, template.pattern, template.id)
  );

  const { error } = await supabase
    .from('employee_work_shifts')
    .upsert(payload, { onConflict: 'profile_id' });

  if (error) {
    throw error;
  }

  const recalculatedAbsences = await recalculateAbsenceDurationsForProfiles(supabase, uniqueProfileIds);
  return {
    affectedProfiles: uniqueProfileIds.length,
    recalculatedAbsences,
  };
}

export async function updateEmployeeWorkShift(
  supabase: AnySupabase,
  profileId: string,
  input: {
    templateId?: string | null;
    pattern: WorkShiftPattern;
  }
): Promise<{ row: EmployeeWorkShiftRow; recalculatedAbsences: number }> {
  const mutation = buildEmployeeWorkShiftMutation(profileId, input.pattern, input.templateId ?? null);

  const { error } = await supabase
    .from('employee_work_shifts')
    .upsert(mutation, { onConflict: 'profile_id' });

  if (error) {
    throw error;
  }

  const recalculatedAbsences = await recalculateAbsenceDurationsForProfiles(supabase, [profileId]);
  const matrix = await getWorkShiftMatrix(supabase);
  const row = matrix.employees.find((employee) => employee.profile_id === profileId);

  if (!row) {
    throw new Error('Updated employee work shift could not be loaded');
  }

  return {
    row,
    recalculatedAbsences,
  };
}
