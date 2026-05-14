'use client';

import { useState, useMemo } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowUpDown, CheckCircle2, XCircle, Clock, Package } from 'lucide-react';
import { formatDate } from '@/lib/utils/date';
import { AbsenceWithRelations } from '@/types/absence';
import { useAbsenceSummaryForEmployee } from '@/lib/hooks/useAbsence';

export interface AbsenceColumnVisibility {
  employeeId: boolean;
  reason: boolean;
  duration: boolean;
  remainingAllowance: boolean;
  paidStatus: boolean;
  submittedAt: boolean;
}

export const ABSENCE_COLUMN_VISIBILITY_STORAGE_KEY = 'absences-approval-table-column-visibility';

export const DEFAULT_ABSENCE_COLUMN_VISIBILITY: AbsenceColumnVisibility = {
  employeeId: false,
  reason: true,
  duration: true,
  remainingAllowance: true,
  paidStatus: false,
  submittedAt: true,
};

interface AbsencesApprovalTableProps {
  absences: AbsenceWithRelations[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onProcess: (id: string) => void;
  columnVisibility: AbsenceColumnVisibility;
  visibleCount?: number;
}

type SortField = 'name' | 'reason' | 'date' | 'duration' | 'submittedAt';
type SortDirection = 'asc' | 'desc';

export function AbsencesApprovalTable({
  absences,
  onApprove,
  onReject,
  onProcess,
  columnVisibility,
  visibleCount,
}: AbsencesApprovalTableProps) {
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedAbsences = useMemo(() => {
    return [...absences].sort((a, b) => {
      const m = sortDirection === 'asc' ? 1 : -1;
      switch (sortField) {
        case 'name':
          return m * (a.profiles?.full_name || '').localeCompare(b.profiles?.full_name || '');
        case 'reason':
          return m * (a.absence_reasons?.name || '').localeCompare(b.absence_reasons?.name || '');
        case 'date':
          return m * (new Date(a.date).getTime() - new Date(b.date).getTime());
        case 'duration':
          return m * ((a.duration_days || 0) - (b.duration_days || 0));
        case 'submittedAt':
          return m * ((a.created_at || '').localeCompare(b.created_at || ''));
        default:
          return 0;
      }
    });
  }, [absences, sortField, sortDirection]);
  const visibleAbsences = useMemo(
    () => sortedAbsences.slice(0, visibleCount ?? sortedAbsences.length),
    [sortedAbsences, visibleCount]
  );

  if (absences.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No absences to display.
      </div>
    );
  }

  const formatDuration = (days: number) => {
    if (days === 0.5) return '0.5 days';
    if (days === 1) return '1 day';
    return `${days} days`;
  };

  const getStatusBadge = (status: string) => {
    if (status === 'approved') {
      return (
        <Badge variant="success" className="bg-green-500/10 text-green-600 border-green-500/20">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Approved
        </Badge>
      );
    }

    if (status === 'processed') {
      return (
        <Badge variant="default" className="bg-blue-500/10 text-blue-400 border-blue-500/20">
          <Package className="h-3 w-3 mr-1" />
          Processed
        </Badge>
      );
    }

    if (status === 'rejected') {
      return (
        <Badge variant="destructive">
          <XCircle className="h-3 w-3 mr-1" />
          Rejected
        </Badge>
      );
    }

    return (
      <Badge variant="warning">
        <Clock className="h-3 w-3 mr-1" />
        Pending
      </Badge>
    );
  };

