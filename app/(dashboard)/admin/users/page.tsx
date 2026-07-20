'use client';

import { Fragment, useState, useEffect, useMemo, useCallback, useLayoutEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { createPortal } from 'react-dom';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageLoader } from '@/components/ui/page-loader';
import { PanelLoader } from '@/components/ui/panel-loader';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  dialogContentViewportClassName,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import {
  UserPlus,
  Search,
  Edit,
  Trash2,
  Shield,
  User,
  Users,
  Mail,
  Calendar,
  Loader2,
  AlertTriangle,
  KeyRound,
  Copy,
  CheckCircle2,
  Briefcase,
} from 'lucide-react';
import { useBrowserSupabaseClient } from '@/lib/hooks/useBrowserSupabaseClient';
import { fetchAdminTeamDirectory } from '@/lib/admin/team-directory-client';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import {
  SensitiveModuleGate,
  SensitiveModuleSessionManager,
  useSensitiveModuleAccess,
} from '@/components/security/SensitiveModuleGate';
import type { Database } from '@/types/database';
import type { WorkShiftPattern, WorkShiftTemplate } from '@/types/work-shifts';
import { WORK_SHIFT_DAY_LABELS, WORK_SHIFT_DAY_ORDER } from '@/types/work-shifts';
import { getRoleSortPriority } from '@/lib/config/roles-core';
import { calculateNewUserRemainingLeaveDefault, roundToNearestHalfDay } from '@/lib/utils/absence-onboarding';
import { isClientSessionPausedError } from '@/lib/app-auth/session-error';
import { formatDateTime } from '@/lib/utils/date';
import { filterHiddenSystemTestAccounts } from '@/lib/utils/system-test-accounts';
import {
  computeQuickEditFloatingPosition,
  type FloatingPositionResult,
} from '@/lib/ui/quick-edit-floating-position';

const RoleManagement = dynamic(() => import('@/components/admin/RoleManagement').then(m => ({ default: m.RoleManagement })), {
  ssr: false,
  loading: () => <PanelLoader message="Loading role management..." className="py-12" />
});

const JobRolesTab = dynamic(() => import('@/components/admin/JobRolesTab').then(m => ({ default: m.JobRolesTab })), {
  ssr: false,
  loading: () => <PanelLoader message="Loading job roles..." className="py-12" />
});

const TeamsTab = dynamic(() => import('@/components/admin/TeamsTab').then(m => ({ default: m.TeamsTab })), {
  ssr: false,
  loading: () => <PanelLoader message="Loading teams..." className="py-12" />
});

type Profile = Database['public']['Tables']['profiles']['Row'];
type ProfileWithRole = Omit<Profile, 'role'> & {
  role?: {
    name: string;
    display_name: string;
    role_class?: 'admin' | 'manager' | 'employee';
    is_super_admin?: boolean;
    is_manager_admin?: boolean;
  } | null;
  role_id?: string | null;
  line_manager_id?: string | null;
  secondary_manager_id?: string | null;
  team_id?: string | null;
  is_placeholder?: boolean | null;
};
interface UserActivitySummary {
  email?: string;
  last_sign_in_at?: string | null;
  last_active_at?: string | null;
}
interface AdminFleetAssignmentSummary {
  asset_type: 'van' | 'hgv' | 'plant';
  asset_label: string | null;
  asset_nickname: string | null;
}
type ProfileWithEmail = ProfileWithRole & UserActivitySummary & {
  current_fleet_assignment?: AdminFleetAssignmentSummary | null;
};

type TabType = 'users' | 'roles' | 'teams' | 'permissions';
type UserStatusTab = 'active' | 'deleted';
type BinaryChoice = 'yes' | 'no' | '';

interface AddUserFormData {
  email: string;
  full_name: string;
  phone_number: string;
  employee_id: string;
  role_id: string;
  line_manager_id: string;
  team_id: string;
  work_shift_template_id: string;
  annual_allowance_days: string;
  remaining_leave_days: string;
  auto_book_bank_holidays: BinaryChoice;
  auto_apply_bulk_bookings: BinaryChoice;
  selected_bulk_batch_ids: string[];
}

interface BulkAbsenceBatchOption {
  id: string;
  reasonName: string;
  startDate: string;
  endDate: string;
  notes: string | null;
}

interface OnboardingContextPayload {
  success: boolean;
  financialYear: {
    startYear: number;
    label: string;
    startDate: string;
    endDate: string;
  };
  bankHolidays: {
    totalCount: number;
    passedCount: number;
    remainingCount: number;
    today: string;
  };
  workShiftTemplates: WorkShiftTemplate[];
  bulkAbsenceBatches: Array<{
    id: string;
    reasonName: string;
    startDate: string;
    endDate: string;
    notes: string | null;
  }>;
}

interface QuickEditTarget {
  userId: string;
  field: 'role' | 'team';
  triggerElement: HTMLElement;
}

function summarizeWorkShiftPattern(pattern: WorkShiftPattern): string {
  const segments: string[] = [];
  let activeLabel = '';
  let rangeStart = 0;

  function getDayStatusLabel(dayKey: (typeof WORK_SHIFT_DAY_ORDER)[number]): string {
    const am = pattern[`${dayKey}_am`];
    const pm = pattern[`${dayKey}_pm`];
    if (am && pm) return 'AM+PM';
    if (am) return 'AM';
    if (pm) return 'PM';
    return 'Off';
  }

  function pushSegment(startIndex: number, endIndex: number, label: string) {
    const startLabel = WORK_SHIFT_DAY_LABELS[WORK_SHIFT_DAY_ORDER[startIndex]];
    const endLabel = WORK_SHIFT_DAY_LABELS[WORK_SHIFT_DAY_ORDER[endIndex]];
    const dayLabel = startIndex === endIndex ? startLabel : `${startLabel}-${endLabel}`;
    segments.push(`${dayLabel} ${label}`);
  }

  WORK_SHIFT_DAY_ORDER.forEach((dayKey, index) => {
    const statusLabel = getDayStatusLabel(dayKey);
    if (index === 0) {
      activeLabel = statusLabel;
      rangeStart = 0;
      return;
    }
    if (statusLabel !== activeLabel) {
      pushSegment(rangeStart, index - 1, activeLabel);
      rangeStart = index;
      activeLabel = statusLabel;
    }
  });

  pushSegment(rangeStart, WORK_SHIFT_DAY_ORDER.length - 1, activeLabel);
  return segments.join(', ');
}

function createInitialFormData(): AddUserFormData {
  return {
    email: '',
    full_name: '',
    phone_number: '',
    employee_id: '',
    role_id: '',
    line_manager_id: '',
    team_id: '',
    work_shift_template_id: '',
    annual_allowance_days: '28',
    remaining_leave_days: '',
    auto_book_bank_holidays: '',
    auto_apply_bulk_bookings: '',
    selected_bulk_batch_ids: [],
  };
}

function normalizeHalfDayString(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (!trimmed) return '';
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return rawValue;
  return String(roundToNearestHalfDay(parsed));
}

function isDeletedUserProfile(user: { full_name?: string | null }): boolean {
  return Boolean(user.full_name?.includes('(Deleted User)'));
}

function formatAdminFleetAssignment(assignment: AdminFleetAssignmentSummary | null | undefined): string {
  if (!assignment) return '-';
  const assetLabel = [assignment.asset_label, assignment.asset_nickname].filter(Boolean).join(' - ');
  return `${assignment.asset_type.toUpperCase()} ${assetLabel || 'Fleet asset'}`;
}

function UserTableAvatar({ user }: { user: ProfileWithEmail }) {
  const displayName = user.full_name || user.email || 'User';

  return (
    <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
      <div className="absolute inset-0 flex items-center justify-center">
        <User className="h-4 w-4 text-slate-600 dark:text-muted-foreground" />
      </div>
      {user.avatar_url ? (
        <Image
          src={user.avatar_url}
          alt={`${displayName} avatar`}
          fill
          sizes="32px"
          className="object-cover"
          loading="lazy"
        />
      ) : null}
    </div>
  );
}

function isExpectedUserAdminError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes('Forbidden:');
}

function formatAdminActivityTimestamp(value?: string | null): string {
  if (!value) return 'Never';

  const absolute = formatDateTime(value);
  return absolute || 'Unknown';
}

function matchesNamedRole(
  role: { name?: string | null; display_name?: string | null } | null | undefined,
  expectedName: string
): boolean {
  const normalized = expectedName.trim().toLowerCase();
  const roleName = role?.name?.trim().toLowerCase();
  const roleDisplayName = role?.display_name?.trim().toLowerCase();
  return roleName === normalized || roleDisplayName === normalized;
}

function isSupervisorRole(role?: { name?: string | null; display_name?: string | null } | null): boolean {
  return matchesNamedRole(role, 'supervisor');
}

function isContractorRole(role?: { name?: string | null; display_name?: string | null } | null): boolean {
  return matchesNamedRole(role, 'contractor');
}

function isSuperAdminUser(user: ProfileWithEmail): boolean {
  return user.super_admin === true || user.role?.is_super_admin === true;
}

