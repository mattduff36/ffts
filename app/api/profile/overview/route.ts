import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { PROFILE_HUB_PRD_EPIC_ID } from '@/lib/profile/epic';
import { canEditOwnBasicProfileFields } from '@/lib/profile/permissions';
import { buildFrequentQuickLinks, buildRecentQuickLinks } from '@/lib/profile/quick-links';
import { getPermissionLevelsForUser, getPermissionModules } from '@/lib/server/team-permissions';
import { fetchCarryoverMapForFinancialYear, getEffectiveAllowance } from '@/lib/utils/absence-carryover';
import { getCurrentFinancialYear } from '@/lib/utils/date';
import { hasEffectiveRoleFullAccess } from '@/lib/utils/role-access';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { getCurrentFleetAssignmentSummary } from '@/lib/server/profile-fleet-assignments';
import type { ProfileOverviewPayload } from '@/types/profile';
import {
  ALL_MODULES,
  MODULE_DESCRIPTIONS,
  MODULE_DISPLAY_NAMES,
  PERMISSION_LEVEL_LABELS,
  type ModuleName,
  type PermissionAccessLevel,
} from '@/types/roles';

interface InspectionRow {
  id: string;
  inspection_date: string;
  status: string;
}

interface InspectionItemSummaryRow {
  inspection_id: string | null;
}

interface WorkshopTaskSummaryRow {
  inspection_id: string | null;
}

interface ManagerProfileRow {
  id: string;
  full_name: string | null;
  phone_number?: string | null;
}

interface ProjectAssignmentRow {
  id: string;
  status: string;
  assigned_at: string | null;
  signed_at: string | null;
  document: ProjectDocumentRow | ProjectDocumentRow[] | null;
}

interface ProjectDocumentRow {
  id?: string | null;
  title?: string | null;
  document_type?: { name?: string | null; required_signature?: boolean | null } | Array<{
    name?: string | null;
    required_signature?: boolean | null;
  }> | null;
}

function getRelationValue<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

function normalizeProjectStatus(status: string): ProfileOverviewPayload['project_assignments'][number]['status'] {
  if (status === 'signed' || status === 'read') return status;
  return 'pending';
}

async function buildManagerSummaries(
  admin: ReturnType<typeof createAdminClient>,
  profileRow: Record<string, unknown>,
  teamValue: Record<string, unknown> | null
): Promise<ProfileOverviewPayload['managers']> {
  const managerSources = new Map<string, ProfileOverviewPayload['managers'][number]['source']>();
  const addManager = (
    id: string | null | undefined,
    source: ProfileOverviewPayload['managers'][number]['source']
  ) => {
    if (!id || id === profileRow.id || managerSources.has(id)) return;
    managerSources.set(id, source);
  };

  addManager(profileRow.line_manager_id as string | null | undefined, 'line_manager');
  addManager(profileRow.secondary_manager_id as string | null | undefined, 'secondary_manager');
  addManager(teamValue?.manager_1_profile_id as string | null | undefined, 'team_manager');
  addManager(teamValue?.manager_2_profile_id as string | null | undefined, 'team_manager');

  const managerIds = Array.from(managerSources.keys());
  if (managerIds.length === 0) return [];

  const { data, error } = await admin
    .from('profiles')
    .select('id, full_name, phone_number')
    .in('id', managerIds);

  if (error) throw error;

  const emailByManagerId = new Map<string, string | null>();
  await Promise.all(
    ((data || []) as ManagerProfileRow[]).map(async (manager) => {
      const { data: authData, error: authError } = await admin.auth.admin.getUserById(manager.id);
      emailByManagerId.set(manager.id, authError ? null : authData.user?.email || null);
    })
  );

  return ((data || []) as ManagerProfileRow[]).map((manager) => ({
    id: manager.id,
    full_name: manager.full_name || 'Unnamed manager',
    email: emailByManagerId.get(manager.id) || null,
    phone_number: manager.phone_number || null,
    source: managerSources.get(manager.id) || 'team_manager',
  }));
}

