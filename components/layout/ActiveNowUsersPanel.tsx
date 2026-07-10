'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Clock3, Loader2, MapPin, RefreshCw, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { PanelLoader } from '@/components/ui/panel-loader';
import { useAuth } from '@/lib/hooks/useAuth';
import { fetchWithAuth } from '@/lib/utils/fetch-with-auth';

interface ActiveUserSummary {
  userId: string;
  fullName: string;
  lastVisitedAt: string;
  path: string;
  roleDisplayName: string | null;
  teamName: string | null;
}

interface ActiveUsersPayload {
  activeWindowMinutes: number;
  activeNowUsers: ActiveUserSummary[];
  recentUsers: ActiveUserSummary[];
  generatedAt: string;
}

interface ActiveNowUsersPanelProps {
  open: boolean;
}

const REFRESH_INTERVAL_MS = 30_000;
const ACTIVE_USERS_FETCH_ERROR_ID = 'superadmin-active-users-fetch-error';

function formatLastSeen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';

  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return 'Just now';
  if (diffMs < 60 * 60 * 1000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 24 * 60 * 60 * 1000) return `${Math.floor(diffMs / (60 * 60 * 1000))}h ago`;
  return date.toLocaleString('en-GB');
}

function formatPath(path: string): string {
  if (!path) return '/';
  return path.length > 44 ? `${path.slice(0, 44)}...` : path;
}

function UserList({ users }: { users: ActiveUserSummary[] }) {
  return (
    <div className="space-y-1.5">
      {users.map((user) => {
        const subtitle = [user.roleDisplayName, user.teamName].filter(Boolean).join(' - ') || 'No role/team';
        return (
          <div
            key={user.userId}
            className="rounded-md border border-slate-700 bg-slate-950/50 px-3 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-semibold text-slate-100">{user.fullName}</p>
              <span className="shrink-0 text-[11px] text-slate-400">{formatLastSeen(user.lastVisitedAt)}</span>
            </div>
            <p className="truncate text-[11px] text-slate-400">{subtitle}</p>
            <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{formatPath(user.path)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ActiveNowUsersPanel({ open }: ActiveNowUsersPanelProps) {
  const { profile, isSuperAdmin } = useAuth();
  const [payload, setPayload] = useState<ActiveUsersPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const canViewActiveUsers = open && Boolean(profile?.id) && isSuperAdmin;

  const fetchActiveUsers = useCallback(
    async (backgroundRefresh: boolean) => {
      if (!canViewActiveUsers) return;

      if (backgroundRefresh) setRefreshing(true);
      else setLoading(true);

      try {
        const response = await fetchWithAuth('/api/superadmin/active-users', { cache: 'no-store' });
        const data = (await response.json()) as Partial<ActiveUsersPayload> & { error?: string };
        if (!response.ok) {
          throw new Error(data.error || 'Failed to load active users');
        }

        setPayload({
          activeWindowMinutes: data.activeWindowMinutes || 5,
          activeNowUsers: Array.isArray(data.activeNowUsers) ? data.activeNowUsers : [],
          recentUsers: Array.isArray(data.recentUsers) ? data.recentUsers : [],
          generatedAt: typeof data.generatedAt === 'string' ? data.generatedAt : new Date().toISOString(),
        });
        setErrorMessage(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load active users';
        setErrorMessage(message);
        toast.error(message, { id: ACTIVE_USERS_FETCH_ERROR_ID });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [canViewActiveUsers]
  );

  useEffect(() => {
    if (!canViewActiveUsers) {
      setPayload(null);
      setLoading(false);
      setRefreshing(false);
      setErrorMessage(null);
      return;
    }
    void fetchActiveUsers(false);
  }, [canViewActiveUsers, fetchActiveUsers]);

  useEffect(() => {
    if (!canViewActiveUsers) return;
    const intervalId = window.setInterval(() => {
      void fetchActiveUsers(true);
    }, REFRESH_INTERVAL_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [canViewActiveUsers, fetchActiveUsers]);

  const activeUsers = useMemo(() => payload?.activeNowUsers || [], [payload?.activeNowUsers]);
  const recentUsers = useMemo(() => payload?.recentUsers || [], [payload?.recentUsers]);
  const activeWindowMinutes = payload?.activeWindowMinutes || 5;

  return (
    <div className="space-y-3 p-2 text-slate-200">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">Active Now</p>
          <p className="text-xs text-slate-400">
            Users active within the last {activeWindowMinutes} minutes.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-slate-300 hover:bg-slate-800 hover:text-white"
          onClick={() => void fetchActiveUsers(true)}
          title="Refresh active users"
        >
          {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      {loading && !payload ? (
        <PanelLoader message="Loading active users..." className="rounded-md border border-slate-700 bg-slate-950/40 py-8" />
      ) : null}

      {!loading && errorMessage && !payload ? (
        <div className="space-y-2 rounded-md border border-red-500/40 bg-red-500/10 p-3">
          <p className="text-sm text-red-300">{errorMessage}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="border-red-500/50 bg-transparent text-red-200 hover:bg-red-500/20"
            onClick={() => void fetchActiveUsers(false)}
          >
            Retry
          </Button>
        </div>
      ) : null}

      {payload ? (
        <>
          {activeUsers.length > 0 ? (
            <section className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-300">
                <Activity className="h-3.5 w-3.5" />
                Active now ({activeUsers.length})
              </div>
              <UserList users={activeUsers} />
            </section>
          ) : null}

          <section className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-300">
              <Clock3 className="h-3.5 w-3.5" />
              Last 5 active users
            </div>
            {recentUsers.length > 0 ? (
              <UserList users={recentUsers} />
            ) : (
              <div className="rounded-md border border-slate-700 bg-slate-950/40 py-6 text-center text-xs text-slate-400">
                <Users className="mx-auto mb-1 h-4 w-4 text-slate-500" />
                No recent activity found.
              </div>
            )}
          </section>

          <p className="text-[11px] text-slate-500">
            Last refreshed {formatLastSeen(payload.generatedAt)}.
          </p>
        </>
      ) : null}
    </div>
  );
}
