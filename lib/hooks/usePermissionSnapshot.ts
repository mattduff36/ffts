'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/hooks/useAuth';
import { ALL_MODULES, type ModuleName } from '@/types/roles';
import {
  createStatusError,
  getErrorStatus,
  isAuthErrorStatus,
  isServerErrorStatus,
} from '@/lib/utils/http-error';

interface PermissionSnapshotResponse {
  permissions?: Record<ModuleName, boolean>;
  permission_levels?: Record<ModuleName, number>;
  enabled_modules?: ModuleName[];
  sensitive_pin_modules?: ModuleName[];
  effective_team_id?: string | null;
  effective_team_name?: string | null;
}

async function fetchPermissionSnapshot(): Promise<PermissionSnapshotResponse> {
  const response = await fetch('/api/me/permissions', { cache: 'no-store' });
  const rawPayload = await response.text();
  let data: (PermissionSnapshotResponse & { error?: string }) | null = null;

  if (rawPayload) {
    try {
      data = JSON.parse(rawPayload) as PermissionSnapshotResponse & { error?: string };
    } catch (error) {
      throw createStatusError('Invalid permissions response payload', response.status, error);
    }
  }

  if (!response.ok) {
    throw createStatusError(data?.error || 'Failed to load permissions', response.status);
  }

  return data || {};
}

export function usePermissionSnapshot() {
  const { profile, isAdmin, isSuperAdmin, isViewingAs, effectiveRole, loading: authLoading } = useAuth();
  const requiresPermissionSnapshot = !isAdmin && !isSuperAdmin;

  const query = useQuery({
    queryKey: [
      'permission-snapshot',
      profile?.id || null,
      isViewingAs,
      effectiveRole?.name || null,
      effectiveRole?.team_id || null,
    ],
    enabled: !authLoading && Boolean(profile?.id),
    queryFn: fetchPermissionSnapshot,
    staleTime: 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const enabledModules = useMemo(() => {
    if (isAdmin || isSuperAdmin) {
      return ALL_MODULES;
    }

    return query.data?.enabled_modules || [];
  }, [isAdmin, isSuperAdmin, query.data?.enabled_modules]);

  const enabledModuleSet = useMemo(() => new Set<ModuleName>(enabledModules), [enabledModules]);
  const sensitivePinModules = useMemo(() => query.data?.sensitive_pin_modules || [], [query.data?.sensitive_pin_modules]);
  const sensitivePinModuleSet = useMemo(() => new Set<ModuleName>(sensitivePinModules), [sensitivePinModules]);
  const errorStatus = getErrorStatus(query.error);
  const holdForRecovery = isAuthErrorStatus(errorStatus) && !query.data;
  const serviceUnavailable = Boolean(query.error) && (errorStatus === null || isServerErrorStatus(errorStatus));

  const permissions = useMemo(() => {
    if (isAdmin || isSuperAdmin) {
      return ALL_MODULES.reduce<Record<ModuleName, boolean>>((acc, moduleName) => {
        acc[moduleName] = true;
        return acc;
      }, {} as Record<ModuleName, boolean>);
    }

    return query.data?.permissions || null;
  }, [isAdmin, isSuperAdmin, query.data?.permissions]);

  return {
    permissions,
    permissionLevels: query.data?.permission_levels || null,
    enabledModules,
    enabledModuleSet,
    sensitivePinModules,
    sensitivePinModuleSet,
    effectiveTeamId: query.data?.effective_team_id || effectiveRole?.team_id || null,
    effectiveTeamName: query.data?.effective_team_name || effectiveRole?.team_name || null,
    isLoading: authLoading || (requiresPermissionSnapshot && (query.isLoading || holdForRecovery)),
    error: query.error,
    errorStatus,
    serviceUnavailable,
    refetch: query.refetch,
  };
}
