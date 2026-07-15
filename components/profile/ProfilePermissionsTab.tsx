'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ProfileOverviewPayload } from '@/types/profile';
import type { ModuleName } from '@/types/roles';

interface ProfilePermissionsTabProps {
  permissionSummary: ProfileOverviewPayload['permission_summary'];
}

function getAccessBadgeClass(accessLevel: number): string {
  if (accessLevel >= 5) return 'border-red-500/40 bg-red-500/15 text-red-300';
  if (accessLevel >= 4) return 'border-amber-500/40 bg-amber-500/15 text-amber-300';
  if (accessLevel >= 3) return 'border-sky-500/40 bg-sky-500/15 text-sky-300';
  if (accessLevel >= 2) return 'border-green-500/40 bg-green-500/15 text-green-300';
  return 'border-slate-500/40 bg-slate-500/15 text-slate-200';
}

function getPermissionTileClasses(moduleName: string): {
  card: string;
  cardHover: string;
  thumbnail: string;
} {
  const normalized = moduleName.toLowerCase();

  if (normalized.includes('timesheet')) {
    return {
      card: 'border-[hsl(var(--timesheet-primary)/0.35)] bg-[hsl(var(--timesheet-primary)/0.10)]',
      cardHover: 'hover:bg-[hsl(var(--timesheet-primary)/0.16)]',
      thumbnail: 'border-[hsl(var(--timesheet-primary)/0.35)] bg-[hsl(var(--timesheet-primary)/0.40)] text-timesheet',
    };
  }
  if (normalized.includes('inspection') || normalized.includes('van') || normalized.includes('hgv')) {
    return {
      card: 'border-[hsl(var(--inspection-primary)/0.35)] bg-[hsl(var(--inspection-primary)/0.10)]',
      cardHover: 'hover:bg-[hsl(var(--inspection-primary)/0.16)]',
      thumbnail: 'border-[hsl(var(--inspection-primary)/0.35)] bg-[hsl(var(--inspection-primary)/0.40)] text-inspection',
    };
  }
  if (normalized.includes('plant')) {
    return {
      card: 'border-[hsl(var(--plant-inspection-primary)/0.35)] bg-[hsl(var(--plant-inspection-primary)/0.10)]',
      cardHover: 'hover:bg-[hsl(var(--plant-inspection-primary)/0.16)]',
      thumbnail: 'border-[hsl(var(--plant-inspection-primary)/0.35)] bg-[hsl(var(--plant-inspection-primary)/0.40)] text-plant-inspection',
    };
  }
  if (normalized.includes('project') || normalized.includes('rams')) {
    return {
      card: 'border-[hsl(var(--rams-primary)/0.35)] bg-[hsl(var(--rams-primary)/0.10)]',
      cardHover: 'hover:bg-[hsl(var(--rams-primary)/0.16)]',
      thumbnail: 'border-[hsl(var(--rams-primary)/0.35)] bg-[hsl(var(--rams-primary)/0.40)] text-rams',
    };
  }
  if (normalized.includes('absence') || normalized.includes('leave')) {
    return {
      card: 'border-[hsl(var(--absence-primary)/0.35)] bg-[hsl(var(--absence-primary)/0.10)]',
      cardHover: 'hover:bg-[hsl(var(--absence-primary)/0.16)]',
      thumbnail: 'border-[hsl(var(--absence-primary)/0.35)] bg-[hsl(var(--absence-primary)/0.40)] text-absence',
    };
  }
  if (normalized.includes('maintenance') || normalized.includes('fleet')) {
    return {
      card: 'border-[hsl(var(--maintenance-primary)/0.35)] bg-[hsl(var(--maintenance-primary)/0.10)]',
      cardHover: 'hover:bg-[hsl(var(--maintenance-primary)/0.16)]',
      thumbnail: 'border-[hsl(var(--maintenance-primary)/0.35)] bg-[hsl(var(--maintenance-primary)/0.40)] text-maintenance',
    };
  }
  if (normalized.includes('inventory')) {
    return {
      card: 'border-[hsl(var(--inventory-primary)/0.35)] bg-[hsl(var(--inventory-primary)/0.10)]',
      cardHover: 'hover:bg-[hsl(var(--inventory-primary)/0.16)]',
      thumbnail: 'border-[hsl(var(--inventory-primary)/0.35)] bg-[hsl(var(--inventory-primary)/0.40)] text-inventory',
    };
  }
  if (normalized.includes('workshop')) {
    return {
      card: 'border-[hsl(var(--workshop-primary)/0.35)] bg-[hsl(var(--workshop-primary)/0.10)]',
      cardHover: 'hover:bg-[hsl(var(--workshop-primary)/0.16)]',
      thumbnail: 'border-[hsl(var(--workshop-primary)/0.35)] bg-[hsl(var(--workshop-primary)/0.40)] text-workshop',
    };
  }

  return {
    card: 'border-[hsl(var(--brand-yellow)/0.35)] bg-[hsl(var(--brand-yellow)/0.10)]',
    cardHover: 'hover:bg-[hsl(var(--brand-yellow)/0.16)]',
    thumbnail: 'border-[hsl(var(--brand-yellow)/0.35)] bg-[hsl(var(--brand-yellow)/0.40)] text-brand-yellow',
  };
}

