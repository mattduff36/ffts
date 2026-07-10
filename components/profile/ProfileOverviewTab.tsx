'use client';

import Image from 'next/image';
import { AlertTriangle, CalendarDays, ClipboardCheck, Crown, PlaneTakeoff, Truck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ProfileHelpShortcuts } from '@/components/profile/ProfileHelpShortcuts';
import type {
  ProfileAnnualLeaveSummary,
  ProfileIdentityPayload,
  ProfileManagerSummary,
  ProfileOverviewPayload,
  ProfilePermissionSummaryItem,
} from '@/types/profile';

interface ProfileOverviewTabProps {
  profile: ProfileIdentityPayload;
  managers: ProfileManagerSummary[];
  annualLeaveSummary: ProfileAnnualLeaveSummary;
  permissionModules: ProfilePermissionSummaryItem[];
  helpShortcuts: ProfileOverviewPayload['help_shortcuts'];
  currentFleetAssignment: ProfileOverviewPayload['current_fleet_assignment'];
}

function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts[parts.length - 1].slice(0, 1)}`.toUpperCase();
}

function formatManagerSource(source: ProfileManagerSummary['source']): string {
  if (source === 'line_manager') return 'Line manager';
  if (source === 'secondary_manager') return 'Secondary manager';
  return 'Team manager';
}

const leaveStatTileClassName = 'min-w-0 rounded-lg border border-border p-3';

function getRoleBadgeProps(profile: ProfileIdentityPayload): {
  className: string;
} {
  const roleLabel = `${profile.role?.display_name || ''} ${profile.role?.name || ''}`.toLowerCase();
  if (profile.role?.role_class === 'admin' || roleLabel.includes('admin')) {
    return {
      className: 'border-red-500/40 bg-red-500/15 text-red-300 hover:bg-red-500/20',
    };
  }
  if (roleLabel.includes('supervisor')) {
    return {
      className: 'border-sky-400/50 bg-sky-500/20 text-sky-200 hover:bg-sky-500/30',
    };
  }
  if (profile.role?.role_class === 'manager' || roleLabel.includes('manager')) {
    return {
      className: 'border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/20',
    };
  }
  return {
    className: 'border-slate-500/40 bg-slate-500/15 text-slate-200 hover:bg-slate-500/20',
  };
}

export function ProfileOverviewTab({
  profile,
  managers,
  annualLeaveSummary,
  permissionModules,
  helpShortcuts,
  currentFleetAssignment,
}: ProfileOverviewTabProps) {
  const initials = getInitials(profile.full_name);
  const roleBadge = getRoleBadgeProps(profile);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(320px,1fr)_minmax(0,2fr)]">
        <Card className="hidden overflow-hidden border-border bg-slate-900/70 xl:block">
          <CardContent className="p-4">
            <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-border bg-slate-950/60">
              {profile.avatar_url ? (
                <Image
                  src={profile.avatar_url}
                  alt={`${profile.full_name} avatar`}
                  fill
                  unoptimized
                  loader={({ src }) => src}
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-800 to-slate-950 text-7xl font-semibold text-brand-yellow">
                  {initials}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="overflow-hidden border-border bg-gradient-to-br from-slate-900 via-slate-900 to-brand-yellow/10">
            <CardContent className="p-5">
              <div className="hidden flex-col gap-4 xl:flex xl:flex-row xl:items-start xl:justify-between">
                <div className="space-y-3">
                  <Badge variant="outline" className={roleBadge.className}>
                    <Crown className="mr-1 h-3.5 w-3.5" />
                    {profile.role?.display_name || 'No role assigned'}
                  </Badge>
                  <div>
                    <h2 className="text-3xl font-bold text-foreground">{profile.full_name}</h2>
                    <p className="text-sm text-muted-foreground">
                      {profile.team?.name || 'Unassigned team'} · Employee ID {profile.employee_id || 'N/A'}
                    </p>
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-slate-950/40 p-3 text-right">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Active modules</p>
                  <p className="text-2xl font-semibold text-brand-yellow">{permissionModules.length}</p>
                </div>
              </div>

              <div className="mt-4 rounded-lg border border-border bg-slate-950/40 p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Truck className="h-4 w-4 text-sky-300" />
                  Current fleet asset
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {currentFleetAssignment
                    ? `${currentFleetAssignment.asset_type.toUpperCase()} ${[
                      currentFleetAssignment.asset_label,
                      currentFleetAssignment.asset_nickname,
                    ].filter(Boolean).join(' - ') || currentFleetAssignment.asset_id}`
                    : 'No current fleet asset assignment'}
                </p>
              </div>

              <div className="grid grid-cols-[repeat(auto-fit,minmax(6.25rem,1fr))] gap-3 sm:grid-cols-1 md:grid-cols-3 xl:mt-4">
                <div className={`${leaveStatTileClassName} bg-[hsl(var(--absence-primary)/0.10)]`}>
                  <CalendarDays className="mb-2 h-5 w-5 text-absence" />
                  <p className="truncate whitespace-nowrap text-xs uppercase tracking-wide text-muted-foreground">Leave Remaining</p>
                  <p className="text-4xl font-semibold text-foreground sm:text-2xl">{annualLeaveSummary.remaining.toFixed(1)}</p>
                </div>
                <div className={`${leaveStatTileClassName} bg-amber-500/10`}>
                  <PlaneTakeoff className="mb-2 h-5 w-5 text-amber-300" />
                  <p className="truncate whitespace-nowrap text-xs uppercase tracking-wide text-muted-foreground">Pending leave</p>
                  <p className="text-4xl font-semibold text-foreground sm:text-2xl">{annualLeaveSummary.pending_total.toFixed(1)}</p>
                </div>
                <div className={`${leaveStatTileClassName} bg-green-500/10`}>
                  <ClipboardCheck className="mb-2 h-5 w-5 text-green-300" />
                  <p className="truncate whitespace-nowrap text-xs uppercase tracking-wide text-muted-foreground">Leave taken</p>
                  <p className="text-4xl font-semibold text-foreground sm:text-2xl">{annualLeaveSummary.approved_taken.toFixed(1)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardContent className="p-4 sm:p-3">
                <p className="text-sm uppercase tracking-wide text-muted-foreground sm:text-xs">Team manager(s)</p>
                {managers.length > 0 ? (
                  <div className="mt-3 space-y-2 sm:mt-2">
                    {managers.map((manager) => (
                      <div key={`${manager.source}-${manager.id}`} className="rounded-lg border border-border bg-slate-900/30 p-3 sm:p-2.5">
                        <p className="text-base font-medium text-foreground sm:text-sm">{manager.full_name}</p>
                        <p className="text-sm text-muted-foreground sm:text-xs">{formatManagerSource(manager.source)}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 flex items-center gap-2 text-base text-muted-foreground sm:gap-1.5 sm:text-sm">
                    <AlertTriangle className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                    No manager assigned
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 sm:p-3">
                <p className="text-sm uppercase tracking-wide text-muted-foreground sm:text-xs">Training</p>
                <div className="mt-3 rounded-lg border border-brand-yellow/40 bg-brand-yellow/10 p-4 sm:mt-2 sm:p-3">
                  <ClipboardCheck className="mb-2 h-6 w-6 text-brand-yellow sm:h-5 sm:w-5" />
                  <p className="text-base font-medium text-foreground sm:text-sm">Training info</p>
                  <p className="text-sm text-muted-foreground sm:text-xs">Coming soon...</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <ProfileHelpShortcuts helpShortcuts={helpShortcuts} />
    </div>
  );
}
