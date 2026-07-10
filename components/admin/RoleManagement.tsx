'use client';

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Check, ChevronDown, ChevronRight, Loader2, LockKeyhole, Minus } from 'lucide-react';
import { toast } from 'sonner';
import { adminNavItems, employeeNavItems, managerNavItems } from '@/lib/config/navigation';
import { getRoleSortPriority } from '@/lib/config/roles-core';
import {
  computeQuickEditFloatingPosition,
  type FloatingPositionResult,
} from '@/lib/ui/quick-edit-floating-position';
import type {
  ModuleName,
  PermissionAccessLevel,
  PermissionsAuditInfo,
  PermissionModuleMatrixColumn,
  UpdateUserPermissionLevelsRequest,
  UserPermissionAssignableRole,
  UserPermissionTeamDefaultRow,
  UserPermissionMatrixRow,
} from '@/types/roles';
import { MODULE_CSS_VAR, PERMISSION_LEVEL_LABELS } from '@/types/roles';
import { cn } from '@/lib/utils';

const MODULE_GROUP_DIVIDER_CLASS = 'border-l border-slate-600/20';
const PERMISSION_LEVELS: PermissionAccessLevel[] = [0, 1, 2, 3, 4, 5];
const NAVBAR_OFFSET_PX = 68;
const USER_COLUMN_WIDTH_PX = 180;
const FLOATING_MODULE_HEADER_HEIGHT_PX = 96;
const FLOATING_HEADER_HIDDEN_TRANSFORM = 'translate3d(0, -12px, 0)';
const FLOATING_HEADER_VISIBLE_TRANSFORM = 'translate3d(0, 0, 0)';
const MATRIX_TOOLTIP_CLASS = 'w-56 max-w-[calc(100vw-2rem)] text-xs leading-snug';
const MATRIX_DETAIL_TOOLTIP_CLASS = 'w-64 max-w-[calc(100vw-2rem)] text-xs leading-snug';
const UNSAVED_PERMISSIONS_TOAST_ID = 'permissions-unsaved-changes';
const HIDDEN_MATRIX_MODULES = new Set<ModuleName>(['reminders']);
const DASHBOARD_MODULE_ORDER = [
  ...employeeNavItems,
  ...managerNavItems,
  ...adminNavItems,
]
  .map((item) => item.module)
  .filter((moduleName, index, allModules): moduleName is ModuleName =>
    Boolean(moduleName && allModules.indexOf(moduleName) === index)
  );

type PendingUserLevelChange = {
  userId: string;
  userName: string;
  moduleName: ModuleName;
  moduleDisplayName: string;
  fromLevel: PermissionAccessLevel;
  toLevel: PermissionAccessLevel;
  requiresSensitivePin: boolean;
};

type PendingTeamDefaultChange = {
  teamId: string;
  teamName: string;
  moduleName: ModuleName;
  moduleDisplayName: string;
  fromEnabled: boolean;
  toEnabled: boolean;
};

type UserPermissionTeamGroup = {
  teamKey: string;
  teamLabel: string;
  teamDefault: UserPermissionTeamDefaultRow | null;
  users: UserPermissionMatrixRow[];
};

function getModuleColor(mod: ModuleName): string {
  return `hsl(var(${MODULE_CSS_VAR[mod]}))`;
}

function getModuleColorAlpha(mod: ModuleName, alpha: number): string {
  return `hsl(var(${MODULE_CSS_VAR[mod]}) / ${alpha})`;
}

function isYellowModule(mod: ModuleName): boolean {
  return MODULE_CSS_VAR[mod] === '--brand-yellow';
}

function getUserPermissionRolePriority(user: UserPermissionMatrixRow): number {
  if (user.is_locked_admin || user.role_class === 'admin' || user.role_name === 'admin') {
    return getRoleSortPriority('admin');
  }
  return getRoleSortPriority(user.role_name || user.role_class || '');
}

function getLevelTextSizeClass(level: PermissionAccessLevel): string {
  if (level === 1) return 'text-xs';
  if (level === 2) return 'text-sm';
  if (level === 3) return 'text-base';
  if (level === 4) return 'text-lg';
  if (level === 5) return 'text-xl';
  return 'text-sm';
}

function getPermissionKeyRoleBadge(level: PermissionAccessLevel): {
  label: string;
  variant: 'destructive' | 'outline' | 'warning' | 'secondary';
  className?: string;
} | null {
  if (level === 1) return { label: 'Contractor', variant: 'secondary' };
  if (level === 2) return { label: 'Employee', variant: 'secondary' };
  if (level === 3) {
    return {
      label: 'Supervisor',
      variant: 'outline',
      className: 'border-sky-400/50 bg-sky-500/20 text-sky-200 hover:bg-sky-500/30',
    };
  }
  if (level === 4) return { label: 'Manager', variant: 'warning' };
  if (level === 5) return { label: 'Admin', variant: 'destructive' };
  return null;
}

function getUserPermissionTeamSortName(user: UserPermissionMatrixRow): string {
  return user.team_name || user.team_id || 'ZZZ Unassigned';
}

function getRoleDefaultLevelForUser(
  user: UserPermissionMatrixRow,
  module: PermissionModuleMatrixColumn,
  teamEnabled: boolean
): PermissionAccessLevel {
  if (user.is_locked_admin) return 5;
  if (module.requires_full_access_role) return 0;
  if (!teamEnabled || typeof user.role_hierarchy_rank !== 'number') return 0;
  if (user.role_hierarchy_rank < module.enforced_minimum_access_level) return 0;
  return user.role_hierarchy_rank === 5 ? 5
    : user.role_hierarchy_rank === 4 ? 4
      : user.role_hierarchy_rank === 3 ? 3
        : user.role_hierarchy_rank === 2 ? 2
          : user.role_hierarchy_rank === 1 ? 1
            : 0;
}

function getAllowedUserPermissionLevels(
  user: UserPermissionMatrixRow,
  module: PermissionModuleMatrixColumn
): PermissionAccessLevel[] {
  if (user.is_locked_admin) return [5];
  if (module.requires_full_access_role) return [0];
  return PERMISSION_LEVELS.filter((level) => level === 0 || level >= module.enforced_minimum_access_level);
}

function isUserPermissionLevelAllowed(
  user: UserPermissionMatrixRow,
  module: PermissionModuleMatrixColumn,
  level: PermissionAccessLevel
): boolean {
  return getAllowedUserPermissionLevels(user, module).includes(level);
}

function matchesUserPermissionRole(user: UserPermissionMatrixRow, expectedName: string): boolean {
  const normalized = expectedName.trim().toLowerCase();
  return [user.role_name, user.role_display_name]
    .filter(Boolean)
    .some((value) => String(value).trim().toLowerCase() === normalized);
}

