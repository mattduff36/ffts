'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { type SupabaseClient, type User } from '@supabase/supabase-js';
import {
  broadcastAuthStateChange,
  clearRetiredAccountSwitchClientState,
  subscribeToAuthStateChange,
} from '@/lib/app-auth/client';
import {
  loadClientAuthSession,
  type ClientAuthSessionResponse,
  type ClientAuthSessionResult,
} from '@/lib/app-auth/client-session';
import { shouldDeferUnauthenticatedHandling } from '@/lib/app-auth/client-auth-policy';
import {
  buildSessionSnapshot,
  getSessionTransition,
  getUnauthenticatedSessionSnapshot,
  type AuthSessionSnapshot,
  type AuthTransitionReason,
} from '@/lib/app-auth/transition';
import {
  createClient,
  invalidateCachedDataToken,
} from '@/lib/supabase/client';
import {
  isPublicBrowserPath,
  isSafeInternalRedirectTarget,
} from '@/lib/routes/public-routes';
import { getClientServiceOutage } from '@/lib/app-auth/client-service-health';
import type { Database } from '@/types/database';
import { isAdminRole } from '@/lib/utils/role-access';
import {
  clearViewAsSelection,
  getViewAsSelection,
  VIEW_AS_CHANGE_EVENT,
  type ViewAsSelection,
} from '@/lib/utils/view-as-cookie';
import { registerAuthRecoveryHandlers } from '@/lib/app-auth/recovery-bridge';
import { installGlobalAuthAwareFetch } from '@/lib/utils/fetch-with-auth';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

type Profile = ProfileRow & {
  email?: string | null;
  super_admin?: boolean | null;
  team_id?: string | null;
  team?: {
    id: string;
    name: string;
  } | null;
  role?: {
    name: string;
    display_name: string;
    role_class?: 'admin' | 'manager' | 'employee';
    is_manager_admin: boolean;
    is_super_admin: boolean;
  } | null;
};

interface EffectiveRole {
  name: string;
  display_name: string;
  role_class?: 'admin' | 'manager' | 'employee';
  is_manager_admin: boolean;
  is_super_admin: boolean;
  team_id?: string | null;
  team_name?: string | null;
}

interface ViewAsRoleOption {
  id: string;
  name: string;
  display_name: string;
  role_class?: 'admin' | 'manager' | 'employee';
  is_manager_admin: boolean;
  is_super_admin: boolean;
}

interface ViewAsTeamOption {
  id: string;
  name: string;
}

interface AuthRecoveryOptions {
  statusCode?: number | null;
  reason?: string;
}

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (
    email: string,
    password: string,
    options?: {
      rememberMe?: boolean;
      deviceId?: string | null;
      deviceLabel?: string | null;
      deferRedirect?: boolean;
    }
  ) => Promise<{
    data: {
      error?: string;
      user?: { id: string; email: string | null };
      profile?: { id: string; must_change_password?: boolean | null };
    } | null;
    error: { message: string } | null;
  }>;
  signOut: () => Promise<{ error: { message: string } | null }>;
  signUp: (
    email: string,
    password: string,
    fullName: string,
    employeeId?: string
  ) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
  isAdmin: boolean;
  isManager: boolean;
  isSupervisor: boolean;
  isEmployee: boolean;
  isSuperAdmin: boolean;
  isActualSuperAdmin: boolean;
  isViewingAs: boolean;
  effectiveRole: EffectiveRole | null;
  refreshSession: () => Promise<ClientAuthSessionResult>;
  recoverFromAuthFailure: (options?: AuthRecoveryOptions) => Promise<boolean>;
  forceAuthRedirect: (statusCode?: number | null) => Promise<void>;
}

interface AuthProviderProps {
  children: React.ReactNode;
}

type BrowserSupabaseClient = SupabaseClient<Database>;

const AUTH_SCOPED_QUERY_KEYS = [
  'permission-snapshot',
  'absence-secondary-permissions',
  'rams-assignment-summary',
  'pending-absence-count',
  'absences',
  'absence-summary',
  'absence-reasons',
  'absence-reasons-all',
  'profiles',
  'projects-manage',
  'timesheets',
  'inspections',
  'maintenance',
  'customers',
  'quotes',
  'workshop-tasks',
  'notifications',
] as const;
const AUTH_RESUME_REFRESH_DEBOUNCE_MS = 800;
const BACKGROUND_AUTH_REFRESH_COOLDOWN_MS = 30_000;

const AuthContext = createContext<AuthContextValue | null>(null);