  return (
    <div className="space-y-3">
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

              {columnVisibility.reason && (
                <TableHead
                  className="bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border"
                  onClick={() => handleSort('reason')}
                >
                  <div className="flex items-center gap-2">
                    Reason
                    <ArrowUpDown className="h-3 w-3" />
                  </div>
                </TableHead>
              )}

              <TableHead
                className="bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border"
                onClick={() => handleSort('date')}
              >
                <div className="flex items-center gap-2">
                  Date
                  <ArrowUpDown className="h-3 w-3" />
                </div>
              </TableHead>

              {columnVisibility.duration && (
                <TableHead
                  className="bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border"
                  onClick={() => handleSort('duration')}
                >
                  <div className="flex items-center gap-2">
                    Duration
                    <ArrowUpDown className="h-3 w-3" />
                  </div>
                </TableHead>
              )}

              {columnVisibility.remainingAllowance && (
                <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border">
                  Remaining Allowance
                </TableHead>
              )}

              {columnVisibility.paidStatus && (
                <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border">
                  Paid / Unpaid
                </TableHead>
              )}

              <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border">
                <div className="flex items-center gap-2">
                  Status
                </div>
              </TableHead>

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
            {visibleAbsences.map((absence) => (
              <TableRow
                key={absence.id}
                className="border-slate-700 hover:bg-slate-800/50"
              >
                <TableCell className="font-medium text-white">
                  {absence.profiles?.full_name || 'Unknown'}
                </TableCell>

                {columnVisibility.employeeId && (
                  <TableCell className="text-muted-foreground">
                    {absence.profiles?.employee_id || '-'}
                  </TableCell>
                )}

                {columnVisibility.reason && (
                  <TableCell className="text-muted-foreground">
                    {absence.absence_reasons?.name || '-'}
                  </TableCell>
                )}

                <TableCell className="text-muted-foreground">
                  {absence.end_date && absence.date !== absence.end_date
                    ? `${formatDate(absence.date)} - ${formatDate(absence.end_date)}`
                    : formatDate(absence.date)
                  }
                  {absence.is_half_day && ` (${absence.half_day_session})`}
                </TableCell>

                {columnVisibility.duration && (
                  <TableCell className="text-muted-foreground">
                    {formatDuration(absence.duration_days)}
                  </TableCell>
                )}

                {columnVisibility.remainingAllowance && (
                  <RemainingAllowanceCell profileId={absence.profile_id} />
                )}

                {columnVisibility.paidStatus && (
                  <TableCell>
                    {absence.absence_reasons?.is_paid ? (
                      <Badge variant="outline" className="border-blue-500/30 text-blue-400 bg-blue-500/10 text-[10px]">
                        Paid
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-slate-600 text-muted-foreground text-[10px]">
                        Unpaid
                      </Badge>
                    )}
                  </TableCell>
                )}

                <TableCell>
                  {getStatusBadge(absence.status)}
                </TableCell>

                {columnVisibility.submittedAt && (
                  <TableCell className="text-muted-foreground text-sm">
                    {absence.created_at ? formatDate(absence.created_at) : '-'}
                  </TableCell>
                )}

                <TableCell className="text-right">
                  {absence.status === 'pending' ? (
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onReject(absence.id)}
                        className="border-red-300 text-red-600 hover:bg-red-500 hover:text-white hover:border-red-500 active:bg-red-600 active:scale-95 transition-all h-8 px-2"
                      >
                        <XCircle className="h-3.5 w-3.5 mr-1" />
                        Reject
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onApprove(absence.id)}
                        className="border-green-300 text-green-600 hover:bg-green-500 hover:text-white hover:border-green-500 active:bg-green-600 active:scale-95 transition-all h-8 px-2"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                        Approve
                      </Button>
                    </div>
                  ) : absence.status === 'approved' ? (
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onProcess(absence.id)}
                        className="border-brand-yellow/50 text-brand-yellow hover:bg-brand-yellow/20 hover:text-brand-yellow hover:border-brand-yellow active:bg-brand-yellow/30 active:text-brand-yellow active:scale-95 transition-all h-8 px-2"
                      >
                        <Package className="h-3.5 w-3.5 mr-1" />
                        Process
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">No actions</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function RemainingAllowanceCell({ profileId }: { profileId: string }) {
  const { data: summary, isLoading } = useAbsenceSummaryForEmployee(profileId);

  if (isLoading) {
    return <TableCell className="text-muted-foreground text-sm">…</TableCell>;
  }

  if (!summary) {
    return <TableCell className="text-muted-foreground text-sm">-</TableCell>;
  }

  return (
    <TableCell className="text-sm">
      <span className={summary.remaining < 0 ? 'text-red-400 font-medium' : 'text-green-400 font-medium'}>
        {summary.remaining} days
      </span>
      {summary.remaining < 0 && (
        <span className="text-red-400/70 text-xs ml-1">
          (over by {Math.abs(summary.remaining)})
        </span>
      )}
    </TableCell>
  );
}