function getPermissionModuleHref(moduleName: ModuleName): string {
  const moduleHrefs: Partial<Record<ModuleName, string>> = {
    timesheets: '/timesheets',
    inspections: '/van-inspections',
    'plant-inspections': '/plant-inspections',
    'hgv-inspections': '/hgv-inspections',
    rams: '/projects',
    absence: '/absence',
    maintenance: '/maintenance',
    'admin-vans': '/fleet',
    'toolbox-talks': '/toolbox-talks',
    'workshop-tasks': '/workshop-tasks',
    approvals: '/approvals',
    actions: '/actions',
    reports: '/reports',
    suggestions: '/suggestions/manage',
    'faq-editor': '/admin/faq',
    'error-reports': '/admin/errors/manage',
    'admin-users': '/admin/users',
    'admin-settings': '/admin/settings',
    customers: '/customers',
    quotes: '/quotes',
    inventory: '/inventory',
    reminders: '/reminders',
    scheduling: '/scheduling/my',
  };

  return moduleHrefs[moduleName] || '/dashboard';
}

function getPermissionTileInitials(label: string): string {
  if (label.toLowerCase().includes('maintenance') && label.toLowerCase().includes('service')) {
    return 'MS';
  }

  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'M';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase();
}

export function ProfilePermissionsTab({ permissionSummary }: ProfilePermissionsTabProps) {
  const modules = permissionSummary.modules;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>My Module Access</CardTitle>
          <CardDescription>
            Your access is calculated from the user-based permissions matrix and your effective team.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-border bg-slate-900/30 p-4 sm:p-3">
            <p className="text-sm uppercase tracking-wide text-muted-foreground sm:text-xs">Effective team</p>
            <p className="mt-1 text-base font-medium text-foreground sm:text-sm">
              {permissionSummary.effective_team_name || 'No team context'}
            </p>
          </div>

          {modules.length === 0 ? (
            <p className="text-base text-muted-foreground sm:text-sm">No module access has been assigned yet.</p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {modules.map((module) => {
                const tileClasses = getPermissionTileClasses(module.module_name);
                const href = getPermissionModuleHref(module.module_name);
                return (
                <Link
                  key={module.module_name}
                  href={href}
                  className={`block rounded-xl border p-4 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-yellow focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${tileClasses.card} ${tileClasses.cardHover}`}
                >
                  <div className="flex gap-3">
                    <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border text-lg font-bold shadow-inner ${tileClasses.thumbnail}`}>
                      {getPermissionTileInitials(module.display_name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                        <p className="text-lg font-semibold leading-tight text-foreground sm:text-sm">{module.display_name}</p>
                        <Badge variant="outline" className={`${getAccessBadgeClass(module.access_level)} px-2.5 py-1 text-sm sm:px-2 sm:py-0.5 sm:text-xs`}>
                          {module.access_label}
                        </Badge>
                      </div>
                      <p className="text-sm text-slate-300 sm:text-xs">{module.description}</p>
                      {module.requires_sensitive_pin ? (
                        <Badge variant="outline" className="mt-3 border-brand-yellow/50 bg-brand-yellow/10 px-2.5 py-1 text-sm text-brand-yellow sm:px-2 sm:py-0.5 sm:text-xs">
                          Sensitive PIN required
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cover While You Are Away</CardTitle>
          <CardDescription className="text-base sm:text-sm">Planned permissions handover workflow</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-base text-muted-foreground sm:text-sm">
            A future update will let users nominate a suitable colleague to cover key responsibilities
            during leave or other planned absence. While active, the nominated person will receive
            time-limited access that reflects the responsibilities being covered, then automatically
            return to their normal permissions when the cover period ends.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