function buildSyntheticUser(payload: ClientAuthSessionResponse): User | null {
  if (!payload.user?.id) {
    return null;
  }

  return {
    id: payload.user.id,
    email: payload.user.email || undefined,
    app_metadata: {
      provider: 'supabase_ssr',
      providers: ['supabase'],
    },
    user_metadata: {},
    aud: 'authenticated',
    created_at: new Date().toISOString(),
  } as User;
}

function getCurrentPath(): string {
  if (typeof window === 'undefined') {
    return '/';
  }

  return `${window.location.pathname}${window.location.search}`;
}

function buildLoginRedirectUrl(): string {
  if (typeof window === 'undefined') {
    return '/login';
  }

  const url = new URL('/login', window.location.origin);
  const currentPath = getCurrentPath();

  if (!isPublicBrowserPath(currentPath)) {
    url.searchParams.set('redirect', currentPath);
  }

  return url.toString();
}

function buildAuthenticatedRedirectUrl(payload: ClientAuthSessionResponse): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const currentUrl = new URL(window.location.href);
  const currentPath = getCurrentPath();
  const mustChangePassword =
    typeof payload.profile === 'object' &&
    payload.profile !== null &&
    'must_change_password' in payload.profile &&
    (payload.profile as { must_change_password?: unknown }).must_change_password === true;

  if (currentPath.startsWith('/login')) {
    if (mustChangePassword) {
      return '/change-password';
    }

    const redirectTarget = currentUrl.searchParams.get('redirect');
    if (isSafeInternalRedirectTarget(redirectTarget)) {
      return redirectTarget;
    }

    return '/dashboard';
  }

  if (currentPath.startsWith('/change-password') && !mustChangePassword) {
    return '/dashboard';
  }

  return null;
}

function isAuthScopedQueryKey(queryKey: readonly unknown[]): boolean {
  const firstKey = queryKey[0];
  return typeof firstKey === 'string' && AUTH_SCOPED_QUERY_KEYS.includes(firstKey as (typeof AUTH_SCOPED_QUERY_KEYS)[number]);
}

