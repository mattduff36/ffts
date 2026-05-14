'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ArrowUpDown,
  CheckCircle2,
  XCircle,
  Clock,
  FileText,
  Package,
} from 'lucide-react';
import { formatDate } from '@/lib/utils/date';
import { Timesheet } from '@/types/timesheet';
import { formatLeaveAwareWeeklyDisplayMultiline } from '@/lib/utils/timesheet-leave-totals';
import { collectUniqueJobNumbers } from '@/lib/utils/timesheet-job-codes';

interface TimesheetEntry {
  day_of_week: number;
  daily_total: number | null;
  job_number: string | null;
  job_numbers?: string[];
  timesheet_entry_job_codes?: Array<{ job_number?: string | null; display_order?: number | null }>;
  working_in_yard: boolean;
  did_not_work: boolean;
}

interface TimesheetWithProfile extends Timesheet {
  user: {
    full_name: string;
    employee_id: string;
  };
  timesheet_entries?: TimesheetEntry[];
  leave_total_display?: string;
  leave_worked_hours?: number;
  leave_days?: number;
}

export interface ColumnVisibility {
  employeeId: boolean;
  totalHours: boolean;
  jobNumber: boolean;
  status: boolean;
  submittedAt: boolean;
}

export const COLUMN_VISIBILITY_STORAGE_KEY = 'timesheets-approval-table-column-visibility';

export const DEFAULT_COLUMN_VISIBILITY: ColumnVisibility = {
  employeeId: false,
  totalHours: true,
  jobNumber: true,
  status: true,
  submittedAt: true,
};

interface TimesheetsApprovalTableProps {
  timesheets: TimesheetWithProfile[];
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onProcess: (id: string) => void;
  columnVisibility: ColumnVisibility;
  visibleCount?: number;
}

type SortField = 'name' | 'date' | 'totalHours' | 'status' | 'submittedAt';
type SortDirection = 'asc' | 'desc';

function computeTotalHours(entries?: TimesheetEntry[]): number {
  if (!entries || entries.length === 0) return 0;
  return entries.reduce((sum, e) => sum + (e.daily_total || 0), 0);
}

function computeJobNumbers(entries?: TimesheetEntry[]): string {
  if (!entries || entries.length === 0) return '-';
  const unique = collectUniqueJobNumbers(entries, {
    excludeDidNotWork: true,
    excludeWorkingInYard: true,
  });
  return unique.length > 0 ? unique.join(', ') : '-';
}