async function buildProjectAssignmentSummaries(
  admin: ReturnType<typeof createAdminClient>,
  userId: string
): Promise<ProfileOverviewPayload['project_assignments']> {
  const { data, error } = await admin
    .from('rams_assignments')
    .select(`
      id,
      status,
      assigned_at,
      signed_at,
      document:rams_documents!rams_assignments_rams_document_id_fkey(
        id,
        title,
        document_type:project_document_types(name, required_signature)
      )
    `)
    .eq('employee_id', userId)
    .order('assigned_at', { ascending: false })
    .limit(4);

  if (error) throw error;

  return ((data || []) as unknown as ProjectAssignmentRow[])
    .map((assignment) => ({
      ...assignment,
      document: getRelationValue(assignment.document),
    }))
    .filter((assignment) => assignment.document?.id)
    .map((assignment) => {
      const documentType = getRelationValue(assignment.document?.document_type);
      return {
        id: assignment.id,
        document_id: String(assignment.document?.id),
        title: String(assignment.document?.title || 'Untitled project document'),
        document_type_name: documentType?.name || null,
        required_signature: documentType?.required_signature ?? true,
        status: normalizeProjectStatus(assignment.status),
        assigned_at: assignment.assigned_at,
        signed_at: assignment.signed_at,
      };
    });
}