export default function UsersAdminPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user: currentUser, profile, isAdmin, isSuperAdmin, isActualSuperAdmin, loading: authLoading } = useAuth();
  const { hasPermission: canManageUsers, loading: permissionLoading } = usePermissionCheck('admin-users', false);
  const sensitiveAccess = useSensitiveModuleAccess('admin-users', { enabled: canManageUsers });
  const supabase = useBrowserSupabaseClient();
  const [activeTab, setActiveTab] = useState<TabType>('users');
  const isAdminActor = isAdmin || isSuperAdmin || isActualSuperAdmin;
  const isManagerActor = !isAdminActor && profile?.role?.is_manager_admin === true;
  const canManageRoleDefinitions = isAdminActor || isManagerActor;
  const canEditRolePermissions = isAdminActor;
  const canQuickEditAssignments = isAdminActor;
  const canAccessUserAdmin = canManageUsers && sensitiveAccess.canAccess;

  // State
  const [users, setUsers] = useState<ProfileWithEmail[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<ProfileWithEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'manager' | 'supervisor' | 'employee' | 'contractor'>('all');
  const [teamFilter, setTeamFilter] = useState<string>('all');
  const [managerFilter, setManagerFilter] = useState<string>('all');
  const [userStatusTab, setUserStatusTab] = useState<UserStatusTab>('active');
  const [availableRoles, setAvailableRoles] = useState<Array<{ id: string; name: string; display_name: string; role_class: 'admin' | 'manager' | 'employee' }>>([]);
  const [teamDirectory, setTeamDirectory] = useState<Array<{
    id: string;
    name: string;
    active: boolean;
    manager_1_id?: string | null;
    manager_2_id?: string | null;
    manager_1_name?: string | null;
    manager_2_name?: string | null;
  }>>([]);

  useEffect(() => {
    if (authLoading || permissionLoading || !currentUser || !profile) {
      return;
    }

    const requestedTab = (searchParams.get('tab') || 'users') as TabType;
    const validTabs: TabType[] = [
      'users',
      ...(canManageRoleDefinitions ? (['roles', 'teams'] as const) : []),
      ...(canEditRolePermissions ? (['permissions'] as const) : []),
    ];
    if (validTabs.includes(requestedTab)) {
      setActiveTab(requestedTab);
      return;
    }
    setActiveTab('users');
    router.replace('/admin/users?tab=users', { scroll: false });
  }, [
    authLoading,
    permissionLoading,
    currentUser,
    profile,
    canEditRolePermissions,
    canManageRoleDefinitions,
    searchParams,
    router,
  ]);

  function handleTabChange(nextTab: TabType) {
    setActiveTab(nextTab);
    router.replace(`/admin/users?tab=${nextTab}`, { scroll: false });
  }

  // Dialog states
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteOptionsDialogOpen, setDeleteOptionsDialogOpen] = useState(false);
  const [deletionMode, setDeletionMode] = useState<'keep-data' | 'delete-all'>('keep-data');
  const [resetPasswordDialogOpen, setResetPasswordDialogOpen] = useState(false);
  const [resetSensitivePinDialogOpen, setResetSensitivePinDialogOpen] = useState(false);
  const [passwordDisplayDialogOpen, setPasswordDisplayDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<ProfileWithEmail | null>(null);

  // Password display states
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [passwordCopied, setPasswordCopied] = useState(false);
  const [isNewUser, setIsNewUser] = useState(false);

  // Form states
  const [formData, setFormData] = useState<AddUserFormData>(createInitialFormData);
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [workShiftTemplates, setWorkShiftTemplates] = useState<WorkShiftTemplate[]>([]);
  const [bulkAbsenceOptions, setBulkAbsenceOptions] = useState<BulkAbsenceBatchOption[]>([]);
  const [onboardingFinancialYearLabel, setOnboardingFinancialYearLabel] = useState('');
  const [onboardingContextLoading, setOnboardingContextLoading] = useState(false);
  const [quickEditTarget, setQuickEditTarget] = useState<QuickEditTarget | null>(null);
  const [quickEditValue, setQuickEditValue] = useState('');
  const [quickEditSaving, setQuickEditSaving] = useState(false);
  const [quickEditPosition, setQuickEditPosition] = useState<FloatingPositionResult | null>(null);
  const [quickEditPanelReady, setQuickEditPanelReady] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const quickEditPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const activeUsers = useMemo(
    () => users.filter((user) => !isDeletedUserProfile(user)),
    [users]
  );
  const deletedUsers = useMemo(
    () => users.filter((user) => isDeletedUserProfile(user)),
    [users]
  );
  const usersForCurrentStatus = useMemo(
    () => (userStatusTab === 'deleted' ? deletedUsers : activeUsers),
    [activeUsers, deletedUsers, userStatusTab]
  );

  // Stats
  const stats = {
    total: usersForCurrentStatus.length,
    admins: usersForCurrentStatus.filter((u) => u.role?.role_class === 'admin' || u.role?.name === 'admin').length,
    managers: usersForCurrentStatus.filter((u) => u.role?.role_class === 'manager').length,
    supervisors: usersForCurrentStatus.filter((u) => isSupervisorRole(u.role)).length,
    employees: usersForCurrentStatus.filter(
      (u) => u.role?.role_class === 'employee' && !isSupervisorRole(u.role) && !isContractorRole(u.role)
    ).length,
    contractors: usersForCurrentStatus.filter((u) => isContractorRole(u.role)).length,
  };

  const managerNameById = useMemo(() => {
    const map = new Map<string, string>();
    users.forEach((u) => {
      map.set(u.id, u.full_name || u.email || 'Unknown');
    });
    return map;
  }, [users]);

  const getDisplayedManager = useMemo(() => {
    return (managerId: string | null | undefined) => {
      if (!managerId) return 'No Manager';
      return managerNameById.get(managerId) || managerId;
    };
  }, [managerNameById]);

  const getDisplayedManagers = useMemo(() => {
    return (primaryManagerId: string | null | undefined, secondaryManagerId: string | null | undefined) => {
      const managers = [primaryManagerId, secondaryManagerId]
        .map((managerId) => getDisplayedManager(managerId))
        .filter((managerName) => managerName !== 'No Manager');

      return managers.join(', ');
    };
  }, [getDisplayedManager]);

  const getUserRolePriority = useMemo(() => {
    return (user: ProfileWithEmail) => {
      if (isSuperAdminUser(user)) {
        return getRoleSortPriority('admin');
      }

      return getRoleSortPriority(user.role?.name || user.role?.role_class || '');
    };
  }, []);

  const teamOptions = useMemo(() => {
    if (teamDirectory.length > 0) {
      return teamDirectory
        .filter((team) => team.active)
        .map((team) => ({ id: team.id, name: team.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    const teams = new Set<string>();
    users.forEach((u) => {
      if (u.team_id) teams.add(u.team_id);
    });
    return Array.from(teams).sort().map((id) => ({ id, name: id }));
  }, [teamDirectory, users]);

  const teamNameById = useMemo(() => {
    const map = new Map<string, string>();
    teamOptions.forEach((team) => map.set(team.id, team.name));
    return map;
  }, [teamOptions]);

  const teamDetailsById = useMemo(() => {
    const map = new Map<string, {
      id: string;
      name: string;
      active: boolean;
      manager_1_id?: string | null;
      manager_2_id?: string | null;
      manager_1_name?: string | null;
      manager_2_name?: string | null;
    }>();
    teamDirectory.forEach((team) => map.set(team.id, team));
    return map;
  }, [teamDirectory]);

  const managerOptions = useMemo(
    () => activeUsers.filter((u) => u.role?.role_class === 'manager' || u.role?.role_class === 'admin'),
    [activeUsers]
  );

  const getRoleOptionsForUser = useMemo(() => {
    return (_user: ProfileWithEmail) => {
      return availableRoles;
    };
  }, [availableRoles]);

  const selectedAddTeamManagers = useMemo(() => {
    return formData.team_id ? teamDetailsById.get(formData.team_id) || null : null;
  }, [formData.team_id, teamDetailsById]);
  const selectedAddTeamHasManager = Boolean(
    selectedAddTeamManagers?.manager_1_id || selectedAddTeamManagers?.manager_2_id
  );
  const selectedWorkShiftTemplate = useMemo(
    () => workShiftTemplates.find((template) => template.id === formData.work_shift_template_id) || null,
    [workShiftTemplates, formData.work_shift_template_id]
  );

  const getDefaultRemainingLeaveDays = useCallback((totalAllowanceRaw: string): string => {
    const parsedAllowance = Number(totalAllowanceRaw);
    if (!Number.isFinite(parsedAllowance)) return '';
    const result = calculateNewUserRemainingLeaveDefault({
      annualAllowanceDays: parsedAllowance,
    });
    return String(result.defaultRemainingLeaveDays);
  }, []);

  // Helper function to fetch users with emails
  async function fetchUsersWithEmails() {
    if (!supabase) {
      return [] as ProfileWithEmail[];
    }

    // Fetch profiles from database with role information
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select(`
        id,
        full_name,
        avatar_url,
        phone_number,
        employee_id,
        created_at,
        role_id,
        line_manager_id,
        secondary_manager_id,
        team_id,
        is_placeholder,
        role:roles(
          name,
          display_name,
          role_class,
          is_super_admin,
          is_manager_admin
        )
      `)
      .order('full_name', { ascending: true });

    if (profilesError) throw profilesError;
    const profileRows = (profiles as unknown as ProfileWithRole[]) || [];

    const profileIds = profileRows.map((profile) => profile.id);
    const { data: assignmentRows, error: assignmentError } = profileIds.length > 0
      ? await supabase
        .from('profile_fleet_assignments')
        .select(`
          user_id,
          linked_van_id,
          linked_hgv_id,
          linked_plant_id,
          van:vans!profile_fleet_assignments_linked_van_id_fkey(reg_number, nickname),
          hgv:hgvs!profile_fleet_assignments_linked_hgv_id_fkey(reg_number, nickname),
          plant:plant!profile_fleet_assignments_linked_plant_id_fkey(plant_id, reg_number, nickname)
        `)
        .in('user_id', profileIds)
        .is('ended_at', null)
      : { data: [], error: null };

    if (assignmentError) throw assignmentError;

    const assignmentByUserId = new Map<string, AdminFleetAssignmentSummary>();
    ((assignmentRows || []) as Array<{
      user_id: string;
      linked_van_id: string | null;
      linked_hgv_id: string | null;
      linked_plant_id: string | null;
      van?: { reg_number: string | null; nickname: string | null } | { reg_number: string | null; nickname: string | null }[] | null;
      hgv?: { reg_number: string | null; nickname: string | null } | { reg_number: string | null; nickname: string | null }[] | null;
      plant?: { plant_id: string | null; reg_number: string | null; nickname: string | null } | { plant_id: string | null; reg_number: string | null; nickname: string | null }[] | null;
    }>).forEach((assignment) => {
      const van = Array.isArray(assignment.van) ? assignment.van[0] : assignment.van;
      const hgv = Array.isArray(assignment.hgv) ? assignment.hgv[0] : assignment.hgv;
      const plant = Array.isArray(assignment.plant) ? assignment.plant[0] : assignment.plant;
      if (assignment.linked_van_id) {
        assignmentByUserId.set(assignment.user_id, {
          asset_type: 'van',
          asset_label: van?.reg_number || null,
          asset_nickname: van?.nickname || null,
        });
        return;
      }
      if (assignment.linked_hgv_id) {
        assignmentByUserId.set(assignment.user_id, {
          asset_type: 'hgv',
          asset_label: hgv?.reg_number || null,
          asset_nickname: hgv?.nickname || null,
        });
        return;
      }
      if (assignment.linked_plant_id) {
        assignmentByUserId.set(assignment.user_id, {
          asset_type: 'plant',
          asset_label: plant?.reg_number || plant?.plant_id || null,
          asset_nickname: plant?.nickname || null,
        });
      }
    });

    // Fetch auth users to get emails (via API route)
    const response = await fetch('/api/admin/users/list-with-emails');
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || 'Failed to load auth users');
    }
    const { users: authUsers } = await response.json();

    // Create a map of auth details by user id.
    const authUserMap = new Map<string, UserActivitySummary & { id: string }>(
      authUsers?.map((u: UserActivitySummary & { id: string }) => [u.id, u]) || []
    );

    // Merge profiles with emails
    return filterHiddenSystemTestAccounts(profileRows.map(profile => ({
      ...profile,
      email: authUserMap.get(profile.id)?.email || '',
      last_sign_in_at: authUserMap.get(profile.id)?.last_sign_in_at || null,
      last_active_at: authUserMap.get(profile.id)?.last_active_at || null,
      current_fleet_assignment: assignmentByUserId.get(profile.id) || null,
    })) || [] as ProfileWithEmail[]);
  }

  // Fetch available roles
  useEffect(function () {
    if (!supabase) {
      return;
    }

    async function fetchRoles() {
      try {
        const { data, error } = await supabase
          .from('roles')
          .select('id, name, display_name, role_class, is_super_admin')
          .order('is_super_admin', { ascending: false })
          .order('is_manager_admin', { ascending: false })
          .order('display_name');

        if (error) throw error;

        const nonSuperAdminRoles = (data || []).filter(
          (role: { is_super_admin: boolean | null }) => role.is_super_admin !== true
        );
        const filteredRoles = isManagerActor
          ? nonSuperAdminRoles.filter((role: { role_class: string }) => role.role_class === 'employee')
          : nonSuperAdminRoles;

        const rolesForAssignment = filteredRoles
          .sort((a: { name: string; display_name: string }, b: { name: string; display_name: string }) => {
            const byPriority = getRoleSortPriority(a.name) - getRoleSortPriority(b.name);
            if (byPriority !== 0) return byPriority;
            return a.display_name.localeCompare(b.display_name);
          });

        setAvailableRoles(rolesForAssignment);
      } catch (error) {
        if (!isClientSessionPausedError(error)) {
          console.error('Error fetching roles:', error);
        }
      }
    }

    if (canAccessUserAdmin) {
      fetchRoles();
    }
  }, [canAccessUserAdmin, isManagerActor, supabase]);

  // Fetch users
  useEffect(function () {
    if (!supabase) {
      return;
    }

    async function fetchUsers() {
      try {
        setLoading(true);
        const usersWithEmails = await fetchUsersWithEmails();
        setUsers(usersWithEmails);
        setFilteredUsers(usersWithEmails);
      } catch (error) {
        console.error('Error fetching users:', error);
      } finally {
        setLoading(false);
      }
    }

    if (canAccessUserAdmin) {
      fetchUsers();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccessUserAdmin]);

  useEffect(() => {
    if (!addDialogOpen) return;
    setFormData((prev) => {
      if (prev.remaining_leave_days) return prev;
      const nextRemaining = getDefaultRemainingLeaveDays(prev.annual_allowance_days);
      if (nextRemaining === prev.remaining_leave_days) return prev;
      return { ...prev, remaining_leave_days: nextRemaining };
    });
  }, [addDialogOpen, getDefaultRemainingLeaveDays]);

  useEffect(function () {
    async function fetchOnboardingContext() {
      try {
        setOnboardingContextLoading(true);
        const response = await fetch('/api/admin/users/onboarding-context', { cache: 'no-store' });
        const payload = (await response.json()) as OnboardingContextPayload & { error?: string };
        if (!response.ok) {
          throw new Error(payload.error || 'Failed to load onboarding context');
        }
        setWorkShiftTemplates(payload.workShiftTemplates || []);
        setBulkAbsenceOptions((payload.bulkAbsenceBatches || []).map((batch) => ({
          id: batch.id,
          reasonName: batch.reasonName,
          startDate: batch.startDate,
          endDate: batch.endDate,
          notes: batch.notes || null,
        })));
        setOnboardingFinancialYearLabel(payload.financialYear?.label || '');
      } catch (error) {
        console.error('Error fetching onboarding context:', error);
      } finally {
        setOnboardingContextLoading(false);
      }
    }

    if (canAccessUserAdmin) {
      fetchOnboardingContext();
    }
  }, [canAccessUserAdmin]);

  // Fetch team metadata used by the Org V2 admin UI
  useEffect(function () {
    async function fetchHierarchyMetadata() {
      try {
        const teamsData = await fetchAdminTeamDirectory();
        if (Array.isArray(teamsData?.teams)) {
          const mapped = teamsData.teams
            .filter((team: { id?: string; team_id?: string }) => Boolean(team?.id || team?.team_id))
            .map((team: { id?: string; team_id?: string; name?: string; active?: boolean }) => {
              const teamId = team.id || team.team_id || '';
              return {
                id: teamId,
                name: team.name || teamId,
                active: team.active !== false,
                manager_1_id: (team as { manager_1_id?: string | null }).manager_1_id || null,
                manager_2_id: (team as { manager_2_id?: string | null }).manager_2_id || null,
                manager_1_name: (team as { manager_1_name?: string | null }).manager_1_name || null,
                manager_2_name: (team as { manager_2_name?: string | null }).manager_2_name || null,
              };
            });
          setTeamDirectory(mapped);
        }
      } catch (error) {
        console.error('Error fetching hierarchy metadata:', error);
      }
    }

    if (canAccessUserAdmin) {
      fetchHierarchyMetadata();
    }
  }, [canAccessUserAdmin]);

  // Search and role filter
  useEffect(function () {
    let filtered = usersForCurrentStatus;

    // Apply role filter
    if (roleFilter !== 'all') {
      filtered = filtered.filter((user) => {
        if (roleFilter === 'admin') return user.role?.role_class === 'admin' || user.role?.name === 'admin';
        if (roleFilter === 'manager') return user.role?.role_class === 'manager';
        if (roleFilter === 'supervisor') return isSupervisorRole(user.role);
        if (roleFilter === 'contractor') return isContractorRole(user.role);
        if (roleFilter === 'employee') {
          return user.role?.role_class === 'employee' && !isSupervisorRole(user.role) && !isContractorRole(user.role);
        }
        return true;
      });
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((user) =>
        user.full_name?.toLowerCase().includes(query) ||
        user.email?.toLowerCase().includes(query) ||
        user.employee_id?.toLowerCase().includes(query)
      );
    }

    if (teamFilter !== 'all') {
      filtered = filtered.filter((user) => (user.team_id || 'unassigned') === teamFilter);
    }

    if (managerFilter !== 'all') {
      filtered = filtered.filter(
        (user) =>
          (managerFilter === 'none' && !user.line_manager_id && !user.secondary_manager_id) ||
          user.line_manager_id === managerFilter ||
          user.secondary_manager_id === managerFilter
      );
    }

    const sorted = [...filtered].sort((a, b) => {
      const teamA = a.team_id ? (teamNameById.get(a.team_id) || a.team_id) : 'ZZZ Unassigned';
      const teamB = b.team_id ? (teamNameById.get(b.team_id) || b.team_id) : 'ZZZ Unassigned';
      const byTeam = teamA.localeCompare(teamB);
      if (byTeam !== 0) return byTeam;

      const byRole = getUserRolePriority(a) - getUserRolePriority(b);
      if (byRole !== 0) return byRole;

      return (a.full_name || a.email || '').localeCompare(b.full_name || b.email || '');
    });

    setFilteredUsers(sorted);
  }, [searchQuery, roleFilter, teamFilter, managerFilter, usersForCurrentStatus, teamNameById, getUserRolePriority]);

  const quickEditUser = useMemo(
    () => (quickEditTarget ? users.find((user) => user.id === quickEditTarget.userId) || null : null),
    [quickEditTarget, users]
  );

  const closeQuickEdit = useCallback(() => {
    setQuickEditTarget(null);
    setQuickEditValue('');
    setQuickEditPosition(null);
    setQuickEditPanelReady(false);
  }, []);

  const updateQuickEditPosition = useCallback(() => {
    if (!quickEditTarget || !quickEditPanelRef.current) return;
    if (!document.body.contains(quickEditTarget.triggerElement)) {
      closeQuickEdit();
      return;
    }

    const triggerRect = quickEditTarget.triggerElement.getBoundingClientRect();
    const panelRect = quickEditPanelRef.current.getBoundingClientRect();
    const nextPosition = computeQuickEditFloatingPosition({
      triggerRect: {
        top: triggerRect.top,
        left: triggerRect.left,
        right: triggerRect.right,
        bottom: triggerRect.bottom,
        width: triggerRect.width,
        height: triggerRect.height,
      },
      panelSize: {
        width: panelRect.width,
        height: panelRect.height,
      },
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        // Fixed-position panel is viewport-based; scroll values are still measured for completeness.
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      },
    });

    setQuickEditPosition(nextPosition);
    setQuickEditPanelReady(true);
  }, [closeQuickEdit, quickEditTarget]);

  useLayoutEffect(() => {
    if (!quickEditTarget || !quickEditUser) return;
    setQuickEditPanelReady(false);
    updateQuickEditPosition();
  }, [quickEditTarget, quickEditUser, updateQuickEditPosition]);

  useEffect(() => {
    if (!quickEditTarget) return;

    const handleViewportChange = () => {
      updateQuickEditPosition();
    };

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [quickEditTarget, updateQuickEditPosition]);

  useEffect(() => {
    if (!quickEditTarget || !quickEditPanelRef.current || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      updateQuickEditPosition();
    });
    observer.observe(quickEditPanelRef.current);

    return () => {
      observer.disconnect();
    };
  }, [quickEditTarget, updateQuickEditPosition]);

  useEffect(() => {
    if (!quickEditTarget) return;

    const handlePointerDown = (event: PointerEvent) => {
      const targetNode = event.target as Node | null;
      if (!targetNode) return;
      if (targetNode instanceof Element && targetNode.closest('.quick-edit-select-content')) return;

      if (quickEditPanelRef.current?.contains(targetNode)) return;
      if (quickEditTarget.triggerElement.contains(targetNode)) return;
      closeQuickEdit();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeQuickEdit();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeQuickEdit, quickEditTarget]);

  function openQuickEdit(user: ProfileWithEmail, field: 'role' | 'team', triggerElement: HTMLElement) {
    setQuickEditPosition(null);
    setQuickEditPanelReady(false);
    setQuickEditTarget({ userId: user.id, field, triggerElement });
    setQuickEditValue(field === 'role' ? (user.role_id || '') : (user.team_id || ''));
    setFormError('');
  }

  async function handleQuickEditSave(user: ProfileWithEmail) {
    if (!quickEditTarget) return;

    const nextRoleId = quickEditTarget.field === 'role' ? quickEditValue || null : (user.role_id || null);
    const nextTeamId = quickEditTarget.field === 'team' ? quickEditValue || null : (user.team_id || null);

    try {
      setQuickEditSaving(true);
      setFormError('');

      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: user.email,
          full_name: user.full_name,
          phone_number: user.phone_number,
          employee_id: user.employee_id,
          role_id: nextRoleId,
          line_manager_id: user.line_manager_id || null,
          team_id: nextTeamId,
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to update user');
      }

      const usersWithEmails = await fetchUsersWithEmails();
      setUsers(usersWithEmails);
      setFilteredUsers(usersWithEmails);
      closeQuickEdit();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Failed to update user');
    } finally {
      setQuickEditSaving(false);
    }
  }

  // Handle add user
  async function handleAddUser() {
    if (!formData.email || !formData.full_name) {
      setFormError('Please fill in all required fields');
      return;
    }

    if (!formData.role_id) {
      setFormError('Please select a role');
      return;
    }

    if (!formData.team_id) {
      setFormError('Please select a team');
      return;
    }

    if (!selectedAddTeamHasManager) {
      setFormError('Selected team has no configured manager. Set Manager 1 or Manager 2 before creating the user.');
      return;
    }

    if (!formData.work_shift_template_id) {
      setFormError('Please select a work shift template');
      return;
    }

    const annualAllowance = Number(formData.annual_allowance_days);
    const remainingLeaveRaw = Number(formData.remaining_leave_days);
    const remainingLeave = Number.isFinite(remainingLeaveRaw)
      ? roundToNearestHalfDay(remainingLeaveRaw)
      : remainingLeaveRaw;
    if (!Number.isFinite(annualAllowance)) {
      setFormError('Please enter a valid total annual leave allowance');
      return;
    }
    if (!Number.isFinite(remainingLeave)) {
      setFormError('Please enter a valid remaining annual leave value');
      return;
    }

    if (formData.auto_book_bank_holidays === '') {
      setFormError('Please choose whether to auto-book remaining bank holidays');
      return;
    }

    if (formData.auto_apply_bulk_bookings === '') {
      setFormError('Please choose whether to auto-apply bulk absence bookings');
      return;
    }

    if (formData.auto_apply_bulk_bookings === 'yes' && formData.selected_bulk_batch_ids.length === 0) {
      setFormError('Please select at least one bulk absence booking to auto-apply');
      return;
    }

    try {
      setFormLoading(true);
      setFormError('');

      // Create user via API route
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email,
          full_name: formData.full_name,
          phone_number: formData.phone_number,
          employee_id: formData.employee_id,
          role_id: formData.role_id,
          line_manager_id: formData.line_manager_id || null,
          team_id: formData.team_id,
          work_shift_template_id: formData.work_shift_template_id,
          annual_allowance_days: annualAllowance,
          remaining_leave_days: remainingLeave,
          auto_book_bank_holidays: formData.auto_book_bank_holidays === 'yes',
          auto_apply_bulk_bookings: formData.auto_apply_bulk_bookings === 'yes',
          selected_bulk_batch_ids:
            formData.auto_apply_bulk_bookings === 'yes' ? formData.selected_bulk_batch_ids : [],
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create user');
      }

      // Refresh users list
      const usersWithEmails = await fetchUsersWithEmails();
      setUsers(usersWithEmails);
      setFilteredUsers(usersWithEmails);

      // Show password to admin
      setTemporaryPassword(result.temporaryPassword);
      setEmailSent(result.emailSent);
      setIsNewUser(true);
      setPasswordCopied(false);
      setPasswordDisplayDialogOpen(true);

      // Reset form and close dialog
      setFormData(createInitialFormData());
      setAddDialogOpen(false);
    } catch (error) {
      console.error('Error creating user:', error);
      setFormError(error instanceof Error ? error.message : 'Failed to create user');
    } finally {
      setFormLoading(false);
    }
  }

  // Handle edit user
  async function handleEditUser() {
    if (!selectedUser || !formData.full_name || !formData.email) {
      setFormError('Please fill in all required fields');
      return;
    }

    try {
      setFormLoading(true);
      setFormError('');

      // Update via API route (handles both auth and profile)
      const response = await fetch(`/api/admin/users/${selectedUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email,
          full_name: formData.full_name,
          phone_number: formData.phone_number,
          employee_id: formData.employee_id,
          role_id: formData.role_id,
          line_manager_id: formData.line_manager_id || null,
          team_id: formData.team_id || null,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to update user');
      }

      // Refresh users list
      const usersWithEmails = await fetchUsersWithEmails();
      setUsers(usersWithEmails);
      setFilteredUsers(usersWithEmails);

      setEditDialogOpen(false);
      setSelectedUser(null);
    } catch (error) {
      if (!isExpectedUserAdminError(error)) {
        console.error('Error updating user:', error);
      }
      setFormError(error instanceof Error ? error.message : 'Failed to update user');
    } finally {
      setFormLoading(false);
    }
  }

  // Handle delete user
  async function handleDeleteUser() {
    if (!selectedUser) return;

    try {
      setFormLoading(true);
      setFormError('');

      // Delete via API route with deletion mode parameter
      const response = await fetch(`/api/admin/users/${selectedUser.id}?mode=${deletionMode}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        let errorMessage = 'Failed to delete user';
        try {
          const result = await response.json();
          errorMessage = result.error || errorMessage;
        } catch {
          // If JSON parsing fails, use the response status text
          errorMessage = `Failed to delete user: ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      // Refresh users list
      const usersWithEmails = await fetchUsersWithEmails();
      setUsers(usersWithEmails);
      setFilteredUsers(usersWithEmails);

      setDeleteOptionsDialogOpen(false);
      setSelectedUser(null);
      setFormError(''); // Clear any previous errors
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete user';
      console.error('Error deleting user:', errorMessage, error);
      setFormError(errorMessage);
    } finally {
      setFormLoading(false);
    }
  }

  // Open edit dialog
  function openAddDialog() {
    const initialFormData = createInitialFormData();
    initialFormData.work_shift_template_id =
      workShiftTemplates.find((template) => template.is_default)?.id || '';
    initialFormData.remaining_leave_days = getDefaultRemainingLeaveDays(initialFormData.annual_allowance_days);
    setFormData(initialFormData);
    setFormError('');
    setAddDialogOpen(true);
  }

  function openEditDialog(userProfile: ProfileWithEmail) {
    setSelectedUser(userProfile);
    // Email comes from auth (merged into ProfileWithEmail), not from the profiles table
    const authEmail = userProfile.email || '';
    setFormData({
      email: authEmail,
      full_name: userProfile.full_name || '',
      phone_number: userProfile.phone_number || '',
      employee_id: userProfile.employee_id || '',
      role_id: userProfile.role_id || '',
      line_manager_id: userProfile.line_manager_id || '',
      team_id: userProfile.team_id || '',
      work_shift_template_id: '',
      annual_allowance_days: '28',
      remaining_leave_days: '',
      auto_book_bank_holidays: '',
      auto_apply_bulk_bookings: '',
      selected_bulk_batch_ids: [],
    });
    setFormError('');
    setEditDialogOpen(true);
  }

  // Open delete dialog
  function openDeleteDialog(userProfile: ProfileWithEmail) {
    setSelectedUser(userProfile);
    setFormError('');
    setDeleteOptionsDialogOpen(true);
  }

  // Open reset password dialog
  function openResetPasswordDialog(userProfile: ProfileWithEmail) {
    setSelectedUser(userProfile);
    setFormError('');
    setResetPasswordDialogOpen(true);
  }

  function openResetSensitivePinDialog(userProfile: ProfileWithEmail) {
    setSelectedUser(userProfile);
    setFormError('');
    setResetSensitivePinDialogOpen(true);
  }

  // Handle reset password
  async function handleResetPassword() {
    if (!selectedUser) return;

    try {
      setFormLoading(true);
      setFormError('');

      const response = await fetch(`/api/admin/users/${selectedUser.id}/reset-password`, {
        method: 'POST',
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to reset password');
      }

      // Show new password to admin
      setTemporaryPassword(result.temporaryPassword);
      setEmailSent(result.emailSent);
      setIsNewUser(false);
      setPasswordCopied(false);
      setPasswordDisplayDialogOpen(true);
      setResetPasswordDialogOpen(false);
      setSelectedUser(null);
    } catch (error) {
      console.error('Error resetting password:', error);
      setFormError('Failed to reset password');
    } finally {
      setFormLoading(false);
    }
  }

  async function handleResetSensitivePin() {
    if (!selectedUser) return;

    try {
      setFormLoading(true);
      setFormError('');

      const response = await fetch(`/api/admin/users/${selectedUser.id}/reset-sensitive-pin`, {
        method: 'POST',
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to reset sensitive PIN');
      }

      toast.success('Sensitive PIN reset. The user must set a new PIN from their profile.');
      setResetSensitivePinDialogOpen(false);
      setSelectedUser(null);
    } catch (error) {
      console.error('Error resetting sensitive PIN:', error);
      setFormError(error instanceof Error ? error.message : 'Failed to reset sensitive PIN');
    } finally {
      setFormLoading(false);
    }
  }

  // Copy password to clipboard
  async function copyPasswordToClipboard() {
    try {
      await navigator.clipboard.writeText(temporaryPassword);
      setPasswordCopied(true);
      setTimeout(() => setPasswordCopied(false), 3000);
    } catch (error) {
      console.error('Failed to copy password:', error);
    }
  }

  // Show loading while auth is being checked
  if (!supabase || authLoading || permissionLoading || sensitiveAccess.loading) {
    return <PageLoader message="Loading user admin..." />;
  }

  // Check authorization
  if (!canManageUsers) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Access Denied
            </CardTitle>
            <CardDescription>
              You do not have permission to access this page.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (!sensitiveAccess.canAccess) {
    return (
      <AppPageShell width="wide" className="2xl:max-w-[92rem]">
        <SensitiveModuleGate moduleLabel="User Management" access={sensitiveAccess} />
      </AppPageShell>
    );
  }

  return (
    <AppPageShell width="wide" className="2xl:max-w-[92rem]">
      <SensitiveModuleSessionManager moduleLabel="User Management" access={sensitiveAccess} />
      <AppPageHeader
        title="User Management"
        description="Manage users, roles, and permissions"
        className="bg-slate-900"
        contentClassName="sm:flex-row sm:items-center sm:justify-between"
        headingClassName="space-y-0"
        titleClassName="mb-2 text-white"
        descriptionClassName="text-base"
        actionsClassName="sm:w-auto"
        actions={activeTab === 'users' && userStatusTab === 'active' ? (
          <Button
            onClick={openAddDialog}
            className="w-full bg-brand-yellow hover:bg-brand-yellow-hover text-slate-900 sm:w-auto"
          >
            <UserPlus className="h-4 w-4 mr-2" />
            Add User
          </Button>
        ) : null}
      />

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => handleTabChange(v as TabType)} className="space-y-6">
        <TabsList className={`grid w-full ${
          canEditRolePermissions
              ? 'max-w-2xl grid-cols-2 sm:grid-cols-4'
              : canManageRoleDefinitions
                ? 'max-w-xl grid-cols-1 sm:grid-cols-3'
                : 'max-w-sm grid-cols-1'
        } bg-slate-100 dark:bg-slate-800 p-0`}>
          <TabsTrigger
            value="users"
            className="gap-2 data-[state=active]:bg-brand-yellow data-[state=active]:text-slate-900"
          >
            <User className="h-4 w-4" />
            Users
          </TabsTrigger>
          {canManageRoleDefinitions && (
            <TabsTrigger
              value="roles"
              className="gap-2 data-[state=active]:bg-brand-yellow data-[state=active]:text-slate-900"
            >
              <Briefcase className="h-4 w-4" />
              Roles
            </TabsTrigger>
          )}
          {canManageRoleDefinitions && (
            <TabsTrigger
              value="teams"
              className="gap-2 data-[state=active]:bg-brand-yellow data-[state=active]:text-slate-900"
            >
              <Briefcase className="h-4 w-4" />
              Teams
            </TabsTrigger>
          )}
          {canEditRolePermissions && (
            <TabsTrigger
              value="permissions"
              className="gap-2 data-[state=active]:bg-brand-yellow data-[state=active]:text-slate-900"
            >
              <Shield className="h-4 w-4" />
              Permissions
            </TabsTrigger>
          )}
        </TabsList>

        {/* Users Tab Content */}
        <TabsContent value="users" className="space-y-6">
          {/* Secondary tabs */}
          <div className="flex justify-end">
            <Tabs value={userStatusTab} onValueChange={(value) => setUserStatusTab(value as UserStatusTab)}>
              <TabsList>
                <TabsTrigger value="active" className="gap-2">
                  Active Users ({activeUsers.length})
                </TabsTrigger>
                <TabsTrigger value="deleted" className="gap-2">
                  Deleted Users ({deletedUsers.length})
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {userStatusTab === 'deleted' && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
              Deleted users are hidden from operational pickers by default so they can no longer be selected in modules like absence.
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <Card
          className={`border-border cursor-pointer hover:shadow-lg transition-all ${
            roleFilter === 'all' ? 'border-2 border-yellow-500' : ''
          }`}
          onClick={() => setRoleFilter('all')}
        >
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{userStatusTab === 'deleted' ? 'Deleted Users' : 'All Users'}</p>
                <p className="text-2xl font-bold text-white">{stats.total}</p>
              </div>
              <Users className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
        <Card
          className={`border-border cursor-pointer hover:shadow-lg transition-all ${
            roleFilter === 'admin' ? 'border-2 border-yellow-500' : ''
          }`}
          onClick={() => setRoleFilter('admin')}
        >
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Admins</p>
                <p className="text-2xl font-bold text-white">{stats.admins}</p>
              </div>
              <User className="h-8 w-8 text-red-500" />
            </div>
          </CardContent>
        </Card>
        <Card
          className={`border-border cursor-pointer hover:shadow-lg transition-all ${
            roleFilter === 'manager' ? 'border-2 border-yellow-500' : ''
          }`}
          onClick={() => setRoleFilter('manager')}
        >
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Managers</p>
                <p className="text-2xl font-bold text-white">{stats.managers}</p>
              </div>
              <User className="h-8 w-8 text-amber-500" />
            </div>
          </CardContent>
        </Card>
        <Card
          className={`border-border cursor-pointer hover:shadow-lg transition-all ${
            roleFilter === 'supervisor' ? 'border-2 border-yellow-500' : ''
          }`}
          onClick={() => setRoleFilter('supervisor')}
        >
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Supervisors</p>
                <p className="text-2xl font-bold text-white">{stats.supervisors}</p>
              </div>
              <User className="h-8 w-8 text-sky-500" />
            </div>
          </CardContent>
        </Card>
        <Card
          className={`border-border cursor-pointer hover:shadow-lg transition-all ${
            roleFilter === 'employee' ? 'border-2 border-yellow-500' : ''
          }`}
          onClick={() => setRoleFilter('employee')}
        >
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Employees</p>
                <p className="text-2xl font-bold text-white">{stats.employees}</p>
              </div>
              <User className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
        <Card
          className={`border-border cursor-pointer hover:shadow-lg transition-all ${
            roleFilter === 'contractor' ? 'border-2 border-yellow-500' : ''
          }`}
          onClick={() => setRoleFilter('contractor')}
        >
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Contractors</p>
                <p className="text-2xl font-bold text-white">{stats.contractors}</p>
              </div>
              <User className="h-8 w-8 text-orange-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* User Management Interface */}
      <Card className="border-border">
        <CardHeader>
          <div>
            <CardTitle className="text-white">{userStatusTab === 'deleted' ? 'Deleted Users' : 'Active Users'}</CardTitle>
            <CardDescription className="text-muted-foreground">
              {userStatusTab === 'deleted'
                ? 'Review historical deleted accounts and remove them when it is safe to do so.'
                : 'View and manage active user accounts, roles, and permissions.'}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Search Bar */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, email, or employee ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-11 bg-slate-900/50 border-slate-600 text-white placeholder:text-muted-foreground"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Filter by Team</Label>
                <Select value={teamFilter} onValueChange={setTeamFilter}>
                  <SelectTrigger className="bg-input border-border text-white data-[placeholder]:[&>span]:!text-muted-foreground">
                    <SelectValue placeholder="All teams" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All teams</SelectItem>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {teamOptions.map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Filter by Line Manager</Label>
                <Select value={managerFilter} onValueChange={setManagerFilter}>
                  <SelectTrigger className="bg-input border-border text-white data-[placeholder]:[&>span]:!text-muted-foreground">
                    <SelectValue placeholder="All managers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All managers</SelectItem>
                    <SelectItem value="none">No manager assigned</SelectItem>
                    {managerOptions.map((managerUser) => (
                      <SelectItem key={managerUser.id} value={managerUser.id}>
                        {managerUser.full_name || managerUser.email || managerUser.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* User Table */}
            {loading ? (
              <PanelLoader message="Loading users..." className="py-8" />
            ) : filteredUsers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {searchQuery
                  ? 'No users found matching your search.'
                  : userStatusTab === 'deleted'
                    ? 'No deleted users found.'
                    : 'No active users yet.'}
              </div>
            ) : (
              <div className="border border-slate-700 rounded-lg overflow-x-auto overflow-y-hidden">
                <Table className="min-w-[1120px]">
                  <TableHeader>
                    <TableRow className="border-slate-700 hover:bg-slate-800/50">
                      <TableHead className="text-muted-foreground">Name</TableHead>
                      <TableHead className="text-muted-foreground">Email</TableHead>
                      <TableHead className="text-muted-foreground">Employee ID</TableHead>
                      <TableHead className="text-muted-foreground">Role</TableHead>
                      <TableHead className="text-muted-foreground">Team</TableHead>
                      <TableHead className="text-muted-foreground">Line Manager(s)</TableHead>
                      <TableHead className="text-muted-foreground">Fleet Asset</TableHead>
                      <TableHead className="text-muted-foreground">Created</TableHead>
                      <TableHead className="text-right text-muted-foreground">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map((user, index) => {
                      const currentTeamKey = user.team_id || 'unassigned';
                      const previousTeamKey = index > 0 ? (filteredUsers[index - 1]?.team_id || 'unassigned') : null;
                      const startsNewTeam = index === 0 || currentTeamKey !== previousTeamKey;
                      const teamLabel = user.team_id ? (teamNameById.get(user.team_id) || user.team_id) : 'Unassigned';

                      return (
                      <Fragment key={user.id}>
                        {startsNewTeam && (
                          <TableRow key={`${currentTeamKey}-divider`} className="border-slate-600 bg-slate-950/40 hover:bg-slate-950/40">
                            <TableCell colSpan={9} className="py-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                              {teamLabel}
                            </TableCell>
                          </TableRow>
                        )}
                      <TooltipProvider delayDuration={2000}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <TableRow key={user.id} className="border-slate-700 hover:bg-slate-800/50">
                        <TableCell className="font-medium text-white">
                          <div className="flex items-center gap-2 w-full cursor-default">
                            <UserTableAvatar user={user} />
                            {user.full_name || 'Unnamed User'}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          <div className="flex items-center gap-2 text-sm">
                            <Mail className="h-3 w-3 text-muted-foreground" />
                            {user.email}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{user.employee_id || '-'}</TableCell>
                        <TableCell>
                          <button
                            type="button"
                            disabled={!canQuickEditAssignments}
                            onClick={(event) => canQuickEditAssignments && openQuickEdit(user, 'role', event.currentTarget)}
                            className="disabled:cursor-default enabled:cursor-pointer"
                          >
                            <Badge
                              variant={
                                isSuperAdminUser(user)
                                  ? 'destructive'
                                  : isSupervisorRole(user.role)
                                    ? 'outline'
                                    : user.role?.role_class === 'admin'
                                      ? 'destructive'
                                      : user.role?.role_class === 'manager'
                                        ? 'warning'
                                        : 'secondary'
                              }
                              className={
                                isSupervisorRole(user.role)
                                  ? 'border-sky-400/50 bg-sky-500/20 text-sky-200 hover:bg-sky-500/30'
                                  : undefined
                              }
                            >
                              {isSuperAdminUser(user) ? 'SuperAdmin' : (user.role?.display_name || 'No Role')}
                            </Badge>
                          </button>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          <button
                            type="button"
                            disabled={!canQuickEditAssignments}
                            onClick={(event) => canQuickEditAssignments && openQuickEdit(user, 'team', event.currentTarget)}
                            className="text-left disabled:cursor-default enabled:cursor-pointer"
                          >
                            {user.team_id ? (teamNameById.get(user.team_id) || user.team_id) : 'Unassigned'}
                          </button>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {getDisplayedManagers(user.line_manager_id, user.secondary_manager_id)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {user.current_fleet_assignment ? (
                            <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-300">
                              {formatAdminFleetAssignment(user.current_fleet_assignment)}
                            </Badge>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          <div className="flex items-center gap-2 text-sm">
                            <Calendar className="h-3 w-3 text-muted-foreground" />
                            {new Date(user.created_at || '').toLocaleDateString()}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEditDialog(user)}
                              className="text-blue-400 hover:text-blue-300 hover:bg-slate-800"
                              title="Edit User"
                            >
                              <Edit className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openResetPasswordDialog(user)}
                              className="text-amber-400 hover:text-amber-300 hover:bg-slate-800"
                              title="Reset Password"
                            >
                              <KeyRound className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openResetSensitivePinDialog(user)}
                              className="text-yellow-300 hover:text-yellow-200 hover:bg-slate-800"
                              title="Reset Sensitive PIN"
                            >
                              <Shield className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openDeleteDialog(user)}
                              disabled={user.id === currentUser?.id} // Prevent self-deletion
                              className="text-red-400 hover:text-red-300 hover:bg-slate-800 disabled:opacity-30"
                              title="Delete User"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                            </TableRow>
                          </TooltipTrigger>
                          <TooltipContent
                            align="start"
                            side="top"
                            className="min-w-[360px] max-w-[420px] py-3"
                          >
                            <div className="space-y-2">
                              <p className="font-medium text-white">{user.full_name || user.email || 'Unnamed User'}</p>
                              <div className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1">
                                <span className="text-slate-300">Last login</span>
                                <span>{formatAdminActivityTimestamp(user.last_sign_in_at)}</span>
                                <span className="text-slate-300">Last active</span>
                                <span>{formatAdminActivityTimestamp(user.last_active_at)}</span>
                              </div>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      </Fragment>
                    )})}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {isMounted && quickEditTarget && quickEditUser && createPortal(
        <div
          ref={quickEditPanelRef}
          role="dialog"
          aria-modal="false"
          data-testid="quick-edit-floating-panel"
          className="z-[100] w-72 max-w-[calc(100vw-1rem)] overflow-y-auto overflow-x-hidden rounded-md border border-border bg-slate-900 p-4 text-white shadow-md outline-none"
          style={{
            position: 'fixed',
            top: quickEditPosition?.top ?? 8,
            left: quickEditPosition?.left ?? 8,
            maxHeight: quickEditPosition?.maxHeight ?? 320,
            visibility: quickEditPanelReady ? 'visible' : 'hidden',
          }}
        >
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">
                {quickEditTarget.field === 'role' ? 'Change Job Role' : 'Change Team'}
              </p>
              <p className="text-xs text-muted-foreground">{quickEditUser.full_name || quickEditUser.email}</p>
            </div>

            {quickEditTarget.field === 'role' ? (
              <Select value={quickEditValue} onValueChange={setQuickEditValue}>
                <SelectTrigger className="bg-input border-border text-white data-[placeholder]:[&>span]:!text-muted-foreground">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent className="quick-edit-select-content">
                  {getRoleOptionsForUser(quickEditUser).map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Select value={quickEditValue || 'none'} onValueChange={(value) => setQuickEditValue(value === 'none' ? '' : value)}>
                <SelectTrigger className="bg-input border-border text-white data-[placeholder]:[&>span]:!text-muted-foreground">
                  <SelectValue placeholder="Select team" />
                </SelectTrigger>
                <SelectContent className="quick-edit-select-content">
                  <SelectItem value="none">No team</SelectItem>
                  {teamOptions.map((team) => (
                    <SelectItem key={team.id} value={team.id}>
                      {team.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={closeQuickEdit}
                className="border-slate-600 text-white hover:bg-slate-800"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => handleQuickEditSave(quickEditUser)}
                disabled={quickEditSaving}
                className="bg-brand-yellow hover:bg-brand-yellow-hover text-slate-900"
              >
                {quickEditSaving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Add User Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className={dialogContentViewportClassName({ size: '5xl', scroll: 'content', className: 'border-border text-white' })}>
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Create a new user account with email and password
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto pr-1 space-y-4">
            {formError && (
              <div className="bg-red-500/10 border border-red-500/50 rounded p-3 text-sm text-red-400">
                {formError}
              </div>
            )}
            <div className="bg-blue-500/10 border border-blue-500/50 rounded-lg p-3 text-sm text-blue-300">
              <strong>Note:</strong> A secure temporary password will be automatically generated and sent to the user&apos;s email address.
            </div>
            <div className="rounded-lg border border-[hsl(var(--absence-primary)/0.25)] bg-[hsl(var(--absence-primary)/0.06)] p-4 md:p-5">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="space-y-4">
                  <div className="rounded-lg border border-border bg-slate-900/40 p-4 space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Account Details</p>
                    <div className="space-y-2">
                      <Label htmlFor="add-email">Email *</Label>
                      <Input
                        id="add-email"
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        placeholder="user@example.com"
                        className="bg-slate-950 border-border text-white placeholder:text-muted-foreground"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="add-name">Full Name *</Label>
                      <Input
                        id="add-name"
                        value={formData.full_name}
                        onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                        placeholder="John Smith"
                        className="bg-slate-950 border-border text-white placeholder:text-muted-foreground"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="add-phone">Phone Number</Label>
                        <Input
                          id="add-phone"
                          type="tel"
                          value={formData.phone_number}
                          onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })}
                          placeholder="07123 456789"
                          className="bg-slate-950 border-border text-white placeholder:text-muted-foreground"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="add-employee-id">Employee ID</Label>
                        <Input
                          id="add-employee-id"
                          value={formData.employee_id}
                          onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })}
                          placeholder="E001"
                          className="bg-slate-950 border-border text-white placeholder:text-muted-foreground"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="add-role">Role *</Label>
                      <Select value={formData.role_id} onValueChange={(value) => setFormData({ ...formData, role_id: value })}>
                        <SelectTrigger className="bg-slate-950 border-border text-white data-[placeholder]:[&>span]:!text-muted-foreground">
                          <SelectValue placeholder="Select a role" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableRoles.map((role) => (
                            <SelectItem key={role.id} value={role.id}>
                              {role.display_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-slate-900/40 p-4 space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Team and Shift</p>
                    <div className="space-y-2">
                      <Label htmlFor="add-team-id">Team Name *</Label>
                      <Select
                        value={formData.team_id}
                        onValueChange={(value) => setFormData({ ...formData, team_id: value })}
                      >
                        <SelectTrigger id="add-team-id" className="bg-slate-950 border-border text-white data-[placeholder]:[&>span]:!text-muted-foreground">
                          <SelectValue placeholder="Select team" />
                        </SelectTrigger>
                        <SelectContent>
                          {teamOptions.map((team) => (
                            <SelectItem key={team.id} value={team.id}>
                              {team.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Confirm Team manager *</Label>
                      <div className="rounded-md border border-border bg-slate-950 px-3 py-2 text-sm text-white">
                        {[
                          selectedAddTeamManagers?.manager_1_name,
                          selectedAddTeamManagers?.manager_2_name,
                        ].filter(Boolean).join(', ') || 'No team manager configured'}
                      </div>
                      <p className="text-xs text-muted-foreground">Inherited from selected team and cannot be changed here.</p>
                      {formData.team_id && !selectedAddTeamHasManager && (
                        <p className="text-xs text-red-400">This team has no manager configured, so user creation is blocked.</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="add-work-shift-template">Work Shift *</Label>
                      <Select
                        value={formData.work_shift_template_id}
                        onValueChange={(value) => setFormData({ ...formData, work_shift_template_id: value })}
                      >
                        <SelectTrigger id="add-work-shift-template" className="bg-slate-950 border-border text-white data-[placeholder]:[&>span]:!text-muted-foreground">
                          <SelectValue placeholder={onboardingContextLoading ? 'Loading work shifts...' : 'Select work shift template'} />
                        </SelectTrigger>
                        <SelectContent>
                          {workShiftTemplates.map((template) => (
                            <SelectItem key={template.id} value={template.id}>
                              {template.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {selectedWorkShiftTemplate && (
                        <p className="text-xs text-muted-foreground">
                          {summarizeWorkShiftPattern(selectedWorkShiftTemplate.pattern)}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-lg border border-border bg-slate-900/40 p-4 space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Annual Leave Setup</p>
                    <div className="space-y-2">
                      <Label htmlFor="add-annual-allowance">Total Annual Leave Allowance *</Label>
                      <Input
                        id="add-annual-allowance"
                        type="number"
                        step="0.01"
                        value={formData.annual_allowance_days}
                        onChange={(e) => {
                          const nextAnnualAllowance = e.target.value;
                          setFormData((prev) => ({
                            ...prev,
                            annual_allowance_days: nextAnnualAllowance,
                            remaining_leave_days: getDefaultRemainingLeaveDays(nextAnnualAllowance),
                          }));
                        }}
                        className="bg-slate-950 border-border text-white"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="add-remaining-allowance">Remaining Annual Leave ({onboardingFinancialYearLabel || 'current FY'}) *</Label>
                      <Input
                        id="add-remaining-allowance"
                        type="number"
                        step="0.5"
                        value={formData.remaining_leave_days}
                        onChange={(e) => setFormData({ ...formData, remaining_leave_days: e.target.value })}
                        onBlur={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            remaining_leave_days: normalizeHalfDayString(e.target.value),
                          }))
                        }
                        className="bg-slate-950 border-border text-white"
                      />
                      <p className="text-xs text-muted-foreground">
                        Auto-calculated from prorated allowance based on start date, rounded to the nearest 0.5 day.
                      </p>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-slate-900/40 p-4 space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Automation</p>
                    <div className="space-y-2">
                      <Label>Auto-book remaining Bank Holidays? *</Label>
                      <RadioGroup
                        value={formData.auto_book_bank_holidays}
                        onValueChange={(value) =>
                          setFormData({ ...formData, auto_book_bank_holidays: value as BinaryChoice })
                        }
                        className="grid grid-cols-2 gap-3"
                      >
                        <div className="flex items-center gap-2 rounded-md border border-border bg-slate-950 px-3 py-2">
                          <RadioGroupItem id="add-bank-holiday-yes" value="yes" />
                          <Label htmlFor="add-bank-holiday-yes" className="text-sm font-normal">Yes</Label>
                        </div>
                        <div className="flex items-center gap-2 rounded-md border border-border bg-slate-950 px-3 py-2">
                          <RadioGroupItem id="add-bank-holiday-no" value="no" />
                          <Label htmlFor="add-bank-holiday-no" className="text-sm font-normal">No</Label>
                        </div>
                      </RadioGroup>
                    </div>

                    <div className="space-y-2">
                      <Label>Auto-book the following bulk absence bookings this year? *</Label>
                      <RadioGroup
                        value={formData.auto_apply_bulk_bookings}
                        onValueChange={(value) =>
                          setFormData((prev) => ({
                            ...prev,
                            auto_apply_bulk_bookings: value as BinaryChoice,
                            selected_bulk_batch_ids: value === 'yes' ? prev.selected_bulk_batch_ids : [],
                          }))
                        }
                        className="grid grid-cols-2 gap-3"
                      >
                        <div className="flex items-center gap-2 rounded-md border border-border bg-slate-950 px-3 py-2">
                          <RadioGroupItem id="add-bulk-yes" value="yes" />
                          <Label htmlFor="add-bulk-yes" className="text-sm font-normal">Yes</Label>
                        </div>
                        <div className="flex items-center gap-2 rounded-md border border-border bg-slate-950 px-3 py-2">
                          <RadioGroupItem id="add-bulk-no" value="no" />
                          <Label htmlFor="add-bulk-no" className="text-sm font-normal">No</Label>
                        </div>
                      </RadioGroup>
                      {formData.auto_apply_bulk_bookings === 'yes' && (
                        <>
                          {bulkAbsenceOptions.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                              No bulk absence bookings found for {onboardingFinancialYearLabel || 'the current financial year'}.
                            </p>
                          ) : (
                            <div className="max-h-52 space-y-2 overflow-y-auto rounded-md border border-border bg-slate-950/70 p-3">
                              {bulkAbsenceOptions.map((batch) => {
                                const isChecked = formData.selected_bulk_batch_ids.includes(batch.id);
                                return (
                                  <label key={batch.id} className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-800 bg-slate-900/40 px-2 py-2">
                                    <Checkbox
                                      checked={isChecked}
                                      onCheckedChange={(checked) => {
                                        const shouldCheck = checked === true;
                                        setFormData((prev) => {
                                          const current = new Set(prev.selected_bulk_batch_ids);
                                          if (shouldCheck) current.add(batch.id);
                                          else current.delete(batch.id);
                                          return { ...prev, selected_bulk_batch_ids: Array.from(current) };
                                        });
                                      }}
                                    />
                                    <span className="text-xs text-slate-200">
                                      {batch.reasonName}: {new Date(batch.startDate).toLocaleDateString()} - {new Date(batch.endDate).toLocaleDateString()}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="pt-4 border-t border-border">
            <Button variant="outline" onClick={() => setAddDialogOpen(false)} className="border-slate-600 text-white hover:bg-slate-800">
              Cancel
            </Button>
            <Button
              onClick={handleAddUser}
              disabled={formLoading || onboardingContextLoading}
              className="bg-brand-yellow hover:bg-brand-yellow-hover text-slate-900"
            >
              {formLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <UserPlus className="h-4 w-4 mr-2" />
                  Create User
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className={dialogContentViewportClassName({ className: 'border-border text-white' })}>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Update user information and role
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {formError && (
              <div className="bg-red-500/10 border border-red-500/50 rounded p-3 text-sm text-red-400">
                {formError}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="edit-email">Email *</Label>
              <Input
                id="edit-email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="bg-input border-border text-white"
              />
              <p className="text-xs text-amber-500">⚠️ Changing email will require the user to verify their new address</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-name">Full Name *</Label>
              <Input
                id="edit-name"
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                className="bg-input border-border text-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-phone">Phone Number</Label>
              <Input
                id="edit-phone"
                type="tel"
                value={formData.phone_number}
                onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })}
                className="bg-input border-border text-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-employee-id">Employee ID</Label>
              <Input
                id="edit-employee-id"
                value={formData.employee_id}
                onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })}
                className="bg-input border-border text-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-role">Role *</Label>
              <Select value={formData.role_id} onValueChange={(value) => setFormData({ ...formData, role_id: value })}>
                <SelectTrigger className="bg-input border-border text-white data-[placeholder]:[&>span]:!text-muted-foreground">
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  {availableRoles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <>
              <div className="space-y-2">
                <Label htmlFor="edit-team-id">Primary Team</Label>
                <Select
                  value={formData.team_id || 'none'}
                  onValueChange={(value) => setFormData({ ...formData, team_id: value === 'none' ? '' : value })}
                >
                  <SelectTrigger id="edit-team-id" className="bg-input border-border text-white data-[placeholder]:[&>span]:!text-muted-foreground">
                    <SelectValue placeholder="Select team" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No team</SelectItem>
                    {teamOptions.map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Manager 1</Label>
                <div className="rounded-md border border-input bg-input px-3 py-2 text-sm text-white">
                  {(formData.team_id ? teamDetailsById.get(formData.team_id)?.manager_1_name : null) || 'No Manager 1'}
                </div>
                <p className="text-xs text-muted-foreground">Inherited automatically from the selected team.</p>
              </div>
              <div className="space-y-2">
                <Label>Manager 2</Label>
                <div className="rounded-md border border-input bg-input px-3 py-2 text-sm text-white">
                  {(formData.team_id ? teamDetailsById.get(formData.team_id)?.manager_2_name : null) || 'No Manager 2'}
                </div>
                <p className="text-xs text-muted-foreground">Inherited automatically from the selected team.</p>
              </div>
            </>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)} className="border-slate-600 text-white hover:bg-slate-800">
              Cancel
            </Button>
            <Button onClick={handleEditUser} disabled={formLoading} className="bg-brand-yellow hover:bg-brand-yellow-hover text-slate-900">
              {formLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Options Dialog */}
      <Dialog open={deleteOptionsDialogOpen} onOpenChange={setDeleteOptionsDialogOpen}>
        <DialogContent className={dialogContentViewportClassName({ size: '2xl', className: 'border-border text-white' })}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Delete User Account
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Choose how to handle this user&apos;s company data (timesheets, inspections, etc.)
            </DialogDescription>
          </DialogHeader>

          {selectedUser && (
            <div className="space-y-4">
              {/* User Info */}
              <div className="bg-slate-800 rounded p-4 space-y-2">
                <div className="text-sm">
                  <span className="text-muted-foreground">Name:</span>{' '}
                  <span className="text-white font-medium">{selectedUser.full_name}</span>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Email:</span>{' '}
                  <span className="text-slate-200">{selectedUser.email}</span>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Role:</span>{' '}
                  <Badge
                    variant={
                      isSuperAdminUser(selectedUser)
                        ? 'destructive'
                        : selectedUser.role?.role_class === 'admin'
                          ? 'destructive'
                          : isSupervisorRole(selectedUser.role)
                            ? 'outline'
                            : 'default'
                    }
                    className={
                      isSuperAdminUser(selectedUser) || selectedUser.role?.role_class === 'admin'
                        ? undefined
                        : isSupervisorRole(selectedUser.role)
                          ? 'border-sky-400/50 bg-sky-500/20 text-sky-200 hover:bg-sky-500/30'
                          : 'bg-slate-700 border-slate-500 text-slate-100 hover:bg-slate-600'
                    }
                  >
                    {isSuperAdminUser(selectedUser) ? 'SuperAdmin' : (selectedUser.role?.display_name || 'No Role')}
                  </Badge>
                </div>
              </div>

              {/* Deletion Options */}
              <div className="space-y-3">
                <Label className="text-white font-semibold">What should happen to this user&apos;s company data?</Label>

                {/* Option 1: Keep Data (Recommended) */}
                <div
                  onClick={() => setDeletionMode('keep-data')}
                  className={`border-2 rounded-lg p-4 cursor-pointer transition-all ${
                    deletionMode === 'keep-data'
                      ? 'border-green-500 bg-green-500/10'
                      : 'border-slate-600 hover:border-slate-500'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-1 h-5 w-5 rounded-full border-2 flex items-center justify-center ${
                      deletionMode === 'keep-data' ? 'border-green-500' : 'border-slate-500'
                    }`}>
                      {deletionMode === 'keep-data' && (
                        <div className="h-3 w-3 rounded-full bg-green-500" />
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-white">Keep Company Data</p>
                        <Badge variant="outline" className="text-green-500 border-green-500">
                          Recommended
                        </Badge>
                      </div>
                      <p className="text-sm text-slate-400 mt-1">
                        Preserve timesheets, inspections, and other submitted work for audits and reporting.
                        User will be marked as &quot;{selectedUser.full_name} (Deleted User)&quot; in all records.
                      </p>
                      <div className="mt-2 text-xs text-muted-foreground">
                        ✓ Personal account deleted  • ✓ Company data preserved  • ✓ Audit trail maintained
                      </div>
                    </div>
                  </div>
                </div>

                {/* Option 2: Delete All */}
                <div
                  onClick={() => setDeletionMode('delete-all')}
                  className={`border-2 rounded-lg p-4 cursor-pointer transition-all ${
                    deletionMode === 'delete-all'
                      ? 'border-red-500 bg-red-500/10'
                      : 'border-slate-600 hover:border-slate-500'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-1 h-5 w-5 rounded-full border-2 flex items-center justify-center ${
                      deletionMode === 'delete-all' ? 'border-red-500' : 'border-slate-500'
                    }`}>
                      {deletionMode === 'delete-all' && (
                        <div className="h-3 w-3 rounded-full bg-red-500" />
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-white">Delete All User Data</p>
                        <Badge variant="destructive">
                          Permanent
                        </Badge>
                      </div>
                      <p className="text-sm text-slate-400 mt-1">
                        Completely remove all data including timesheets, inspections, and submitted work.
                        This may impact reports and audit trails.
                      </p>
                      <div className="mt-2 text-xs text-red-400">
                        ⚠ Cannot be undone  • ⚠ Affects reporting  • ⚠ Removes audit history
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {formError && (
                <div className="bg-red-500/10 border border-red-500/50 rounded p-3 text-sm text-red-400">
                  {formError}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteOptionsDialogOpen(false)}
              className="border-slate-600 text-white hover:bg-slate-800"
              disabled={formLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDeleteUser}
              disabled={formLoading}
              className={deletionMode === 'delete-all' ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}
            >
              {formLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  {deletionMode === 'keep-data' ? 'Delete User (Keep Data)' : 'Delete User & All Data'}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Confirmation Dialog */}
      <Dialog open={resetPasswordDialogOpen} onOpenChange={setResetPasswordDialogOpen}>
        <DialogContent className={dialogContentViewportClassName({ className: 'border-border text-white' })}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-amber-500" />
              Reset User Password
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              This will generate a new temporary password for the user. They will be required to change it on their next login.
            </DialogDescription>
          </DialogHeader>
          {selectedUser && (
            <div className="bg-slate-800 rounded p-4 space-y-2">
              <p className="text-sm">
                <span className="text-muted-foreground">Name:</span>{' '}
                <span className="text-white font-medium">{selectedUser.full_name}</span>
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">Email:</span>{' '}
                <span className="text-slate-200">{selectedUser.email}</span>
              </p>
            </div>
          )}
          {formError && (
            <div className="bg-red-500/10 border border-red-500/50 rounded p-3 text-sm text-red-400">
              {formError}
            </div>
          )}
          <div className="bg-amber-500/10 border border-amber-500/50 rounded p-3 text-sm text-amber-400">
            <strong>Note:</strong> The new password will be sent to the user&apos;s email address and displayed to you.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setResetPasswordDialogOpen(false); setSelectedUser(null); }} className="border-slate-600 text-white hover:bg-slate-800">
              Cancel
            </Button>
            <Button
              onClick={handleResetPassword}
              disabled={formLoading}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {formLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Resetting...
                </>
              ) : (
                <>
                  <KeyRound className="h-4 w-4 mr-2" />
                  Reset Password
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Sensitive PIN Confirmation Dialog */}
      <Dialog open={resetSensitivePinDialogOpen} onOpenChange={setResetSensitivePinDialogOpen}>
        <DialogContent className={dialogContentViewportClassName({ className: 'border-border text-white' })}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-yellow-300" />
              Reset Sensitive PIN
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              This clears the user&apos;s sensitive module PIN. They must set a new PIN from their profile before opening protected modules.
            </DialogDescription>
          </DialogHeader>
          {selectedUser && (
            <div className="bg-slate-800 rounded p-4 space-y-2">
              <p className="text-sm">
                <span className="text-muted-foreground">Name:</span>{' '}
                <span className="text-white font-medium">{selectedUser.full_name}</span>
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">Email:</span>{' '}
                <span className="text-slate-200">{selectedUser.email}</span>
              </p>
            </div>
          )}
          {formError && (
            <div className="bg-red-500/10 border border-red-500/50 rounded p-3 text-sm text-red-400">
              {formError}
            </div>
          )}
          <div className="bg-yellow-500/10 border border-yellow-500/50 rounded p-3 text-sm text-yellow-200">
            <strong>Note:</strong> The current PIN is not displayed or emailed. Admins will be notified of the reset.
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setResetSensitivePinDialogOpen(false); setSelectedUser(null); }}
              className="border-slate-600 text-white hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleResetSensitivePin}
              disabled={formLoading}
              className="bg-yellow-500 hover:bg-yellow-600 text-slate-950"
            >
              {formLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Resetting...
                </>
              ) : (
                <>
                  <Shield className="h-4 w-4 mr-2" />
                  Reset Sensitive PIN
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Password Display Dialog */}
      <Dialog open={passwordDisplayDialogOpen} onOpenChange={setPasswordDisplayDialogOpen}>
        <DialogContent className={dialogContentViewportClassName({ size: 'lg', className: 'border-border text-white' })}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              {isNewUser ? 'User Created Successfully' : 'Password Reset Successfully'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {isNewUser
                ? 'The user account has been created with a temporary password.'
                : 'The user\'s password has been reset to a new temporary password.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Email Status */}
            {emailSent ? (
              <div className="bg-green-500/10 border border-green-500/50 rounded p-3 text-sm text-green-400">
                ✅ Email sent successfully to the user
              </div>
            ) : (
              <div className="bg-amber-500/10 border border-amber-500/50 rounded p-3 text-sm text-amber-400">
                ⚠️ Email failed to send - Please share the password with the user manually
              </div>
            )}

            {/* Password Display */}
            <div className="bg-slate-800 border-2 border-[#F1D64A] rounded-lg p-4">
              <Label className="text-sm text-slate-400 mb-2 block">Temporary Password</Label>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-slate-950 rounded p-3 font-mono text-lg text-[#F1D64A] select-all">
                  {temporaryPassword}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={copyPasswordToClipboard}
                  className="border-slate-600 hover:bg-slate-800"
                >
                  {passwordCopied ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 mr-1 text-green-500" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 mr-1" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Important Notice */}
            <div className="bg-blue-500/10 border border-blue-500/50 rounded p-4">
              <p className="text-sm text-blue-400 font-medium mb-2">
                📋 Important Information
              </p>
              <ul className="text-sm text-blue-400 space-y-1 list-disc list-inside">
                <li>This password will only be shown once</li>
                <li>The user must change this password on their first login</li>
                <li>Password has been {emailSent ? 'emailed' : 'generated but not emailed'}</li>
              </ul>
            </div>
          </div>

          <DialogFooter>
            <Button
              onClick={() => {
                setPasswordDisplayDialogOpen(false);
                setTemporaryPassword('');
                setPasswordCopied(false);
              }}
              className="bg-brand-yellow hover:bg-brand-yellow-hover text-slate-900"
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
        </TabsContent>

        {/* Roles Tab Content */}
        {canManageRoleDefinitions && (
          <TabsContent value="roles">
            <JobRolesTab />
          </TabsContent>
        )}

        {canManageRoleDefinitions && (
          <TabsContent value="teams">
            <TeamsTab />
          </TabsContent>
        )}

        {/* Permissions Tab Content */}
        {canEditRolePermissions && (
          <TabsContent value="permissions">
            <RoleManagement />
          </TabsContent>
        )}
      </Tabs>
    </AppPageShell>
  );
}
