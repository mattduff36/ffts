'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Clipboard, Clock, ExternalLink, FileText, PackageSearch } from 'lucide-react';
import type {
  ProfileAbsenceSummaryItem,
  ProfileAnnualLeaveSummary,
  ProfileInspectionSummaryItem,
  ProfileProjectAssignmentSummaryItem,
  ProfileTimesheetSummaryItem,
} from '@/types/profile';

interface ProfileRecentSubmissionsTabProps {
  timesheets: ProfileTimesheetSummaryItem[];
  inspections: ProfileInspectionSummaryItem[];
  absences: ProfileAbsenceSummaryItem[];
  annualLeaveSummary: ProfileAnnualLeaveSummary;
  projectAssignments: ProfileProjectAssignmentSummaryItem[];
}

const summaryItemClass = 'min-h-16 rounded-lg border border-border bg-slate-900/30 p-4 sm:min-h-0 sm:rounded-md sm:p-2.5';
const summaryItemHoverClass = 'transition-colors hover:bg-slate-800/40';
const summaryCtaBaseClass =
  'min-h-12 rounded-lg bg-transparent text-base font-semibold sm:min-h-8 sm:text-xs';

const timesheetCtaClass =
  `${summaryCtaBaseClass} border-timesheet/50 text-timesheet hover:!border-timesheet hover:!bg-timesheet hover:!text-white`;
const inspectionCtaClass =
  `${summaryCtaBaseClass} border-inspection/50 text-inspection hover:!border-inspection hover:!bg-inspection hover:!text-white`;
const plantInspectionCtaClass =
  `${summaryCtaBaseClass} border-plant-inspection/50 text-plant-inspection hover:!border-plant-inspection hover:!bg-plant-inspection hover:!text-white`;
const hgvInspectionCtaClass =
  `${summaryCtaBaseClass} border-hgv-inspection/50 text-hgv-inspection hover:!border-hgv-inspection hover:!bg-hgv-inspection hover:!text-white`;
const absenceCtaClass =
  `${summaryCtaBaseClass} border-absence/50 text-absence hover:!border-absence hover:!bg-absence hover:!text-white`;
const projectsCtaClass =
  `${summaryCtaBaseClass} border-rams/50 text-rams hover:!border-rams hover:!bg-rams hover:!text-white`;

function formatDate(dateValue: string | null): string {
  if (!dateValue) return 'N/A';
  return new Date(`${dateValue.split('T')[0]}T00:00:00`).toLocaleDateString('en-GB');
}

function formatStatusLabel(status: string): string {
  return status
    .split('_')
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
}

function getModuleStatusBadgeClass(status: string, moduleClassName: string): string {
  const normalized = status.toLowerCase();
  if (normalized === 'draft') return 'border-slate-500/40 bg-slate-500/15 text-slate-200';
  if (normalized === 'rejected' || normalized === 'cancelled') {
    return 'border-red-500/40 bg-red-500/15 text-red-300';
  }
  return moduleClassName;
}

function getInspectionStatusBadgeClass(inspection: ProfileInspectionSummaryItem): string {
  if (inspection.inspectionType === 'plant') {
    return getModuleStatusBadgeClass(
      inspection.status,
      'border-plant-inspection/40 bg-plant-inspection/10 text-plant-inspection'
    );
  }
  if (inspection.inspectionType === 'hgv') {
    return getModuleStatusBadgeClass(
      inspection.status,
      'border-hgv-inspection/40 bg-hgv-inspection/10 text-hgv-inspection'
    );
  }
  return getModuleStatusBadgeClass(
    inspection.status,
    'border-inspection/40 bg-inspection/10 text-inspection'
  );
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
    return <Clock className={`h-5 w-5 sm:h-4 sm:w-4 ${iconColorClass}`} />;
  }

  return <Clipboard className={`h-5 w-5 sm:h-4 sm:w-4 ${iconColorClass}`} />;
}