export function AuthProvider({ children }: AuthProviderProps) {
  const queryClient = useQueryClient();
  const previousUserIdRef = useRef<string | null>(null);
  const sessionSnapshotRef = useRef<AuthSessionSnapshot>(getUnauthenticatedSessionSnapshot());
  const redirectInProgressRef = useRef<'login' | null>(null);
  const recoveryPromiseRef = useRef<Promise<boolean> | null>(null);
  const lastBackgroundRefreshAtRef = useRef(0);
  const pendingResumeRefreshTimeoutRef = useRef<number | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [effectiveRole, setEffectiveRole] = useState<EffectiveRole | null>(null);
  const [effectiveRoleLoading, setEffectiveRoleLoading] = useState(false);
  const [supabase, setSupabase] = useState<BrowserSupabaseClient | null>(null);
  const [viewAsSelection, setViewAsSelection] = useState<ViewAsSelection>({ roleId: '', teamId: '' });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    setSupabase(createClient());
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const syncViewAsSelection = () => {
      setViewAsSelection(getViewAsSelection());
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'viewAsRoleId' || event.key === 'viewAsTeamId') {
        syncViewAsSelection();
      }
    };

    syncViewAsSelection();
    window.addEventListener('storage', handleStorage);
    window.addEventListener(VIEW_AS_CHANGE_EVENT, syncViewAsSelection);

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(VIEW_AS_CHANGE_EVENT, syncViewAsSelection);
    };
  }, []);

  const clearLocalAuthState = useCallback((options?: { clearRoleCache?: boolean; clearViewAs?: boolean }) => {
    const activeUserId = previousUserIdRef.current;

    if (options?.clearRoleCache !== false && activeUserId) {
      localStorage.removeItem(`role_cache_${activeUserId}`);
    }

    if (options?.clearViewAs !== false) {
      clearViewAsSelection();
    }

    localStorage.removeItem('rememberMe');
    invalidateCachedDataToken();
    previousUserIdRef.current = null;
    sessionSnapshotRef.current = getUnauthenticatedSessionSnapshot();
    setUser(null);
    setProfile(null);
    setEffectiveRole(null);
    setEffectiveRoleLoading(false);
  }, []);

  const invalidateAuthScopedQueries = useCallback(async () => {
    await queryClient.invalidateQueries({
      predicate: (query) => isAuthScopedQueryKey(query.queryKey),
    });
  }, [queryClient]);

  const redirectToLogin = useCallback(async () => {
    if (typeof window === 'undefined') {
      return;
    }

    const currentPath = getCurrentPath();
    if (isPublicBrowserPath(currentPath) || redirectInProgressRef.current === 'login') {
      return;
    }

    redirectInProgressRef.current = 'login';
    clearLocalAuthState();

    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    }).catch(() => undefined);

    broadcastAuthStateChange('signed_out');
    window.location.replace(buildLoginRedirectUrl());
  }, [clearLocalAuthState]);

  const applySessionPayload = useCallback((payload: ClientAuthSessionResponse) => {
    setUser(buildSyntheticUser(payload));
    setProfile(payload.profile ? ({ ...payload.profile } as Profile) : null);
  }, []);

  const onAuthTransition = useCallback(async (
    nextSnapshot: AuthSessionSnapshot,
    reason: AuthTransitionReason
  ) => {
    const previousSnapshot = sessionSnapshotRef.current;
    const transition = getSessionTransition(previousSnapshot, nextSnapshot);
    sessionSnapshotRef.current = nextSnapshot;
    previousUserIdRef.current = nextSnapshot.userId;

    if (!transition.changed) {
      return transition;
    }

    if (transition.userChanged && previousSnapshot?.userId) {
      clearViewAsSelection();
      localStorage.removeItem(`role_cache_${previousSnapshot.userId}`);
    }

    if (transition.shouldInvalidateToken) {
      invalidateCachedDataToken();
    }

    if (
      transition.authChanged ||
      transition.userChanged ||
      transition.profileChanged
    ) {
      await invalidateAuthScopedQueries();
    }

    if (reason === 'sign_out' || reason === 'sign_in') {
      queryClient.invalidateQueries({ queryKey: ['permission-snapshot'] }).catch(() => undefined);
    }

    return transition;
  }, [invalidateAuthScopedQueries, queryClient]);

  const loadAuthSession = useCallback(async (options?: { silent?: boolean; reason?: AuthTransitionReason }) => {
    const reason = options?.reason ?? 'manual';
    const result = await loadClientAuthSession();

    if (result.status === 'authenticated' && result.payload) {
      redirectInProgressRef.current = null;
      await onAuthTransition(buildSessionSnapshot(result.payload), reason);
      applySessionPayload(result.payload);
      setLoading(false);
      const redirectUrl = buildAuthenticatedRedirectUrl(result.payload);
      if (redirectUrl) {
        window.location.replace(redirectUrl);
      }
      return result;
    }

    if (result.status === 'unauthenticated') {
      if (shouldDeferUnauthenticatedHandling(reason, { silent: options?.silent })) {
        setLoading(false);
        return result;
      }

      await onAuthTransition(getUnauthenticatedSessionSnapshot(), reason);
      clearLocalAuthState();
      setLoading(false);
      void redirectToLogin();
      return result;
    }

    setLoading(false);
    return result;
  }, [applySessionPayload, clearLocalAuthState, onAuthTransition, redirectToLogin]);

  const requestBackgroundAuthRefresh = useCallback(async (
    reason: Extract<AuthTransitionReason, 'focus' | 'visibility' | 'online' | 'interval'>
  ) => {
    if (getClientServiceOutage()) {
      return null;
    }

    const now = Date.now();
    if (now - lastBackgroundRefreshAtRef.current < BACKGROUND_AUTH_REFRESH_COOLDOWN_MS) {
      return null;
    }

    lastBackgroundRefreshAtRef.current = now;
    return loadAuthSession({ silent: true, reason });
  }, [loadAuthSession]);

  const scheduleResumeAuthRefresh = useCallback((
    reason: Extract<AuthTransitionReason, 'focus' | 'visibility'>
  ) => {
    if (typeof window === 'undefined') {
      return;
    }

    if (pendingResumeRefreshTimeoutRef.current !== null) {
      window.clearTimeout(pendingResumeRefreshTimeoutRef.current);
    }

    pendingResumeRefreshTimeoutRef.current = window.setTimeout(() => {
      pendingResumeRefreshTimeoutRef.current = null;
      void requestBackgroundAuthRefresh(reason);
    }, AUTH_RESUME_REFRESH_DEBOUNCE_MS);
  }, [requestBackgroundAuthRefresh]);

  useEffect(() => {
    clearRetiredAccountSwitchClientState();
    void loadAuthSession({ reason: 'initial_load' });

    const unsubscribe = subscribeToAuthStateChange(() => {
      void loadAuthSession({ silent: true, reason: 'broadcast' });
    });

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        scheduleResumeAuthRefresh('visibility');
      }
    };

    const handleFocus = () => {
      scheduleResumeAuthRefresh('focus');
    };

    const handleOnline = () => {
      void requestBackgroundAuthRefresh('online').then((result) => {
        if (result?.status === 'authenticated') {
          void invalidateAuthScopedQueries();
        }
      });
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('online', handleOnline);

    return () => {
      unsubscribe();
      if (pendingResumeRefreshTimeoutRef.current !== null) {
        window.clearTimeout(pendingResumeRefreshTimeoutRef.current);
        pendingResumeRefreshTimeoutRef.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('online', handleOnline);
    };
  }, [invalidateAuthScopedQueries, loadAuthSession, requestBackgroundAuthRefresh, scheduleResumeAuthRefresh]);

  useEffect(() => {
    if (!user || !profile) return;

    const storageKey = `role_cache_${user.id}`;
    const cachedRoleId = localStorage.getItem(storageKey);
    const currentRoleId = profile.role?.name || '';

    if (cachedRoleId && cachedRoleId !== currentRoleId) {
      localStorage.removeItem(storageKey);

      if (typeof window !== 'undefined') {
        import('sonner').then(({ toast }) => {
          toast.info('Account Updated', {
            description: 'Your account permissions have been updated. Please log in again to continue.',
            duration: 5000,
          });
        });
      }

      fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      }).finally(() => {
        void onAuthTransition(getUnauthenticatedSessionSnapshot(), 'sign_out').finally(() => {
          clearLocalAuthState();
          broadcastAuthStateChange('signed_out');
          window.location.href = '/login';
        });
      });
    } else if (!cachedRoleId) {
      localStorage.setItem(storageKey, currentRoleId);
    }
  }, [clearLocalAuthState, onAuthTransition, profile, user]);

  useEffect(() => {
    if (!user) return;

    const interval = setInterval(() => {
      void requestBackgroundAuthRefresh('interval');
    }, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, [requestBackgroundAuthRefresh, user]);

  useEffect(() => {
    const { roleId: viewAsRoleId, teamId: viewAsTeamId } = viewAsSelection;
    const isActualSuper =
      profile?.super_admin === true || profile?.role?.is_super_admin === true;

    if ((!viewAsRoleId && !viewAsTeamId) || !isActualSuper) {
      setEffectiveRole(null);
      setEffectiveRoleLoading(false);
      return;
    }

    let cancelled = false;
    setEffectiveRoleLoading(true);

    async function fetchEffectiveRole() {
      try {
        let nextRole: EffectiveRole | null =
          profile?.role
            ? {
                name: profile.role.name,
                display_name: profile.role.display_name,
                role_class: profile.role.role_class,
                is_manager_admin: profile.role.is_manager_admin,
                is_super_admin: profile.role.is_super_admin,
                team_id: profile.team_id,
                team_name: null,
              }
            : null;

        const response = await fetch('/api/superadmin/view-as/options', { cache: 'no-store' });
        const data = await response.json() as {
          roles?: ViewAsRoleOption[];
          teams?: ViewAsTeamOption[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(data.error || 'Failed to load view-as metadata');
        }

        if (viewAsRoleId) {
          const selectedRole = (data.roles || []).find((role) => role.id === viewAsRoleId);
          if (selectedRole) {
            nextRole = {
              name: selectedRole.name,
              display_name: selectedRole.display_name,
              role_class: selectedRole.role_class,
              is_manager_admin: selectedRole.is_manager_admin,
              is_super_admin: selectedRole.is_super_admin,
              team_id: nextRole?.team_id ?? profile?.team_id ?? null,
              team_name: null,
            };
          }
        }

        if (viewAsTeamId) {
          const selectedTeam = (data.teams || []).find((team) => team.id === viewAsTeamId);
          if (selectedTeam) {
            nextRole = {
              ...(nextRole ?? {
                name: profile?.role?.name || '',
                display_name: profile?.role?.display_name || '',
                role_class: profile?.role?.role_class,
                is_manager_admin: profile?.role?.is_manager_admin || false,
                is_super_admin: profile?.role?.is_super_admin || false,
              }),
              team_id: selectedTeam.id,
              team_name: selectedTeam.name,
            };
          }
        }

        if (!cancelled) {
          setEffectiveRole(nextRole);
        }
      } catch {
        if (!cancelled) {
          setEffectiveRole(null);
        }
      } finally {
        if (!cancelled) {
          setEffectiveRoleLoading(false);
        }
      }
    }

    void fetchEffectiveRole();

    return () => {
      cancelled = true;
    };
  }, [profile, viewAsSelection]);

  useEffect(() => installGlobalAuthAwareFetch(), []);

  const forceAuthRedirect = useCallback(async (statusCode?: number | null) => {
    void statusCode;
    await redirectToLogin();
  }, [redirectToLogin]);

  const recoverFromAuthFailure = useCallback(async (options?: AuthRecoveryOptions) => {
    if (recoveryPromiseRef.current) {
      return recoveryPromiseRef.current;
    }

    recoveryPromiseRef.current = (async () => {
      invalidateCachedDataToken();
      const result = await loadAuthSession({ silent: true, reason: 'recover' });

      if (result.status === 'authenticated') {
        return true;
      }

      await forceAuthRedirect(options?.statusCode ?? result.responseStatus);
      return false;
    })().finally(() => {
      recoveryPromiseRef.current = null;
    });

    return recoveryPromiseRef.current;
  }, [forceAuthRedirect, loadAuthSession]);

  useEffect(() => registerAuthRecoveryHandlers({
    recoverFromAuthFailure,
    forceAuthRedirect,
  }), [forceAuthRedirect, recoverFromAuthFailure]);

  const signIn = useCallback(async (
    email: string,
    password: string,
    options?: {
      rememberMe?: boolean;
      deviceId?: string | null;
      deviceLabel?: string | null;
      deferRedirect?: boolean;
    }
  ) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password,
        rememberMe: options?.rememberMe === true,
        deviceId: options?.deviceId || null,
        deviceLabel: options?.deviceLabel || null,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      user?: { id: string; email: string | null };
      profile?: { id: string; must_change_password?: boolean | null };
    };

    if (!response.ok) {
      return {
        data: null,
        error: { message: payload.error || 'Login failed' },
      };
    }

    broadcastAuthStateChange('signed_in');
    if (!options?.deferRedirect) {
      await loadAuthSession({ silent: true, reason: 'sign_in' });
    }
    return {
      data: payload,
      error: null,
    };
  }, [loadAuthSession]);

  const signOut = useCallback(async () => {
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      return { error: { message: payload.error || 'Logout failed' } };
    }

    await onAuthTransition(getUnauthenticatedSessionSnapshot(), 'sign_out');
    clearLocalAuthState();
    broadcastAuthStateChange('signed_out');
    redirectInProgressRef.current = null;
    if (typeof window !== 'undefined') {
      window.location.replace('/login');
    }
    return { error: null };
  }, [clearLocalAuthState, onAuthTransition]);

  const signUp = useCallback(async (
    email: string,
    password: string,
    fullName: string,
    employeeId?: string
  ) => {
    if (!supabase) {
      return { data: null, error: { message: 'Unable to initialize authentication client' } };
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          employee_id: employeeId,
        },
      },
    });

    return {
      data,
      error: error ? { message: error.message || 'Unable to sign up' } : null,
    };
  }, [supabase]);

  const isActualSuperAdmin =
    profile?.super_admin === true || profile?.role?.is_super_admin === true;
  const hasActiveViewAsSelection =
    isActualSuperAdmin && (viewAsSelection.roleId !== '' || viewAsSelection.teamId !== '');
  const isViewingAs = hasActiveViewAsSelection;
  const roleForFlags = isViewingAs ? effectiveRole : profile?.role ?? null;

  const value = useMemo<AuthContextValue>(() => ({
    user,
    profile,
    loading: loading || effectiveRoleLoading,
    signIn,
    signOut,
    signUp,
    isAdmin: isAdminRole(roleForFlags),
    isManager: roleForFlags?.role_class === 'manager' || false,
    isSupervisor: (roleForFlags?.name || '').trim().toLowerCase() === 'supervisor',
    isEmployee: roleForFlags?.role_class === 'employee' || false,
    isSuperAdmin: isViewingAs ? (roleForFlags?.is_super_admin || false) : isActualSuperAdmin,
    isActualSuperAdmin,
    isViewingAs,
    effectiveRole,
    refreshSession: () => loadAuthSession({ silent: true, reason: 'manual' }),
    recoverFromAuthFailure,
    forceAuthRedirect,
  }), [
    effectiveRole,
    effectiveRoleLoading,
    forceAuthRedirect,
    isActualSuperAdmin,
    isViewingAs,
    loadAuthSession,
    loading,
    profile,
    recoverFromAuthFailure,
    roleForFlags,
    signIn,
    signOut,
    signUp,
    user,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useOptionalAuth(): AuthContextValue | null {
  return useContext(AuthContext);
}

export function useAuth(): AuthContextValue {
  const context = useOptionalAuth();
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
}