export function TimesheetsApprovalTable({
  timesheets,
  onApprove,
  onReject,
  onProcess,
  columnVisibility,
  visibleCount,
}: TimesheetsApprovalTableProps) {
  const router = useRouter();
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedTimesheets = useMemo(() => {
    return [...timesheets].sort((a, b) => {
      const m = sortDirection === 'asc' ? 1 : -1;

      switch (sortField) {
        case 'name':
          return m * (a.user?.full_name || '').localeCompare(b.user?.full_name || '');
        case 'date':
          return m * (new Date(a.week_ending).getTime() - new Date(b.week_ending).getTime());
        case 'totalHours':
          return m * ((a.leave_worked_hours ?? computeTotalHours(a.timesheet_entries)) - (b.leave_worked_hours ?? computeTotalHours(b.timesheet_entries)));
        case 'status':
          return m * (a.status || '').localeCompare(b.status || '');
        case 'submittedAt':
          return m * ((a.submitted_at || '').localeCompare(b.submitted_at || ''));
        default:
          return 0;
      }
    });
  }, [timesheets, sortField, sortDirection]);
  const visibleTimesheets = useMemo(
    () => sortedTimesheets.slice(0, visibleCount ?? sortedTimesheets.length),
    [sortedTimesheets, visibleCount]
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'submitted':
        return (
          <Badge variant="warning">
            <Clock className="h-3 w-3 mr-1" />
            Pending
          </Badge>
        );
      case 'approved':
        return (
          <Badge variant="success" className="bg-green-500/10 text-green-600 border-green-500/20">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Payroll Received
          </Badge>
        );
      case 'rejected':
        return (
          <Badge variant="destructive">
            <XCircle className="h-3 w-3 mr-1" />
            Rejected
          </Badge>
        );
      case 'processed':
        return (
          <Badge variant="default" className="bg-blue-500/10 text-blue-300 border-blue-500/20 hover:bg-blue-500/20">
            Manager Approved
          </Badge>
        );
      case 'adjusted':
        return (
          <Badge variant="default" className="bg-purple-500/10 text-purple-600 border-purple-500/20">
            Adjusted
          </Badge>
        );
      case 'draft':
        return (
          <Badge variant="secondary">
            <FileText className="h-3 w-3 mr-1" />
            Draft
          </Badge>
        );
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  if (timesheets.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No timesheets to display.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Table */}
      <div className="border border-slate-700 rounded-lg overflow-hidden">
        <Table className="min-w-full">
          <TableHeader>
            <TableRow className="border-border">
              <TableHead
                className="bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border"
                onClick={() => handleSort('name')}
              >
                <div className="flex items-center gap-2">
                  Name
                  <ArrowUpDown className="h-3 w-3" />
                </div>
              </TableHead>

              {columnVisibility.employeeId && (
                <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border">
                  Employee ID
                </TableHead>
              )}

              <TableHead
                className="bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border"
                onClick={() => handleSort('date')}
              >
                <div className="flex items-center gap-2">
                  Week Ending
                  <ArrowUpDown className="h-3 w-3" />
                </div>
              </TableHead>

              {columnVisibility.totalHours && (
                <TableHead
                  className="bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border"
                  onClick={() => handleSort('totalHours')}
                >
                  <div className="flex items-center gap-2">
                    Total Hours
                    <ArrowUpDown className="h-3 w-3" />
                  </div>
                </TableHead>
              )}

              {columnVisibility.jobNumber && (
                <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border">
                  Job Number
                </TableHead>
              )}

              {columnVisibility.status && (
                <TableHead
                  className="bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border"
                  onClick={() => handleSort('status')}
                >
                  <div className="flex items-center gap-2">
                    Status
                    <ArrowUpDown className="h-3 w-3" />
                  </div>
                </TableHead>
              )}

              {columnVisibility.submittedAt && (
                <TableHead
                  className="bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border"
                  onClick={() => handleSort('submittedAt')}
                >
                  <div className="flex items-center gap-2">
                    Submitted
                    <ArrowUpDown className="h-3 w-3" />
                  </div>
                </TableHead>
              )}

              <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border text-right">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleTimesheets.map((ts) => {
              const totalHours = ts.leave_worked_hours ?? computeTotalHours(ts.timesheet_entries);
              const totalDisplay = ts.leave_days !== undefined
                ? formatLeaveAwareWeeklyDisplayMultiline(totalHours, ts.leave_days)
                : (ts.leave_total_display || (totalHours > 0 ? `${totalHours.toFixed(1)}h` : '-'));
              const jobNumbers = computeJobNumbers(ts.timesheet_entries);

              return (
                <TableRow
                  key={ts.id}
                  className="border-slate-700 hover:bg-slate-800/50 cursor-pointer"
                  onClick={() => router.push(`/timesheets/${ts.id}`)}
                >
                  <TableCell className="font-medium text-white">
                    {ts.user?.full_name || 'Unknown'}
                  </TableCell>

                  {columnVisibility.employeeId && (
                    <TableCell className="text-muted-foreground">
                      {ts.user?.employee_id || '-'}
                    </TableCell>
                  )}

                  <TableCell className="text-muted-foreground">
                    {formatDate(ts.week_ending)}
                  </TableCell>

                  {columnVisibility.totalHours && (
                    <TableCell className="text-muted-foreground font-mono whitespace-pre-line">
                      {totalDisplay}
                    </TableCell>
                  )}

                  {columnVisibility.jobNumber && (
                    <TableCell className="text-muted-foreground font-mono max-w-[200px] truncate" title={jobNumbers}>
                      {jobNumbers}
                    </TableCell>
                  )}

                  {columnVisibility.status && (
                    <TableCell>
                      {getStatusBadge(ts.status)}
                    </TableCell>
                  )}

                  {columnVisibility.submittedAt && (
                    <TableCell className="text-muted-foreground text-sm">
                      {ts.submitted_at ? formatDate(ts.submitted_at) : '-'}
                    </TableCell>
                  )}

                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {ts.status === 'submitted' && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); onReject(ts.id); }}
                            className="border-red-300 text-red-600 hover:bg-red-500 hover:text-white hover:border-red-500 active:bg-red-600 active:scale-95 transition-all h-8 px-2"
                          >
                            <XCircle className="h-3.5 w-3.5 mr-1" />
                            Reject
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); onApprove(ts.id); }}
                            className="border-green-300 text-green-600 hover:bg-green-500 hover:text-white hover:border-green-500 active:bg-green-600 active:scale-95 transition-all h-8 px-2"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                            Payroll Received
                          </Button>
                        </>
                      )}
                      {ts.status === 'approved' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); onProcess(ts.id); }}
                          className="border-brand-yellow/50 text-brand-yellow hover:bg-brand-yellow/20 hover:text-brand-yellow hover:border-brand-yellow active:bg-brand-yellow/30 active:text-brand-yellow active:scale-95 transition-all h-8 px-2"
                        >
                          <Package className="h-3.5 w-3.5 mr-1" />
                          Manager Approved
                        </Button>
                      )}
                      {ts.status !== 'submitted' && ts.status !== 'approved' && (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