async function buildPermissionSummary(
  admin: ReturnType<typeof createAdminClient>,
  userId: string
): Promise<ProfileOverviewPayload['permission_summary']> {
  const [effectiveRole, modules] = await Promise.all([
    getEffectiveRole(),
    getPermissionModules(admin),
  ]);
  const hasFullAccess = hasEffectiveRoleFullAccess(effectiveRole);
  const permissionLevels = hasFullAccess
    ? ALL_MODULES.reduce<Record<ModuleName, PermissionAccessLevel>>((acc, moduleName) => {
        acc[moduleName] = 5;
        return acc;
      }, {} as Record<ModuleName, PermissionAccessLevel>)
    : await getPermissionLevelsForUser(userId, effectiveRole.role_id, admin, effectiveRole.team_id, {
      includeUserOverrides: effectiveRole.is_viewing_as !== true,
    });

  const modulesByName = new Map(modules.map((module) => [module.module_name, module]));
  const accessibleModules = ALL_MODULES
    .map((moduleName) => {
      const accessLevel = (permissionLevels[moduleName] || 0) as PermissionAccessLevel;
      const moduleInfo = modulesByName.get(moduleName);
      return {
        module_name: moduleName,
        display_name: moduleInfo?.display_name || MODULE_DISPLAY_NAMES[moduleName],
        description: moduleInfo?.description || MODULE_DESCRIPTIONS[moduleName],
        access_level: accessLevel,
        access_label: PERMISSION_LEVEL_LABELS[accessLevel],
        requires_sensitive_pin: moduleInfo?.requires_sensitive_pin === true,
      };
    })
    .filter((module) => module.access_level > 0);

  return {
    effective_team_name: effectiveRole.team_name,
    has_sensitive_module_access: accessibleModules.some((module) => module.requires_sensitive_pin),
    modules: accessibleModules,
  };
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  try {
    const { start, end } = getCurrentFinancialYear();
    const fyStartYear = start.getFullYear();
    const startIso = start.toISOString().split('T')[0];
    const endIso = end.toISOString().split('T')[0];

    const [
      { data: profile, error: profileError },
      { data: timesheets, error: timesheetsError },
      { data: absences, error: absencesError },
      { data: vanInspections, error: vanInspectionsError },
      { data: plantInspections, error: plantInspectionsError },
      { data: hgvInspections, error: hgvInspectionsError },
      { data: annualLeaveReasons, error: annualLeaveReasonsError },
      { data: visits, error: visitsError },
      { count: unresolvedSuggestionsCount, error: unresolvedSuggestionsError },
      { count: unresolvedErrorReportsCount, error: unresolvedErrorReportsError },
      carryoverByProfile,
    ] = await Promise.all([
      admin
        .from('profiles')
        .select(`
          id,
          full_name,
          phone_number,
          employee_id,
          avatar_url,
          must_change_password,
          annual_holiday_allowance_days,
          super_admin,
          line_manager_id,
          secondary_manager_id,
          emergency_contact_name,
          emergency_contact_phone,
          emergency_contact_relationship,
          secondary_emergency_contact_name,
          secondary_emergency_contact_phone,
          secondary_emergency_contact_relationship,
          employer_profile_notes,
          team:org_teams!profiles_team_id_fkey(id, name, manager_1_profile_id, manager_2_profile_id),
          role:roles(name, display_name, role_class, is_manager_admin, is_super_admin)
        `)
        .eq('id', user.id)
        .single(),
      admin
        .from('timesheets')
        .select('id, week_ending, status')
        .eq('user_id', user.id)
        .order('week_ending', { ascending: false })
        .limit(3),
      admin
        .from('absences')
        .select('id, date, end_date, status, reason:absence_reasons(name)')
        .eq('profile_id', user.id)
        .gte('date', startIso)
        .lte('date', endIso)
        .order('date', { ascending: false })
        .limit(3),
      admin
        .from('van_inspections')
        .select('id, inspection_date, status')
        .eq('user_id', user.id)
        .order('inspection_date', { ascending: false })
        .limit(3),
      admin
        .from('plant_inspections')
        .select('id, inspection_date, status')
        .eq('user_id', user.id)
        .order('inspection_date', { ascending: false })
        .limit(3),
      admin
        .from('hgv_inspections')
        .select('id, inspection_date, status')
        .eq('user_id', user.id)
        .order('inspection_date', { ascending: false })
        .limit(3),
      admin
        .from('absence_reasons')
        .select('id')
        .ilike('name', 'annual leave')
        .order('name', { ascending: true }),
      admin
        .from('user_page_visits')
        .select('path, visited_at')
        .eq('user_id', user.id)
        .gte('visited_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
        .order('visited_at', { ascending: false })
        .limit(500),
      admin
        .from('suggestions')
        .select('id', { count: 'exact', head: true })
        .eq('created_by', user.id)
        .in('status', ['new', 'under_review', 'planned']),
      admin
        .from('error_reports')
        .select('id', { count: 'exact', head: true })
        .eq('created_by', user.id)
        .in('status', ['new', 'investigating']),
      fetchCarryoverMapForFinancialYear(admin, fyStartYear, [user.id]),
    ]);

    if (profileError) throw profileError;
    if (timesheetsError) throw timesheetsError;
    if (absencesError) throw absencesError;
    if (vanInspectionsError) throw vanInspectionsError;
    if (plantInspectionsError) throw plantInspectionsError;
    if (hgvInspectionsError) throw hgvInspectionsError;
    if (annualLeaveReasonsError) throw annualLeaveReasonsError;
    if (visitsError) throw visitsError;
    if (unresolvedSuggestionsError) throw unresolvedSuggestionsError;
    if (unresolvedErrorReportsError) throw unresolvedErrorReportsError;

    const profileRow = (profile || {}) as Record<string, unknown>;
    const teamValueRaw = profileRow.team;
    const roleValueRaw = profileRow.role;
    const teamValue =
      Array.isArray(teamValueRaw) ? (teamValueRaw[0] as Record<string, unknown> | undefined) || null : teamValueRaw;
    const roleValue =
      Array.isArray(roleValueRaw) ? (roleValueRaw[0] as Record<string, unknown> | undefined) || null : roleValueRaw;

    const typedProfile = {
      ...profileRow,
      team: teamValue,
      role: roleValue,
      email: user.email || null,
    };

    const allowance = getEffectiveAllowance(
      (profileRow.annual_holiday_allowance_days as number | null | undefined) ?? null,
      carryoverByProfile.get(user.id) || 0
    );

    const annualLeaveReasonIds = ((annualLeaveReasons || []) as Array<{ id?: string | null }>)
      .map((reason) => reason.id)
      .filter((id): id is string => Boolean(id));
    const annualRows = annualLeaveReasonIds.length > 0
      ? await admin
          .from('absences')
          .select('status, duration_days')
          .eq('profile_id', user.id)
          .in('reason_id', annualLeaveReasonIds)
          .gte('date', startIso)
          .lte('date', endIso)
      : { data: [], error: null };

    if (annualRows.error) throw annualRows.error;

    const approvedTaken = (annualRows.data || [])
      .filter((row) => row.status === 'approved' || row.status === 'processed')
      .reduce((sum, row) => sum + (row.duration_days || 0), 0);
    const pendingTotal = (annualRows.data || [])
      .filter((row) => row.status === 'pending')
      .reduce((sum, row) => sum + (row.duration_days || 0), 0);

    let mergedInspections = [
      ...((vanInspections || []) as InspectionRow[]).map((inspection) => ({
        ...inspection,
        inspectionType: 'van' as const,
        href: `/van-inspections/${inspection.id}`,
        has_reported_defect: false,
        has_inform_workshop_task: false,
      })),
      ...((plantInspections || []) as InspectionRow[]).map((inspection) => ({
        ...inspection,
        inspectionType: 'plant' as const,
        href: `/plant-inspections/${inspection.id}`,
        has_reported_defect: false,
        has_inform_workshop_task: false,
      })),
      ...((hgvInspections || []) as InspectionRow[]).map((inspection) => ({
        ...inspection,
        inspectionType: 'hgv' as const,
        href: `/hgv-inspections/${inspection.id}`,
        has_reported_defect: false,
        has_inform_workshop_task: false,
      })),
    ]
      .sort((a, b) => new Date(b.inspection_date).getTime() - new Date(a.inspection_date).getTime())
      .slice(0, 3);

    const inspectionIds = mergedInspections.map((inspection) => inspection.id).filter(Boolean);
    if (inspectionIds.length > 0) {
      const [{ data: defectData, error: defectError }, { data: workshopTaskData, error: workshopTaskError }] =
        await Promise.all([
          admin
            .from('inspection_items')
            .select('inspection_id')
            .in('inspection_id', inspectionIds)
            .in('status', ['attention', 'defect']),
          admin
            .from('actions')
            .select('inspection_id')
            .in('inspection_id', inspectionIds)
            .eq('action_type', 'workshop_vehicle_task'),
        ]);

      if (!defectError) {
        const defectInspectionIds = new Set(
          ((defectData || []) as InspectionItemSummaryRow[])
            .map((row) => row.inspection_id)
            .filter((id): id is string => Boolean(id))
        );
        mergedInspections = mergedInspections.map((inspection) => ({
          ...inspection,
          has_reported_defect: defectInspectionIds.has(inspection.id),
        }));
      }

      if (!workshopTaskError) {
        const workshopInspectionIds = new Set(
          ((workshopTaskData || []) as WorkshopTaskSummaryRow[])
            .map((row) => row.inspection_id)
            .filter((id): id is string => Boolean(id))
        );
        mergedInspections = mergedInspections.map((inspection) => ({
          ...inspection,
          has_inform_workshop_task: workshopInspectionIds.has(inspection.id),
        }));
      }
    }

    const [managers, projectAssignments, permissionSummary, currentFleetAssignment] = await Promise.all([
      buildManagerSummaries(admin, profileRow, teamValue as Record<string, unknown> | null),
      buildProjectAssignmentSummaries(admin, user.id),
      buildPermissionSummary(admin, user.id),
      getCurrentFleetAssignmentSummary(admin, user.id),
    ]);
    const response: ProfileOverviewPayload = {
      prd_epic_id: PROFILE_HUB_PRD_EPIC_ID,
      profile: typedProfile as ProfileOverviewPayload['profile'],
      can_edit_basic_fields: canEditOwnBasicProfileFields(
        typedProfile as Parameters<typeof canEditOwnBasicProfileFields>[0]
      ),
      managers,
      timesheets: (timesheets || []) as ProfileOverviewPayload['timesheets'],
      inspections: mergedInspections,
      absences: ((absences || []) as Array<Record<string, unknown>>).map((absence) => ({
        id: String(absence.id),
        date: String(absence.date),
        end_date: (absence.end_date as string | null) || null,
        status: absence.status as ProfileOverviewPayload['absences'][number]['status'],
        reason_name: String(
          (
            Array.isArray(absence.reason)
              ? (absence.reason[0] as { name?: string } | undefined)
              : (absence.reason as { name?: string } | null)
          )?.name || 'Unknown'
        ),
      })),
      annual_leave_summary: {
        allowance,
        approved_taken: approvedTaken,
        pending_total: pendingTotal,
        remaining: allowance - approvedTaken - pendingTotal,
      },
      project_assignments: projectAssignments,
      current_fleet_assignment: currentFleetAssignment,
      permission_summary: permissionSummary,
      help_shortcuts: {
        has_unresolved_suggestions: (unresolvedSuggestionsCount || 0) > 0,
        has_unresolved_error_reports: (unresolvedErrorReportsCount || 0) > 0,
      },
      quick_links: {
        recent: buildRecentQuickLinks((visits || []) as Array<{ path: string; visited_at: string }>, 5),
        frequent: buildFrequentQuickLinks((visits || []) as Array<{ path: string; visited_at: string }>, 5),
      },
    };

    return NextResponse.json({ success: true, ...response });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load profile overview' },
      { status: 500 }
    );
  }
}

