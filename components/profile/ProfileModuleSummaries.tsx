'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Clipboard, Clock, ExternalLink, FileText } from 'lucide-react';
import type {
  ProfileAbsenceSummaryItem,
  ProfileAnnualLeaveSummary,
  ProfileInspectionSummaryItem,
  ProfileTimesheetSummaryItem,
} from '@/types/profile';

interface ProfileModuleSummariesProps {
  timesheets: ProfileTimesheetSummaryItem[];
  inspections: ProfileInspectionSummaryItem[];
  absences: ProfileAbsenceSummaryItem[];
  annualLeaveSummary: ProfileAnnualLeaveSummary;
}

const summaryItemClass =
  'rounded-md border border-border bg-slate-900/30 p-2.5';
const summaryItemHoverClass = 'transition-colors hover:bg-slate-800/40';
const summaryCtaClass =
  'border-brand-yellow/50 text-brand-yellow hover:bg-brand-yellow hover:text-slate-900 hover:border-brand-yellow';

function getTimesheetStatusBadgeClass(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === 'submitted') return 'border-amber-500/40 bg-amber-500/15 text-amber-300';
  if (normalized === 'approved') return 'border-green-500/40 bg-green-500/15 text-green-300';
  if (normalized === 'rejected') return 'border-red-500/40 bg-red-500/15 text-red-300';
  if (normalized === 'processed' || normalized === 'adjusted') {
    return 'border-blue-500/40 bg-blue-500/15 text-blue-300';
  }
  return 'border-slate-500/40 bg-slate-500/15 text-slate-200';
}

function getInspectionStatusBadgeClass(inspection: ProfileInspectionSummaryItem): string {
  const normalized = inspection.status.toLowerCase();
  if (normalized === 'draft') return 'border-slate-500/40 bg-slate-500/15 text-slate-200';
  if (inspection.inspectionType === 'plant') {
    return 'border-plant-inspection/40 bg-plant-inspection/10 text-plant-inspection';
  }
  return 'border-inspection/40 bg-inspection/10 text-inspection';
}

function getAbsenceStatusBadgeClass(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === 'approved') return 'border-green-500/40 bg-green-500/15 text-green-300';
  if (normalized === 'processed') return 'border-blue-500/40 bg-blue-500/15 text-blue-300';
  if (normalized === 'pending') return 'border-amber-500/40 bg-amber-500/15 text-amber-300';
  if (normalized === 'rejected' || normalized === 'cancelled') {
    return 'border-red-500/40 bg-red-500/15 text-red-300';
  }
  return 'border-slate-500/40 bg-slate-500/15 text-slate-200';
}

function formatDate(dateValue: string): string {
  return new Date(`${dateValue}T00:00:00`).toLocaleDateString('en-GB');
}

function formatStatusLabel(status: string): string {
  return status
    .split('_')
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
}

function getTimesheetHref(timesheet: ProfileTimesheetSummaryItem): string {
  if (timesheet.status === 'draft' || timesheet.status === 'rejected') {
    return `/timesheets/new?id=${timesheet.id}`;
  }
  return `/timesheets/${timesheet.id}`;
}

function getInspectionStatusIcon(inspection: ProfileInspectionSummaryItem) {
  const moduleColorClass =
    inspection.inspectionType === 'plant' ? 'text-plant-inspection' : 'text-inspection';
  const iconColorClass = inspection.has_inform_workshop_task
    ? moduleColorClass
    : inspection.has_reported_defect
      ? 'text-red-500'
      : 'text-green-500';

  if (inspection.status === 'submitted') {
    return <Clock className={`h-4 w-4 ${iconColorClass}`} />;
  }

  return <Clipboard className={`h-4 w-4 ${iconColorClass}`} />;
}

export function ProfileModuleSummaries({
  timesheets,
  inspections,
  absences,
  annualLeaveSummary,
}: ProfileModuleSummariesProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle>Recent Timesheets</CardTitle>
          <CardDescription>Latest 3 submissions</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {timesheets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent timesheets.</p>
          ) : (
            timesheets.map((timesheet) => (
              <Link
                key={timesheet.id}
                href={getTimesheetHref(timesheet)}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center justify-between ${summaryItemClass} ${summaryItemHoverClass}`}
              >
                <div className="space-y-0.5">
                  <p className="flex items-center gap-1.5 text-sm text-foreground">
                    <FileText className="h-4 w-4 text-timesheet" />
                    Week ending {formatDate(timesheet.week_ending)}
                  </p>
                </div>
                <Badge variant="outline" className={getTimesheetStatusBadgeClass(timesheet.status)}>
                  {formatStatusLabel(timesheet.status)}
                </Badge>
              </Link>
            ))
          )}
          <Button type="button" variant="outline" size="sm" className={summaryCtaClass} asChild>
            <Link href="/timesheets">View all timesheets</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Inspections</CardTitle>
          <CardDescription>Latest 3 checks across all vehicle types</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {inspections.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent inspections.</p>
          ) : (
            inspections.map((inspection) => (
              <Link
                key={`${inspection.inspectionType}-${inspection.id}`}
                href={inspection.href}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center justify-between ${summaryItemClass} ${summaryItemHoverClass}`}
              >
                <div className="space-y-0.5">
                  <p className="flex items-center gap-1.5 text-sm capitalize text-foreground">
                    {getInspectionStatusIcon(inspection)}
                    {inspection.inspectionType} inspection
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(inspection.inspection_date)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={getInspectionStatusBadgeClass(inspection)}>
                    {formatStatusLabel(inspection.status)}
                  </Badge>
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
              </Link>
            ))
          )}
          <div className="flex flex-wrap gap-3 text-sm">
            <Button type="button" variant="outline" size="sm" className={summaryCtaClass} asChild>
              <Link href="/van-inspections">Vans</Link>
            </Button>
            <Button type="button" variant="outline" size="sm" className={summaryCtaClass} asChild>
              <Link href="/plant-inspections">Plant</Link>
            </Button>
            <Button type="button" variant="outline" size="sm" className={summaryCtaClass} asChild>
              <Link href="/hgv-inspections">HGV</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Annual Leave & Absence</CardTitle>
          <CardDescription>Current financial year summary</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md border border-border p-2">
              <p className="text-xs text-muted-foreground">Allowance</p>
              <p className="text-base font-semibold">{annualLeaveSummary.allowance.toFixed(1)}</p>
            </div>
            <div className="rounded-md border border-border p-2">
              <p className="text-xs text-muted-foreground">Pending</p>
              <p className="text-base font-semibold">{annualLeaveSummary.pending_total.toFixed(1)}</p>
            </div>
            <div className="rounded-md border border-border p-2">
              <p className="text-xs text-muted-foreground">Remaining</p>
              <p className="text-base font-semibold">{annualLeaveSummary.remaining.toFixed(1)}</p>
            </div>
          </div>

          {absences.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent absence records.</p>
          ) : (
            absences.map((absence) => (
              <div
                key={absence.id}
                className="flex items-center justify-between rounded-md border border-border p-2.5"
              >
                <div>
                  <p className="text-sm text-foreground">{absence.reason_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(absence.date)}
                    {absence.end_date ? ` - ${formatDate(absence.end_date)}` : ''}
                  </p>
                </div>
                <Badge variant="outline" className={getAbsenceStatusBadgeClass(absence.status)}>
                  {formatStatusLabel(absence.status)}
                </Badge>
              </div>
            ))
          )}

          <Button type="button" variant="outline" size="sm" className={summaryCtaClass} asChild>
            <Link href="/absence">View absence calendar</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