function getUserPermissionRoleBadge(user: UserPermissionMatrixRow): {
  label: string;
  variant: 'destructive' | 'outline' | 'warning' | 'secondary';
  className?: string;
} {
  if (user.is_super_admin) {
    return { label: 'SuperAdmin', variant: 'destructive' };
  }

  if (matchesUserPermissionRole(user, 'supervisor')) {
    return {
      label: user.role_display_name || 'Supervisor',
      variant: 'outline',
      className: 'border-sky-400/50 bg-sky-500/20 text-sky-200 hover:bg-sky-500/30',
    };
  }

  if (user.is_locked_admin || user.role_class === 'admin' || user.role_name === 'admin') {
    return { label: user.role_display_name || 'Administrator', variant: 'destructive' };
  }

  if (user.role_class === 'manager') {
    return { label: user.role_display_name || 'Manager', variant: 'warning' };
  }

  return { label: user.role_display_name || 'No Role', variant: 'secondary' };
}

function hideFloatingHeaderOverlay(overlay: HTMLDivElement): void {
  overlay.style.opacity = '0';
  overlay.style.transform = FLOATING_HEADER_HIDDEN_TRANSFORM;
  overlay.setAttribute('aria-hidden', 'true');
}

function showFloatingHeaderOverlay(overlay: HTMLDivElement): void {
  overlay.style.opacity = '1';
  overlay.style.transform = FLOATING_HEADER_VISIBLE_TRANSFORM;
  overlay.setAttribute('aria-hidden', 'false');
}

