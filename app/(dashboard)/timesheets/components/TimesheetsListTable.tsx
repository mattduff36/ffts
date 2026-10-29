'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpDown, Download, FileText, Trash2 } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/utils/date';
import type { Timesheet } from '@/types/timesheet';

export interface TimesheetsListColumnVisibility {
  employeeId: boolean;
  regNumber: boolean;
  status: boolean;
  submittedAt: boolean;
}

export const TIMESHEETS_LIST_COLUMN_VISIBILITY_STORAGE_KEY = 'timesheets-list-table-column-visibility';

export const DEFAULT_TIMESHEETS_LIST_COLUMN_VISIBILITY: TimesheetsListColumnVisibility = {
  employeeId: false,
  regNumber: true,
  status: true,
  submittedAt: true,
};

interface TimesheetWithProfile extends Timesheet {
  profile?: {
    full_name: string;
    employee_id?: string | null;
  };
}

interface TimesheetsListTableProps {
  timesheets: TimesheetWithProfile[];
  columnVisibility: TimesheetsListColumnVisibility;
  downloadingId: string | null;
  showDeleteActions: boolean;
  onDownloadPDF: (event: React.MouseEvent, timesheetId: string) => void;
  onOpenDeleteDialog: (event: React.MouseEvent, timesheet: Timesheet) => void;
}

type SortField = 'name' | 'weekEnding' | 'status' | 'submittedAt';
type SortDirection = 'asc' | 'desc';

function getStatusBadge(status: string) {
  const variants = {
    draft: { variant: 'secondary' as const, label: 'Draft' },
    submitted: { variant: 'warning' as const, label: 'Pending' },
    approved: { variant: 'success' as const, label: 'Payroll Received' },
    rejected: { variant: 'destructive' as const, label: 'Rejected' },
    processed: { variant: 'default' as const, label: 'Manager Approved' },
    adjusted: { variant: 'default' as const, label: 'Adjusted' },
  };

  const config = variants[status as keyof typeof variants] || variants.draft;
  const blueClasses = status === 'processed' || status === 'adjusted' ? 'bg-green-500/10 text-blue-600 border-blue-500/20' : '';

  return <Badge variant={config.variant} className={blueClasses}>{config.label}</Badge>;
}

export function TimesheetsListTable({
  timesheets,
  columnVisibility,
  downloadingId,
  showDeleteActions,
  onDownloadPDF,
  onOpenDeleteDialog,
}: TimesheetsListTableProps) {
  const router = useRouter();
  const [sortField, setSortField] = useState<SortField>('weekEnding');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const sortedRows = useMemo(() => {
    return [...timesheets].sort((a, b) => {
      const factor = sortDirection === 'asc' ? 1 : -1;
      switch (sortField) {
        case 'name':
          return factor * (a.profile?.full_name || '').localeCompare(b.profile?.full_name || '');
        case 'weekEnding':
          return factor * (new Date(a.week_ending).getTime() - new Date(b.week_ending).getTime());
        case 'status':
          return factor * a.status.localeCompare(b.status);
        case 'submittedAt':
          return factor * ((a.submitted_at || '').localeCompare(b.submitted_at || ''));
        default:
          return 0;
      }
    });
  }, [timesheets, sortDirection, sortField]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortField(field);
    setSortDirection('asc');
  }

  function navigateToTimesheet(timesheet: TimesheetWithProfile) {
    if (timesheet.status === 'draft' || timesheet.status === 'rejected') {
      router.push(`/timesheets/new?id=${timesheet.id}`);
      return;
    }
    router.push(`/timesheets/${timesheet.id}`);
  }

  return (
    <div className="border border-slate-700 rounded-lg overflow-hidden">
      <Table className="min-w-full">
        <TableHeader>
          <TableRow className="border-border">
            <TableHead
              className="bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border"
              onClick={() => handleSort('name')}
            >
              <div className="flex items-center gap-2">
                Employee
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
              onClick={() => handleSort('weekEnding')}
            >
              <div className="flex items-center gap-2">
                Week Ending
                <ArrowUpDown className="h-3 w-3" />
              </div>
            </TableHead>

            {columnVisibility.regNumber && (
              <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border">
                Reg Number
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
          {sortedRows.map((timesheet) => {
            const canDownload = ['submitted', 'approved', 'processed', 'adjusted'].includes(timesheet.status);
            return (
              <TableRow
                key={timesheet.id}
                className="border-slate-700 hover:bg-slate-800/50 cursor-pointer"
                onClick={() => navigateToTimesheet(timesheet)}
              >
                <TableCell className="font-medium text-white">
                  {timesheet.profile?.full_name || 'Unknown User'}
                </TableCell>
                {columnVisibility.employeeId && (
                  <TableCell className="text-muted-foreground">
                    {timesheet.profile?.employee_id || '-'}
                  </TableCell>
                )}
                <TableCell className="text-white">
                  {formatDate(timesheet.week_ending)}
                </TableCell>
                {columnVisibility.regNumber && (
                  <TableCell className="text-muted-foreground">
                    {timesheet.reg_number || '-'}
                  </TableCell>
                )}
                {columnVisibility.status && (
                  <TableCell>{getStatusBadge(timesheet.status)}</TableCell>
                )}
                {columnVisibility.submittedAt && (
                  <TableCell className="text-muted-foreground">
                    {timesheet.submitted_at ? formatDate(timesheet.submitted_at) : 'Not submitted'}
                  </TableCell>
                )}
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2" onClick={(event) => event.stopPropagation()}>
                    {canDownload && (
                      <Button
                        onClick={(event) => onDownloadPDF(event, timesheet.id)}
                        disabled={downloadingId === timesheet.id}
                        variant="outline"
                        size="sm"
                        className="border-timesheet text-timesheet hover:bg-timesheet hover:text-white"
                      >
                        <Download className="h-4 w-4 mr-1.5" />
                        {downloadingId === timesheet.id ? 'Downloading...' : 'PDF'}
                      </Button>
                    )}
                    {showDeleteActions && (
                      <Button
                        onClick={(event) => onOpenDeleteDialog(event, timesheet)}
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                        title="Delete timesheet"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                    {!canDownload && !showDeleteActions && (
                      <Badge variant="outline" className="border-slate-600 text-slate-400">
                        <FileText className="h-3 w-3 mr-1" />
                        N/A
                      </Badge>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