export function ProfileRecentSubmissionsTab({
  timesheets,
  inspections,
  absences,
  annualLeaveSummary,
  projectAssignments,
}: ProfileRecentSubmissionsTabProps) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Recent Timesheets</CardTitle>
          <CardDescription>Latest 3 submissions</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {timesheets.length === 0 ? (
            <p className="text-base text-muted-foreground sm:text-sm">No recent timesheets.</p>
          ) : (
            timesheets.map((timesheet) => (
              <Link
                key={timesheet.id}
                href={getTimesheetHref(timesheet)}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between ${summaryItemClass} ${summaryItemHoverClass}`}
              >
                <p className="flex items-center gap-2 text-base font-medium text-foreground sm:gap-1.5 sm:text-sm sm:font-normal">
                  <FileText className="h-5 w-5 text-timesheet sm:h-4 sm:w-4" />
                  Week ending {formatDate(timesheet.week_ending)}
                </p>
                <Badge variant="outline" className={`${getModuleStatusBadgeClass(timesheet.status, 'border-timesheet/40 bg-timesheet/10 text-timesheet')} w-fit px-2.5 py-1 text-sm sm:px-2 sm:py-0.5 sm:text-xs`}>
                  {formatStatusLabel(timesheet.status)}
                </Badge>
              </Link>
            ))
          )}
          <Button type="button" variant="outline" size="sm" className={timesheetCtaClass} asChild>
            <Link href="/timesheets">View all timesheets</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Daily Checks</CardTitle>
          <CardDescription>Latest van, plant, and HGV checks</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {inspections.length === 0 ? (
            <p className="text-base text-muted-foreground sm:text-sm">No recent daily checks.</p>
          ) : (
            inspections.map((inspection) => (
              <Link
                key={`${inspection.inspectionType}-${inspection.id}`}
                href={inspection.href}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between ${summaryItemClass} ${summaryItemHoverClass}`}
              >
                <div>
                  <p className="flex items-center gap-2 text-base font-medium capitalize text-foreground sm:gap-1.5 sm:text-sm sm:font-normal">
                    {getInspectionStatusIcon(inspection)}
                    {inspection.inspectionType} daily check
                  </p>
                  <p className="text-sm text-muted-foreground sm:text-xs">{formatDate(inspection.inspection_date)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={`${getInspectionStatusBadgeClass(inspection)} px-2.5 py-1 text-sm sm:px-2 sm:py-0.5 sm:text-xs`}>
                    {formatStatusLabel(inspection.status)}
                  </Badge>
                  <ExternalLink className="h-4 w-4 text-muted-foreground sm:h-3.5 sm:w-3.5" />
                </div>
              </Link>
            ))
          )}
          <div className="grid grid-cols-3 gap-2 text-sm sm:flex sm:flex-wrap sm:gap-3">
            <Button type="button" variant="outline" size="sm" className={inspectionCtaClass} asChild>
              <Link href="/van-inspections">Vans</Link>
            </Button>
            <Button type="button" variant="outline" size="sm" className={plantInspectionCtaClass} asChild>
              <Link href="/plant-inspections">Plant</Link>
            </Button>
            <Button type="button" variant="outline" size="sm" className={hgvInspectionCtaClass} asChild>
              <Link href="/hgv-inspections">HGV</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Leave Requests & Allowances</CardTitle>
          <CardDescription>Current financial year summary</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-border p-3 sm:rounded-md sm:p-2">
              <p className="text-[11px] text-muted-foreground sm:text-xs">Allowance</p>
              <p className="text-2xl font-semibold sm:text-base">{annualLeaveSummary.allowance.toFixed(1)}</p>
            </div>
            <div className="rounded-lg border border-border p-3 sm:rounded-md sm:p-2">
              <p className="text-[11px] text-muted-foreground sm:text-xs">Pending</p>
              <p className="text-2xl font-semibold sm:text-base">{annualLeaveSummary.pending_total.toFixed(1)}</p>
            </div>
            <div className="rounded-lg border border-border p-3 sm:rounded-md sm:p-2">
              <p className="text-[11px] text-muted-foreground sm:text-xs">Remaining</p>
              <p className="text-2xl font-semibold sm:text-base">{annualLeaveSummary.remaining.toFixed(1)}</p>
            </div>
          </div>

          {absences.length === 0 ? (
            <p className="text-base text-muted-foreground sm:text-sm">No recent leave requests.</p>
          ) : (
            absences.map((absence) => (
              <div key={absence.id} className="flex min-h-16 flex-col items-stretch gap-3 rounded-lg border border-border p-4 sm:min-h-0 sm:flex-row sm:items-center sm:justify-between sm:rounded-md sm:p-2.5">
                <div>
                  <p className="text-base font-medium text-foreground sm:text-sm sm:font-normal">{absence.reason_name}</p>
                  <p className="text-sm text-muted-foreground sm:text-xs">
                    {formatDate(absence.date)}
                    {absence.end_date ? ` - ${formatDate(absence.end_date)}` : ''}
                  </p>
                </div>
                <Badge variant="outline" className={`${getModuleStatusBadgeClass(absence.status, 'border-absence/40 bg-absence/10 text-absence')} w-fit px-2.5 py-1 text-sm sm:px-2 sm:py-0.5 sm:text-xs`}>
                  {formatStatusLabel(absence.status)}
                </Badge>
              </div>
            ))
          )}

          <Button type="button" variant="outline" size="sm" className={absenceCtaClass} asChild>
            <Link href="/absence">View absence calendar</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Assigned Projects</CardTitle>
          <CardDescription>RAMS and project documents assigned to you</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {projectAssignments.length === 0 ? (
            <p className="text-base text-muted-foreground sm:text-sm">No assigned project documents.</p>
          ) : (
            projectAssignments.map((assignment) => (
              <Link
                key={assignment.id}
                href="/projects"
                className={`flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between ${summaryItemClass} ${summaryItemHoverClass}`}
              >
                <div className="min-w-0">
                  <p className="truncate text-base font-medium text-foreground sm:text-sm">{assignment.title}</p>
                  <p className="text-sm text-muted-foreground sm:text-xs">
                    {assignment.document_type_name || 'Project document'} · Assigned {formatDate(assignment.assigned_at)}
                  </p>
                </div>
                <Badge variant="outline" className={`${getModuleStatusBadgeClass(assignment.status, 'border-rams/40 bg-rams/10 text-rams')} w-fit px-2.5 py-1 text-sm sm:px-2 sm:py-0.5 sm:text-xs`}>
                  {formatStatusLabel(assignment.status)}
                </Badge>
              </Link>
            ))
          )}
          <Button type="button" variant="outline" size="sm" className={projectsCtaClass} asChild>
            <Link href="/projects">Open projects</Link>
          </Button>
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle>Inventory</CardTitle>
          <CardDescription>Personal inventory visibility is coming soon.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 rounded-lg border border-dashed border-border bg-slate-900/20 p-4">
            <PackageSearch className="h-6 w-6 text-brand-yellow sm:h-5 sm:w-5" />
            <p className="text-base text-muted-foreground sm:text-sm">
              You will be able to see assigned equipment, location history, and outstanding inventory actions here.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