function RoleManagementSkeleton() {
  return (
    <Card className="border-border">
      <CardHeader>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-7 w-64 bg-slate-800" />
            <Skeleton className="h-4 w-[32rem] max-w-full bg-slate-800" />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Skeleton className="h-10 w-[260px] bg-slate-800" />
            <Skeleton className="h-10 w-32 bg-slate-800" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-x-6 gap-y-2 rounded-lg border border-slate-700 bg-slate-950/40 p-2 text-xs md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="flex h-7 items-center gap-2">
              <Skeleton className="h-7 w-9 bg-slate-800" />
              <Skeleton className="h-4 w-20 bg-slate-800" />
            </div>
          ))}
        </div>
        <div className="overflow-hidden rounded-lg border border-slate-700 bg-slate-950/50">
          <div className="flex border-b border-slate-700">
            <Skeleton className="h-24 w-[180px] shrink-0 rounded-none bg-slate-800" />
            <div className="flex min-w-0 flex-1 gap-px">
              {Array.from({ length: 20 }).map((_, index) => (
                <Skeleton key={index} className="h-24 flex-1 rounded-none bg-slate-800" />
              ))}
            </div>
          </div>
          <div>
            {Array.from({ length: 8 }).map((_, rowIndex) => (
              <div key={rowIndex} className="flex border-b border-slate-800/80 last:border-b-0">
                <div className="flex h-9 w-[180px] shrink-0 items-center gap-2 bg-slate-950/70 px-2">
                  <Skeleton className="h-3 w-3 bg-slate-800" />
                  <Skeleton className="h-4 w-20 bg-slate-800" />
                  <Skeleton className="ml-auto h-4 w-6 bg-slate-800" />
                </div>
                <div className="flex min-w-0 flex-1 gap-px p-1">
                  {Array.from({ length: 20 }).map((_, colIndex) => (
                    <Skeleton key={colIndex} className="h-7 flex-1 bg-slate-800" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function RoleManagement() {
  const [modules, setModules] = useState<PermissionModuleMatrixColumn[]>([]);
  const [userTeams, setUserTeams] = useState<UserPermissionTeamDefaultRow[]>([]);
  const [assignableRoles, setAssignableRoles] = useState<UserPermissionAssignableRole[]>([]);
  const [users, setUsers] = useState<UserPermissionMatrixRow[]>([]);
  const [audit, setAudit] = useState<PermissionsAuditInfo | null>(null);
  const [userMatrixLoading, setUserMatrixLoading] = useState(true);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [pendingUserChanges, setPendingUserChanges] = useState<Record<string, PendingUserLevelChange>>({});
  const [pendingTeamDefaultChanges, setPendingTeamDefaultChanges] = useState<Record<string, PendingTeamDefaultChange>>({});
  const [confirmUserSaveOpen, setConfirmUserSaveOpen] = useState(false);
  const [savingUserLevels, setSavingUserLevels] = useState(false);
  const [draftUserLevels, setDraftUserLevels] = useState<Record<string, PermissionAccessLevel>>({});
  const [draftTeamDefaults, setDraftTeamDefaults] = useState<Record<string, boolean>>({});
  const [expandedTeamIds, setExpandedTeamIds] = useState<Set<string>>(() => new Set());
  const [savingSensitivePinModule, setSavingSensitivePinModule] = useState<ModuleName | null>(null);
  const [quickRoleTarget, setQuickRoleTarget] = useState<{ userId: string; triggerElement: HTMLElement } | null>(null);
  const [quickRoleValue, setQuickRoleValue] = useState('');
  const [quickRoleSaving, setQuickRoleSaving] = useState(false);
  const [quickRolePosition, setQuickRolePosition] = useState<FloatingPositionResult | null>(null);
  const [quickRolePanelReady, setQuickRolePanelReady] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const userMatrixViewportRef = useRef<HTMLDivElement | null>(null);
  const userMatrixHeaderRef = useRef<HTMLTableSectionElement | null>(null);
  const floatingHeaderRef = useRef<HTMLDivElement | null>(null);
  const floatingHeaderModulesViewportRef = useRef<HTMLDivElement | null>(null);
  const floatingHeaderTrackRef = useRef<HTMLDivElement | null>(null);
  const floatingHeaderFrameRef = useRef<number | null>(null);
  const quickRolePanelRef = useRef<HTMLDivElement | null>(null);

  const fetchUserMatrix = useCallback(async () => {
    try {
      setUserMatrixLoading(true);
      const response = await fetch('/api/admin/permissions/users', { cache: 'no-store' });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch user permission matrix');
      }

      setModules(data.modules ?? []);
      setUsers(data.users ?? []);
      setUserTeams(data.teams ?? []);
      setAssignableRoles(data.assignable_roles ?? []);
      setAudit(data.audit ?? null);
      setPendingUserChanges({});
      setPendingTeamDefaultChanges({});
      setDraftUserLevels({});
      setDraftTeamDefaults({});
      setExpandedTeamIds(new Set());
    } catch (error) {
      console.error('Error fetching user permission matrix:', error);
      toast.error('Failed to load user permission matrix');
    } finally {
      setUserMatrixLoading(false);
    }
  }, []);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    fetchUserMatrix();
  }, [fetchUserMatrix]);

  const quickRoleUser = useMemo(
    () => (quickRoleTarget ? users.find((user) => user.id === quickRoleTarget.userId) || null : null),
    [quickRoleTarget, users]
  );

  const closeQuickRoleEdit = useCallback(() => {
    setQuickRoleTarget(null);
    setQuickRoleValue('');
    setQuickRolePosition(null);
    setQuickRolePanelReady(false);
  }, []);

  const updateQuickRolePosition = useCallback(() => {
    if (!quickRoleTarget || !quickRolePanelRef.current) return;
    if (!document.body.contains(quickRoleTarget.triggerElement)) {
      closeQuickRoleEdit();
      return;
    }

    const triggerRect = quickRoleTarget.triggerElement.getBoundingClientRect();
    const panelRect = quickRolePanelRef.current.getBoundingClientRect();
    setQuickRolePosition(
      computeQuickEditFloatingPosition({
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
          scrollX: window.scrollX,
          scrollY: window.scrollY,
        },
      })
    );
    setQuickRolePanelReady(true);
  }, [closeQuickRoleEdit, quickRoleTarget]);

  useLayoutEffect(() => {
    if (!quickRoleTarget || !quickRoleUser) return;
    setQuickRolePanelReady(false);
    updateQuickRolePosition();
  }, [quickRoleTarget, quickRoleUser, updateQuickRolePosition]);

  useEffect(() => {
    if (!quickRoleTarget) return;

    const handleViewportChange = () => updateQuickRolePosition();
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [quickRoleTarget, updateQuickRolePosition]);

  useEffect(() => {
    if (!quickRoleTarget || !quickRolePanelRef.current || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      updateQuickRolePosition();
    });
    observer.observe(quickRolePanelRef.current);

    return () => observer.disconnect();
  }, [quickRoleTarget, updateQuickRolePosition]);

  useEffect(() => {
    if (!quickRoleTarget) return;

    const handlePointerDown = (event: PointerEvent) => {
      const targetNode = event.target as Node | null;
      if (!targetNode) return;
      if (targetNode instanceof Element && targetNode.closest('.quick-edit-select-content')) return;
      if (quickRolePanelRef.current?.contains(targetNode)) return;
      if (quickRoleTarget.triggerElement.contains(targetNode)) return;
      closeQuickRoleEdit();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeQuickRoleEdit();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeQuickRoleEdit, quickRoleTarget]);

  const orderedUserModules = useMemo(() => {
    const visibleModules = modules.filter((module) => !HIDDEN_MATRIX_MODULES.has(module.module_name));
    const byModuleName = new Map(visibleModules.map((module) => [module.module_name, module]));
    const ordered = DASHBOARD_MODULE_ORDER
      .map((moduleName) => byModuleName.get(moduleName))
      .filter((module): module is PermissionModuleMatrixColumn => Boolean(module));
    const orderedNames = new Set(ordered.map((module) => module.module_name));
    const remaining = visibleModules.filter((module) => !orderedNames.has(module.module_name));

    return [...ordered, ...remaining];
  }, [modules]);
  const userTeamById = useMemo(
    () => new Map(userTeams.map((team) => [team.id, team])),
    [userTeams]
  );

  const getDisplayedUserLevel = useCallback(
    (user: UserPermissionMatrixRow, moduleName: ModuleName): PermissionAccessLevel =>
      draftUserLevels[`${user.id}:${moduleName}`] ?? user.permissions[moduleName] ?? 0,
    [draftUserLevels]
  );

  const getDisplayedTeamDefault = useCallback(
    (team: UserPermissionTeamDefaultRow, moduleName: ModuleName): boolean =>
      draftTeamDefaults[`${team.id}:${moduleName}`] ?? team.permissions[moduleName] ?? false,
    [draftTeamDefaults]
  );

  const getDisplayedInheritedLevel = useCallback(
    (user: UserPermissionMatrixRow, module: PermissionModuleMatrixColumn): PermissionAccessLevel => {
      const team = user.team_id ? userTeamById.get(user.team_id) : null;
      if (!team) return user.inherited_permissions[module.module_name] ?? 0;
      return getRoleDefaultLevelForUser(user, module, getDisplayedTeamDefault(team, module.module_name));
    },
    [getDisplayedTeamDefault, userTeamById]
  );

  const filteredUsers = useMemo(() => {
    const query = userSearchQuery.trim().toLowerCase();
    const nextUsers = query
      ? users.filter((user) =>
          [
            user.full_name,
            user.employee_id,
            user.team_name,
            user.role_display_name,
          ]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(query))
        )
      : users;

    return [...nextUsers].sort((a, b) => {
      const byTeam = getUserPermissionTeamSortName(a).localeCompare(getUserPermissionTeamSortName(b));
      if (byTeam !== 0) return byTeam;

      const byRole = getUserPermissionRolePriority(a) - getUserPermissionRolePriority(b);
      if (byRole !== 0) return byRole;

      return (a.full_name || a.employee_id || '').localeCompare(b.full_name || b.employee_id || '');
    });
  }, [users, userSearchQuery]);

  const groupedFilteredUsers = useMemo<UserPermissionTeamGroup[]>(() => {
    const groups = new Map<string, UserPermissionTeamGroup>();

    filteredUsers.forEach((user) => {
      const teamKey = user.team_id || 'unassigned';
      const existingGroup = groups.get(teamKey);
      if (existingGroup) {
        existingGroup.users.push(user);
        return;
      }

      groups.set(teamKey, {
        teamKey,
        teamLabel: user.team_name || 'Unassigned',
        teamDefault: teamKey === 'unassigned' ? null : userTeamById.get(teamKey) ?? null,
        users: [user],
      });
    });

    return Array.from(groups.values());
  }, [filteredUsers, userTeamById]);

  const hasActiveUserSearch = userSearchQuery.trim().length > 0;
  const visibleUserCount = useMemo(
    () =>
      groupedFilteredUsers.reduce(
        (total, group) =>
          total + (hasActiveUserSearch || expandedTeamIds.has(group.teamKey) ? group.users.length : 0),
        0
      ),
    [expandedTeamIds, groupedFilteredUsers, hasActiveUserSearch]
  );
  const visibleTeamGroups = useMemo(
    () =>
      groupedFilteredUsers.map((group) => {
        const isExpanded = hasActiveUserSearch || expandedTeamIds.has(group.teamKey);
        return {
          ...group,
          isExpanded,
          visibleUsers: isExpanded ? group.users : [],
        };
      }),
    [expandedTeamIds, groupedFilteredUsers, hasActiveUserSearch]
  );

  const moduleByName = useMemo(
    () => new Map(orderedUserModules.map((module) => [module.module_name, module])),
    [orderedUserModules]
  );
  const userById = useMemo(
    () => new Map(users.map((user) => [user.id, user])),
    [users]
  );
  const pendingUserChangeList = useMemo(() => {
    const nextChanges = { ...pendingUserChanges };

    Object.entries(draftUserLevels).forEach(([changeKey, toLevel]) => {
      if (nextChanges[changeKey]) return;

      const separatorIndex = changeKey.lastIndexOf(':');
      if (separatorIndex === -1) return;

      const userId = changeKey.slice(0, separatorIndex);
      const moduleName = changeKey.slice(separatorIndex + 1) as ModuleName;
      const user = userById.get(userId);
      const permissionModule = moduleByName.get(moduleName);
      if (!user || !permissionModule) return;

      const fromLevel = user.permissions[moduleName] ?? 0;
      if (fromLevel === toLevel) return;

      nextChanges[changeKey] = {
        userId,
        userName: user.full_name || user.email || user.id,
        moduleName,
        moduleDisplayName: permissionModule.display_name,
        fromLevel,
        toLevel,
        requiresSensitivePin: permissionModule.requires_sensitive_pin,
      };
    });

    return Object.values(nextChanges);
  }, [draftUserLevels, moduleByName, pendingUserChanges, userById]);
  const pendingTeamDefaultChangeList = useMemo(() => {
    const nextChanges = { ...pendingTeamDefaultChanges };

    Object.entries(draftTeamDefaults).forEach(([changeKey, toEnabled]) => {
      if (nextChanges[changeKey]) return;

      const separatorIndex = changeKey.lastIndexOf(':');
      if (separatorIndex === -1) return;

      const teamId = changeKey.slice(0, separatorIndex);
      const moduleName = changeKey.slice(separatorIndex + 1) as ModuleName;
      const team = userTeamById.get(teamId);
      const permissionModule = moduleByName.get(moduleName);
      if (!team || !permissionModule) return;

      const fromEnabled = team.permissions[moduleName] ?? false;
      if (fromEnabled === toEnabled) return;

      nextChanges[changeKey] = {
        teamId,
        teamName: team.name,
        moduleName,
        moduleDisplayName: permissionModule.display_name,
        fromEnabled,
        toEnabled,
      };
    });

    return Object.values(nextChanges);
  }, [draftTeamDefaults, moduleByName, pendingTeamDefaultChanges, userTeamById]);
  const hasPendingPermissionChanges =
    pendingUserChangeList.length > 0 || pendingTeamDefaultChangeList.length > 0;

  const updateFloatingHeaderNow = useCallback(() => {
    const viewport = userMatrixViewportRef.current;
    const header = userMatrixHeaderRef.current;
    const overlay = floatingHeaderRef.current;
    const moduleViewport = floatingHeaderModulesViewportRef.current;
    const track = floatingHeaderTrackRef.current;
    if (visibleUserCount === 0) {
      if (overlay) hideFloatingHeaderOverlay(overlay);
      return;
    }
    if (!viewport || !header || !overlay || !moduleViewport || !track) {
      if (overlay) hideFloatingHeaderOverlay(overlay);
      return;
    }

    const viewportRect = viewport.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const visible =
      headerRect.bottom <= NAVBAR_OFFSET_PX &&
      viewportRect.bottom > NAVBAR_OFFSET_PX + FLOATING_MODULE_HEADER_HEIGHT_PX &&
      viewportRect.top < window.innerHeight;

    if (!visible) {
      hideFloatingHeaderOverlay(overlay);
      return;
    }

    const left = Math.max(viewportRect.left, 0);
    const width = Math.min(viewportRect.width, window.innerWidth - left);
    overlay.style.left = `${left}px`;
    overlay.style.width = `${width}px`;
    showFloatingHeaderOverlay(overlay);
    moduleViewport.style.width = `${Math.max(width - USER_COLUMN_WIDTH_PX, 0)}px`;
    track.style.transform = 'translate3d(0, 0, 0)';
  }, [visibleUserCount]);

  const scheduleFloatingHeaderUpdate = useCallback(() => {
    if (floatingHeaderFrameRef.current !== null) return;

    floatingHeaderFrameRef.current = window.requestAnimationFrame(() => {
      floatingHeaderFrameRef.current = null;
      updateFloatingHeaderNow();
    });
  }, [updateFloatingHeaderNow]);

  useEffect(() => {
    const viewport = userMatrixViewportRef.current;
    const overlay = floatingHeaderRef.current;
    scheduleFloatingHeaderUpdate();

    window.addEventListener('scroll', scheduleFloatingHeaderUpdate, { passive: true });
    window.addEventListener('resize', scheduleFloatingHeaderUpdate);
    viewport?.addEventListener('scroll', scheduleFloatingHeaderUpdate, { passive: true });

    return () => {
      window.removeEventListener('scroll', scheduleFloatingHeaderUpdate);
      window.removeEventListener('resize', scheduleFloatingHeaderUpdate);
      viewport?.removeEventListener('scroll', scheduleFloatingHeaderUpdate);
      if (floatingHeaderFrameRef.current !== null) {
        window.cancelAnimationFrame(floatingHeaderFrameRef.current);
        floatingHeaderFrameRef.current = null;
      }
      if (overlay) {
        hideFloatingHeaderOverlay(overlay);
      }
    };
  }, [orderedUserModules.length, visibleUserCount, scheduleFloatingHeaderUpdate]);

  const openQuickRoleEdit = useCallback((user: UserPermissionMatrixRow, triggerElement: HTMLElement) => {
    setQuickRolePosition(null);
    setQuickRolePanelReady(false);
    setQuickRoleTarget({ userId: user.id, triggerElement });
    setQuickRoleValue(user.role_id || '');
  }, []);

  const toggleTeamExpanded = useCallback((teamKey: string) => {
    setExpandedTeamIds((previous) => {
      const next = new Set(previous);
      if (next.has(teamKey)) {
        next.delete(teamKey);
      } else {
        next.add(teamKey);
      }
      return next;
    });
  }, []);

  const handleQuickRoleSave = useCallback(async () => {
    if (!quickRoleUser) return;

    try {
      setQuickRoleSaving(true);
      const response = await fetch(`/api/admin/users/${quickRoleUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: quickRoleUser.full_name,
          phone_number: quickRoleUser.phone_number,
          employee_id: quickRoleUser.employee_id,
          role_id: quickRoleValue || null,
          line_manager_id: quickRoleUser.line_manager_id || null,
          team_id: quickRoleUser.team_id || null,
        }),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to update user role');
      }

      closeQuickRoleEdit();
      await fetchUserMatrix();
      toast.success('Job role updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update user role');
    } finally {
      setQuickRoleSaving(false);
    }
  }, [closeQuickRoleEdit, fetchUserMatrix, quickRoleUser, quickRoleValue]);

  const handleUserLevelChange = useCallback(
    (user: UserPermissionMatrixRow, module: PermissionModuleMatrixColumn, nextLevel: PermissionAccessLevel) => {
      if (user.is_locked_admin) return;
      if (!isUserPermissionLevelAllowed(user, module, nextLevel)) return;

      const currentLevel = getDisplayedUserLevel(user, module.module_name);
      if (currentLevel === nextLevel) return;

      const changeKey = `${user.id}:${module.module_name}`;
      setDraftUserLevels((previous) => {
        const baseLevel = user.permissions[module.module_name] ?? 0;
        const next = { ...previous };
        if (nextLevel === baseLevel) {
          delete next[changeKey];
        } else {
          next[changeKey] = nextLevel;
        }
        return next;
      });

      setPendingUserChanges((previous) => {
        const existing = previous[changeKey];
        const fromLevel = existing?.fromLevel ?? currentLevel;
        const next = { ...previous };

        if (fromLevel === nextLevel) {
          delete next[changeKey];
          return next;
        }

        next[changeKey] = {
          userId: user.id,
          userName: user.full_name || user.email || user.id,
          moduleName: module.module_name,
          moduleDisplayName: module.display_name,
          fromLevel,
          toLevel: nextLevel,
          requiresSensitivePin: module.requires_sensitive_pin,
        };
        return next;
      });
    },
    [getDisplayedUserLevel]
  );

  const handleCycleUserLevel = useCallback(
    (user: UserPermissionMatrixRow, module: PermissionModuleMatrixColumn) => {
      const currentLevel = getDisplayedUserLevel(user, module.module_name);
      const allowedLevels = getAllowedUserPermissionLevels(user, module);
      const currentIndex = allowedLevels.indexOf(currentLevel);
      const nextLevel = allowedLevels[(currentIndex + 1) % allowedLevels.length] ?? allowedLevels[0] ?? 0;
      handleUserLevelChange(user, module, nextLevel);
    },
    [getDisplayedUserLevel, handleUserLevelChange]
  );

  const handleTeamDefaultChange = useCallback(
    (team: UserPermissionTeamDefaultRow, module: PermissionModuleMatrixColumn, nextEnabled: boolean) => {
      const currentEnabled = getDisplayedTeamDefault(team, module.module_name);
      if (currentEnabled === nextEnabled) return;

      const changeKey = `${team.id}:${module.module_name}`;
      setDraftTeamDefaults((previous) => {
        const baseEnabled = team.permissions[module.module_name] ?? false;
        const next = { ...previous };
        if (nextEnabled === baseEnabled) {
          delete next[changeKey];
        } else {
          next[changeKey] = nextEnabled;
        }
        return next;
      });

      setDraftUserLevels((previous) => {
        const next = { ...previous };
        users.forEach((entry) => {
          if (entry.team_id !== team.id || entry.is_locked_admin) return;
          const userChangeKey = `${entry.id}:${module.module_name}`;
          if (pendingUserChanges[userChangeKey]) return;

          const entryCurrentLevel = previous[userChangeKey] ?? entry.permissions[module.module_name] ?? 0;
          const currentDefaultLevel = getRoleDefaultLevelForUser(entry, module, currentEnabled);
          if (entryCurrentLevel !== currentDefaultLevel) return;

          const nextDefaultLevel = getRoleDefaultLevelForUser(entry, module, nextEnabled);
          const baseLevel = entry.permissions[module.module_name] ?? 0;
          if (nextDefaultLevel === baseLevel) {
            delete next[userChangeKey];
          } else {
            next[userChangeKey] = nextDefaultLevel;
          }
        });
        return next;
      });

      setPendingTeamDefaultChanges((previous) => {
        const existing = previous[changeKey];
        const fromEnabled = existing?.fromEnabled ?? currentEnabled;
        const next = { ...previous };

        if (fromEnabled === nextEnabled) {
          delete next[changeKey];
          return next;
        }

        next[changeKey] = {
          teamId: team.id,
          teamName: team.name,
          moduleName: module.module_name,
          moduleDisplayName: module.display_name,
          fromEnabled,
          toEnabled: nextEnabled,
        };
        return next;
      });
    },
    [getDisplayedTeamDefault, pendingUserChanges, users]
  );

  const handleSaveUserLevels = useCallback(async () => {
    if (!hasPendingPermissionChanges) return;

    try {
      setSavingUserLevels(true);
      const body: UpdateUserPermissionLevelsRequest = {
        updates: pendingUserChangeList.map((change) => ({
          user_id: change.userId,
          module_name: change.moduleName,
          access_level: change.toLevel,
        })),
        team_default_updates: pendingTeamDefaultChangeList.map((change) => ({
          team_id: change.teamId,
          module_name: change.moduleName,
          enabled: change.toEnabled,
        })),
      };

      const response = await fetch('/api/admin/permissions/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update user permission levels');
      }

      toast.success('Permission levels updated');
      setConfirmUserSaveOpen(false);
      await fetchUserMatrix();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update user permission levels');
    } finally {
      setSavingUserLevels(false);
    }
  }, [fetchUserMatrix, hasPendingPermissionChanges, pendingTeamDefaultChangeList, pendingUserChangeList]);

  const handleToggleModuleSensitivePin = useCallback(async (module: PermissionModuleMatrixColumn) => {
    const nextRequiresSensitivePin = !module.requires_sensitive_pin;
    setSavingSensitivePinModule(module.module_name);
    setModules((previous) =>
      previous.map((entry) =>
        entry.module_name === module.module_name
          ? { ...entry, requires_sensitive_pin: nextRequiresSensitivePin }
          : entry
      )
    );

    try {
      const response = await fetch(`/api/admin/permissions/modules/${module.module_name}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requires_sensitive_pin: nextRequiresSensitivePin }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update sensitive PIN requirement');
      }

      if (data.module) {
        setModules((previous) =>
          previous.map((entry) =>
            entry.module_name === module.module_name
              ? { ...entry, ...data.module }
              : entry
          )
        );
      }

      toast.success(
        `${module.display_name} sensitive PIN ${nextRequiresSensitivePin ? 'enabled' : 'disabled'}`
      );
    } catch (error) {
      setModules((previous) =>
        previous.map((entry) =>
          entry.module_name === module.module_name
            ? { ...entry, requires_sensitive_pin: module.requires_sensitive_pin }
            : entry
        )
      );
      toast.error(error instanceof Error ? error.message : 'Failed to update sensitive PIN requirement');
    } finally {
      setSavingSensitivePinModule(null);
    }
  }, []);

  useEffect(() => {
    if (!hasPendingPermissionChanges) {
      toast.dismiss(UNSAVED_PERMISSIONS_TOAST_ID);
      return;
    }

    const changeCount = pendingUserChangeList.length + pendingTeamDefaultChangeList.length;
    toast.warning('Unsaved permission changes', {
      id: UNSAVED_PERMISSIONS_TOAST_ID,
      description: `${changeCount} change${changeCount === 1 ? '' : 's'} will not take effect until saved.`,
      duration: Infinity,
      action: {
        label: 'Save',
        onClick: () => setConfirmUserSaveOpen(true),
      },
    });
  }, [hasPendingPermissionChanges, pendingTeamDefaultChangeList.length, pendingUserChangeList.length]);

  useEffect(() => {
    return () => {
      toast.dismiss(UNSAVED_PERMISSIONS_TOAST_ID);
    };
  }, []);

  function getModuleWarnings(module: PermissionModuleMatrixColumn): string[] {
    if (!audit) return [];
    const moduleNeedles = [module.module_name, module.display_name, module.short_name]
      .map((value) => value.toLowerCase())
      .filter(Boolean);

    return audit.prdRelevantMismatches.filter((warning) => {
      const normalized = warning.toLowerCase();
      return moduleNeedles.some((needle) => normalized.includes(needle));
    });
  }

  function renderUserModuleHeader(module: PermissionModuleMatrixColumn, showModuleGroupDivider: boolean) {
    return (
      <th
        key={module.module_name}
        className={cn(
          'p-0 align-bottom group relative bg-slate-900/95',
          showModuleGroupDivider && MODULE_GROUP_DIVIDER_CLASS
        )}
        style={{ height: 118 }}
      >
        <div className="flex items-end justify-center h-full pb-2 relative">
          <button
            type="button"
            disabled={savingSensitivePinModule === module.module_name}
            onClick={() => void handleToggleModuleSensitivePin(module)}
            className={cn(
              'absolute left-1/2 top-1 -translate-x-1/2 rounded border p-0.5 transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-wait',
              module.requires_sensitive_pin
                ? 'border-amber-400/80 bg-amber-500/20 text-amber-200 opacity-100'
                : 'border-slate-700 bg-slate-950/70 text-slate-600 opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
            )}
            title={`${module.display_name}: click to ${
              module.requires_sensitive_pin ? 'disable' : 'enable'
            } sensitive PIN requirement`}
            aria-pressed={module.requires_sensitive_pin}
            aria-label={`${module.display_name}: ${
              module.requires_sensitive_pin ? 'disable' : 'enable'
            } sensitive PIN requirement`}
          >
            {savingSensitivePinModule === module.module_name ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <LockKeyhole className="h-3 w-3" />
            )}
          </button>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="cursor-default text-[11px] font-medium tracking-wide whitespace-nowrap"
                style={{
                  writingMode: 'vertical-rl',
                  transform: 'rotate(180deg)',
                  color: getModuleColor(module.module_name),
                }}
              >
                {module.short_name}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className={MATRIX_DETAIL_TOOLTIP_CLASS}>
              <div className="space-y-1">
                <div className="font-medium">{module.display_name}</div>
                <div>{module.description}</div>
                {module.requires_full_access_role ? (
                  <div className="text-amber-200">Hard-coded rule: Admin/Super Admin role required.</div>
                ) : module.enforced_minimum_access_level > module.minimum_hierarchy_rank ? (
                  <div className="text-amber-200">
                    Hard-coded rule: Level {module.enforced_minimum_access_level}+ required.
                  </div>
                ) : null}
                {module.requires_sensitive_pin && (
                  <div className="text-amber-200">Sensitive PIN required after access is granted.</div>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        </div>
      </th>
    );
  }

  function renderFloatingModuleHeader(module: PermissionModuleMatrixColumn, showModuleGroupDivider: boolean) {
    return (
      <div
        key={module.module_name}
        className={cn(
          'relative flex min-w-0 flex-1 basis-0 items-end justify-center bg-slate-900/50 pb-2',
          showModuleGroupDivider && MODULE_GROUP_DIVIDER_CLASS
        )}
        style={{ height: FLOATING_MODULE_HEADER_HEIGHT_PX }}
      >
        <span
          className="text-[11px] font-medium tracking-wide whitespace-nowrap"
          style={{
            writingMode: 'vertical-rl',
            transform: 'rotate(180deg)',
            color: getModuleColor(module.module_name),
          }}
        >
          {module.short_name}
        </span>
      </div>
    );
  }

  function renderUserLevelCell(
    user: UserPermissionMatrixRow,
    module: PermissionModuleMatrixColumn,
    showModuleGroupDivider: boolean
  ) {
    const level = getDisplayedUserLevel(user, module.module_name);
    const color = level > 0 ? getModuleColor(module.module_name) : undefined;
    const useDarkText = !user.is_locked_admin && level > 0 && isYellowModule(module.module_name);
    const isManualOverride =
      !user.is_locked_admin &&
      getDisplayedInheritedLevel(user, module) !== level;
    const isHardRuleLocked = !user.is_locked_admin && module.requires_full_access_role;
    const hasHigherUsableMinimum =
      !module.requires_full_access_role &&
      module.enforced_minimum_access_level > module.minimum_hierarchy_rank;

    return (
      <td
        key={module.module_name}
        className={cn('px-0 py-1 text-center', showModuleGroupDivider && MODULE_GROUP_DIVIDER_CLASS)}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
                type="button"
                disabled={user.is_locked_admin || isHardRuleLocked}
                onClick={() => handleCycleUserLevel(user, module)}
                className={cn(
                  'relative h-7 w-9 overflow-hidden rounded mx-auto flex items-center justify-center text-sm font-bold transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                  user.is_locked_admin
                    ? 'cursor-not-allowed border border-amber-500/50 bg-amber-500/15 text-amber-100'
                    : isHardRuleLocked
                      ? 'cursor-not-allowed border border-slate-700 bg-transparent text-slate-600'
                    : level > 0
                      ? cn('border', isManualOverride ? 'border-white' : 'border-transparent', useDarkText ? 'text-slate-900' : 'text-white')
                      : cn(
                          'border bg-transparent text-slate-500 hover:text-slate-300',
                          isManualOverride ? 'border-white' : 'border-slate-700 hover:border-slate-500'
                        )
                )}
                style={
                  !user.is_locked_admin && level > 0
                    ? { backgroundColor: color, boxShadow: `0 0 6px ${getModuleColorAlpha(module.module_name, 0.2)}` }
                    : undefined
                }
                aria-label={`${module.display_name} for ${user.full_name || user.email || user.id}: Level ${level}`}
              >
                <span className={cn('relative z-10 leading-none', getLevelTextSizeClass(level))}>
                  {level === 0 ? '-' : level}
                </span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className={MATRIX_TOOLTIP_CLASS}>
              {user.is_locked_admin ? (
                <div>
                  Admin-role users always have Level 5. Change this user&apos;s job role to non-admin before editing module permissions.
                </div>
              ) : isHardRuleLocked ? (
                <div>
                  {module.display_name} is currently limited to Admin/Super Admin roles by hard-coded module rules.
                </div>
              ) : (
                <div className="space-y-1">
                  <div>
                    {module.display_name}: <span className="font-semibold">{PERMISSION_LEVEL_LABELS[level]}</span>
                  </div>
                  <div>
                    Click to cycle through allowed permission levels
                    {hasHigherUsableMinimum
                      ? ` (${module.enforced_minimum_access_level}+ due to module rules).`
                      : '.'}
                  </div>
                  {module.requires_sensitive_pin && (
                    <div className="text-amber-200">This module still requires sensitive PIN unlock.</div>
                  )}
                </div>
              )}
          </TooltipContent>
        </Tooltip>
      </td>
    );
  }

  function renderTeamDefaultPermissionCell(
    team: UserPermissionTeamDefaultRow | null,
    module: PermissionModuleMatrixColumn,
    showModuleGroupDivider: boolean
  ) {
    if (!team) {
      return (
        <td
          key={module.module_name}
          className={cn('bg-slate-950/60 px-0 py-3', showModuleGroupDivider && MODULE_GROUP_DIVIDER_CLASS)}
        />
      );
    }

    const isEnabled = getDisplayedTeamDefault(team, module.module_name);
    const color = getModuleColor(module.module_name);

    return (
      <td
        key={module.module_name}
        className={cn('bg-slate-950/60 px-0 py-3 text-center', showModuleGroupDivider && MODULE_GROUP_DIVIDER_CLASS)}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
                type="button"
                onClick={() => handleTeamDefaultChange(team, module, !isEnabled)}
                className="relative mx-auto flex h-7 w-9 items-center justify-center overflow-hidden rounded border border-black/60 text-sm font-bold transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                style={
                  isEnabled
                    ? { backgroundColor: color, boxShadow: `0 0 6px ${getModuleColorAlpha(module.module_name, 0.2)}` }
                    : { backgroundColor: 'transparent' }
                }
                aria-label={`${module.display_name} default for ${team.name}: ${isEnabled ? 'enabled' : 'disabled'}`}
              >
                <span aria-hidden="true" className="absolute inset-0 bg-black/60" />
                {isEnabled ? (
                  <Check className="relative z-10 h-3.5 w-3.5 text-white" />
                ) : (
                  <Minus className="relative z-10 h-3 w-3 text-slate-400" />
                )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className={MATRIX_DETAIL_TOOLTIP_CLASS}>
              <div className="space-y-1">
                <div>
                  {team.name} default for {module.display_name}:{' '}
                  <span className="font-semibold">{isEnabled ? 'Enabled' : 'Disabled'}</span>
                </div>
                <div>
                  Click to toggle the team default. Users currently matching their job-role default will move with it; custom user levels stay unchanged.
                </div>
                {module.requires_full_access_role ? (
                  <div className="text-amber-200">Only Admin/Super Admin users can use this module.</div>
                ) : module.enforced_minimum_access_level > module.minimum_hierarchy_rank ? (
                  <div className="text-amber-200">
                    Users below Level {module.enforced_minimum_access_level} will remain at no access.
                  </div>
                ) : null}
              </div>
          </TooltipContent>
        </Tooltip>
      </td>
    );
  }

  if (userMatrixLoading) {
    return (
      <div className="space-y-6">
        <RoleManagementSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div
        ref={floatingHeaderRef}
        aria-hidden="true"
        className="pointer-events-none fixed top-[68px] z-[55] overflow-hidden rounded-t-lg border border-border/50 bg-slate-900/50 opacity-0 shadow-2xl backdrop-blur-xl transition-[opacity,transform] duration-200 ease-out will-change-[opacity,transform] motion-reduce:transition-none"
        style={{
          height: FLOATING_MODULE_HEADER_HEIGHT_PX,
          transform: FLOATING_HEADER_HIDDEN_TRANSFORM,
        }}
      >
        <div
          className="absolute left-0 top-0 z-10 flex items-end bg-slate-900/70 px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
          style={{ width: USER_COLUMN_WIDTH_PX, height: FLOATING_MODULE_HEADER_HEIGHT_PX }}
        >
          User
        </div>
        <div
          ref={floatingHeaderModulesViewportRef}
          className="overflow-hidden"
          style={{
            marginLeft: USER_COLUMN_WIDTH_PX,
            height: FLOATING_MODULE_HEADER_HEIGHT_PX,
          }}
        >
          <div
            ref={floatingHeaderTrackRef}
            className="flex h-full w-full will-change-transform"
          >
            {orderedUserModules.map((module, index) =>
              renderFloatingModuleHeader(module, index > 0 && index % 3 === 0)
            )}
          </div>
        </div>
      </div>

      <Card className="border-border">
        <CardHeader>
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <CardTitle className="text-white">User Permission Levels</CardTitle>
              <CardDescription className="text-muted-foreground">
                Set module access per user. The selected level controls the user&apos;s module access and equivalent in-module behavior.
              </CardDescription>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                value={userSearchQuery}
                onChange={(event) => setUserSearchQuery(event.target.value)}
                placeholder="Search users, teams, roles..."
                className="min-w-[260px] bg-slate-900/50 border-slate-700 text-white"
              />
              <Button
                type="button"
                disabled={!hasPendingPermissionChanges}
                onClick={() => setConfirmUserSaveOpen(true)}
                className="bg-brand-yellow text-slate-900 hover:bg-brand-yellow-hover disabled:opacity-50"
              >
                Save Changes
                {hasPendingPermissionChanges
                  ? ` (${pendingUserChangeList.length + pendingTeamDefaultChangeList.length})`
                  : ''}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 rounded-lg border border-slate-700 bg-slate-950/40 p-3 text-xs text-slate-300 md:grid-cols-3">
            {PERMISSION_LEVELS.map((level) => {
              const roleBadge = getPermissionKeyRoleBadge(level);

              return (
                <div key={level} className="flex items-center gap-2">
                  <span
                    className={cn(
                      'flex h-7 w-9 items-center justify-center rounded border border-white bg-transparent font-bold leading-none text-white',
                      getLevelTextSizeClass(level)
                    )}
                  >
                    {level === 0 ? '-' : level}
                  </span>
                  {roleBadge ? (
                    <Badge variant={roleBadge.variant} className={cn('text-[10px]', roleBadge.className)}>
                      {roleBadge.label}
                    </Badge>
                  ) : (
                    <span>{PERMISSION_LEVEL_LABELS[level]}</span>
                  )}
                </div>
              );
            })}
          </div>

          {filteredUsers.length === 0 || orderedUserModules.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {userSearchQuery ? 'No users found matching your search.' : 'User permission matrix is not configured yet.'}
            </div>
          ) : (
            <TooltipProvider delayDuration={200}>
              <div ref={userMatrixViewportRef} className="border border-slate-700 rounded-lg overflow-x-hidden">
                <table className="w-full text-sm table-fixed">
                  <colgroup>
                    <col style={{ width: USER_COLUMN_WIDTH_PX }} />
                    {orderedUserModules.map((module) => (
                      <col key={module.module_name} />
                    ))}
                  </colgroup>
                  <thead ref={userMatrixHeaderRef} className="bg-slate-900/95">
                    <tr className="border-b border-slate-700">
                      <th
                        className="sticky left-0 z-40 bg-slate-800 px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider align-bottom border-b border-slate-700"
                        style={{ height: 118 }}
                      >
                        User
                      </th>
                      {orderedUserModules.map((module, index) =>
                        renderUserModuleHeader(module, index > 0 && index % 3 === 0)
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleTeamGroups.map((group) => {
                      return (
                        <Fragment key={group.teamKey}>
                          <tr className="border-b border-slate-700 bg-slate-950/60 hover:bg-slate-950/60">
                            <td className="sticky left-0 z-20 bg-slate-950/95 p-0 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                              <button
                                type="button"
                                onClick={() => toggleTeamExpanded(group.teamKey)}
                                className="flex min-h-[48px] w-full items-center gap-1.5 px-2 py-4 text-left transition-colors hover:bg-slate-900/70 hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                                aria-expanded={group.isExpanded}
                                aria-label={`${group.isExpanded ? 'Collapse' : 'Expand'} ${group.teamLabel} team`}
                              >
                                {group.isExpanded ? (
                                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                                )}
                                <span className="min-w-0 truncate">{group.teamLabel}</span>
                                <span className="ml-auto rounded border border-slate-700 px-1.5 py-0.5 text-[10px] leading-none text-slate-500">
                                  {group.users.length}
                                </span>
                              </button>
                            </td>
                            {orderedUserModules.map((module, moduleIndex) =>
                              renderTeamDefaultPermissionCell(
                                group.teamDefault,
                                module,
                                moduleIndex > 0 && moduleIndex % 3 === 0
                              )
                            )}
                          </tr>
                          {group.visibleUsers.map((user) => {
                              const roleBadge = getUserPermissionRoleBadge(user);

                              return (
                                <tr
                                  key={user.id}
                                  className="border-b border-slate-700/50 transition-colors hover:bg-slate-800/40"
                                >
                                  <td className="sticky left-0 z-10 bg-slate-900/95 px-2 py-2 font-medium text-white">
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="min-w-0">
                                        <div className="truncate text-xs">
                                          {user.full_name || user.employee_id || 'Unnamed User'}
                                        </div>
                                        <div className="mt-1 flex flex-wrap gap-1">
                                          <button
                                            type="button"
                                            onClick={(event) => openQuickRoleEdit(user, event.currentTarget)}
                                            className="cursor-pointer"
                                          >
                                            <Badge
                                              variant={roleBadge.variant}
                                              className={cn('text-[9px]', roleBadge.className)}
                                            >
                                              {roleBadge.label}
                                            </Badge>
                                          </button>
                                        </div>
                                      </div>
                                      {user.is_locked_admin && (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <LockKeyhole className="mt-1 h-4 w-4 shrink-0 text-amber-300" />
                                          </TooltipTrigger>
                                          <TooltipContent side="right" className={MATRIX_TOOLTIP_CLASS}>
                                            Admin-role users are locked at Level 5. Change their job role to non-admin to edit module levels.
                                          </TooltipContent>
                                        </Tooltip>
                                      )}
                                    </div>
                                  </td>
                                  {orderedUserModules.map((module, moduleIndex) =>
                                    renderUserLevelCell(user, module, moduleIndex > 0 && moduleIndex % 3 === 0)
                                  )}
                                </tr>
                              );
                            })}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </TooltipProvider>
          )}
        </CardContent>
      </Card>

      {isMounted && quickRoleTarget && quickRoleUser && createPortal(
        <div
          ref={quickRolePanelRef}
          role="dialog"
          aria-modal="false"
          data-testid="permissions-role-quick-edit"
          className="z-[100] w-72 max-w-[calc(100vw-1rem)] overflow-y-auto overflow-x-hidden rounded-md border border-border bg-slate-900 p-4 text-white shadow-md outline-none"
          style={{
            position: 'fixed',
            top: quickRolePosition?.top ?? 8,
            left: quickRolePosition?.left ?? 8,
            maxHeight: quickRolePosition?.maxHeight ?? 320,
            visibility: quickRolePanelReady ? 'visible' : 'hidden',
          }}
        >
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">Change Job Role</p>
              <p className="text-xs text-muted-foreground">{quickRoleUser.full_name || quickRoleUser.email}</p>
            </div>

            <Select value={quickRoleValue} onValueChange={setQuickRoleValue}>
              <SelectTrigger className="bg-input border-border text-white data-[placeholder]:[&>span]:!text-muted-foreground">
                <SelectValue placeholder="Select role" />
              </SelectTrigger>
              <SelectContent className="quick-edit-select-content">
                {assignableRoles.map((role) => (
                  <SelectItem key={role.id} value={role.id}>
                    {role.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={closeQuickRoleEdit}
                disabled={quickRoleSaving}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => void handleQuickRoleSave()}
                disabled={quickRoleSaving || !quickRoleValue}
                className="bg-brand-yellow hover:bg-brand-yellow-hover text-slate-900"
              >
                {quickRoleSaving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <Dialog open={confirmUserSaveOpen} onOpenChange={setConfirmUserSaveOpen}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-3xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>Confirm Permission Level Changes</DialogTitle>
            <DialogDescription>
              Review the changed module levels before saving. Team defaults only move users who still match the old default.
              Sensitive PIN protection remains a separate unlock step.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
            {pendingTeamDefaultChangeList.length > 0 && (
              <div className="rounded-lg border border-slate-700 bg-slate-950/50">
                <div className="border-b border-slate-700/60 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Team Default Changes
                </div>
                {pendingTeamDefaultChangeList.map((change) => (
                  <div key={`${change.teamId}:${change.moduleName}`} className="border-b border-slate-700/60 p-3 last:border-b-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-medium text-white">{change.teamName}</div>
                        <div className="text-xs text-muted-foreground">{change.moduleDisplayName}</div>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <Badge variant="outline" className="border-slate-600 text-slate-300">
                          {change.fromEnabled ? 'Enabled' : 'Disabled'}
                        </Badge>
                        <span className="text-muted-foreground">to</span>
                        <Badge variant={change.toEnabled ? 'secondary' : 'outline'}>
                          {change.toEnabled ? 'Enabled' : 'Disabled'}
                        </Badge>
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      Matching team members will update using their job-role default. Custom user levels will not change.
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="rounded-lg border border-slate-700 bg-slate-950/50">
              {pendingUserChangeList.length > 0 && (
                <div className="border-b border-slate-700/60 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  User-Level Changes
                </div>
              )}
              {pendingUserChangeList.slice(0, 20).map((change) => {
                const changedModule = modules.find((entry) => entry.module_name === change.moduleName);
                const warnings = changedModule ? getModuleWarnings(changedModule) : [];

                return (
                  <div key={`${change.userId}:${change.moduleName}`} className="border-b border-slate-700/60 p-3 last:border-b-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-medium text-white">{change.userName}</div>
                        <div className="text-xs text-muted-foreground">{change.moduleDisplayName}</div>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <Badge variant="outline" className="border-slate-600 text-slate-300">
                          {change.fromLevel === 0 ? '-' : change.fromLevel} {PERMISSION_LEVEL_LABELS[change.fromLevel]}
                        </Badge>
                        <span className="text-muted-foreground">to</span>
                        <Badge variant={change.toLevel >= 4 ? 'warning' : change.toLevel === 0 ? 'outline' : 'secondary'}>
                          {change.toLevel === 0 ? '-' : change.toLevel} {PERMISSION_LEVEL_LABELS[change.toLevel]}
                        </Badge>
                      </div>
                    </div>

                    {change.requiresSensitivePin && change.toLevel > 0 && (
                      <div className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-100">
                        This module requires sensitive PIN setup/unlock after access is granted.
                      </div>
                    )}

                    {warnings.length > 0 && (
                      <div className="mt-2 space-y-1 text-xs text-slate-300">
                        {warnings.map((warning) => (
                          <div key={warning} className="rounded border border-slate-700 bg-slate-900/70 px-2 py-1">
                            {warning}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {pendingUserChangeList.length > 20 && (
                <div className="p-3 text-xs text-muted-foreground">
                  Plus {pendingUserChangeList.length - 20} more changes.
                </div>
              )}
              {pendingUserChangeList.length === 0 && (
                <div className="p-3 text-xs text-muted-foreground">
                  No direct user-level changes.
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmUserSaveOpen(false)}
              disabled={savingUserLevels}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleSaveUserLevels()}
              disabled={savingUserLevels}
              className="bg-brand-yellow text-slate-900 hover:bg-brand-yellow-hover"
            >
              {savingUserLevels && <Loader2 className="h-4 w-4 animate-spin" />}
              Save Permission Levels
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
