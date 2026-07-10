'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpDown, Clipboard, Clock, Download, Trash2 } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/utils/date';

export interface HgvInspectionsColumnVisibility {
  employeeId: boolean;
  nickname: boolean;
  status: boolean;
  submittedAt: boolean;
}

export const HGV_INSPECTIONS_COLUMN_VISIBILITY_STORAGE_KEY = 'hgv-inspections-table-column-visibility';

export const DEFAULT_HGV_INSPECTIONS_COLUMN_VISIBILITY: HgvInspectionsColumnVisibility = {
  employeeId: false,
  nickname: true,
  status: true,
  submittedAt: true,
};

interface HgvInspectionRow {
  id: string;
  user_id: string;
  status: 'draft' | 'submitted';
  has_reported_defect?: boolean;
  has_inform_workshop_task?: boolean;
  inspection_date: string;
  inspection_end_date: string | null;
  submitted_at: string | null;
  hgv: { reg_number: string; nickname: string | null } | null;
  profile: { full_name: string; employee_id?: string | null } | null;
}

interface HgvInspectionsListTableProps {
  inspections: HgvInspectionRow[];
  columnVisibility: HgvInspectionsColumnVisibility;
  downloadingId: string | null;
  deletingId: string | null;
  getInspectionHref: (inspection: HgvInspectionRow) => string;
  canDeleteInspection: (inspection: HgvInspectionRow) => boolean;
  onDownloadPDF: (event: React.MouseEvent, inspectionId: string) => void;
  onDeleteInspection: (event: React.MouseEvent, inspectionId: string) => void;
}

type SortField = 'employee' | 'hgv' | 'date' | 'status' | 'submittedAt';
type SortDirection = 'asc' | 'desc';

function getStatusBadge(status: string) {
  const variants = {
    draft: { variant: 'secondary' as const, label: 'Draft' },
    submitted: { variant: 'default' as const, label: 'Submitted' },
  };
  const config = variants[status as keyof typeof variants] || variants.draft;
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

function getStatusIcon(inspection: HgvInspectionRow) {
  const iconColorClass = inspection.has_inform_workshop_task
    ? 'text-hgv-inspection'
    : inspection.has_reported_defect
      ? 'text-red-500'
      : 'text-green-500';

  if (inspection.status === 'submitted') {
    return <Clock className={`h-4 w-4 ${iconColorClass}`} />;
  }

  return <Clipboard className={`h-4 w-4 ${iconColorClass}`} />;
}

function formatInspectionRange(startDate: string, endDate: string | null) {
  if (endDate && endDate !== startDate) {
    return `${formatDate(startDate)} - ${formatDate(endDate)}`;
  }
  return formatDate(startDate);
}

export function HgvInspectionsListTable({
  inspections,
  columnVisibility,
  downloadingId,
  deletingId,
  getInspectionHref,
  canDeleteInspection,
  onDownloadPDF,
  onDeleteInspection,
}: HgvInspectionsListTableProps) {
  const router = useRouter();
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const sortedRows = useMemo(() => {
    return [...inspections].sort((a, b) => {
      const factor = sortDirection === 'asc' ? 1 : -1;
      switch (sortField) {
        case 'employee':
          return factor * ((a.profile?.full_name || '').localeCompare(b.profile?.full_name || ''));
        case 'hgv':
          return factor * ((a.hgv?.reg_number || '').localeCompare(b.hgv?.reg_number || ''));
        case 'date':
          return factor * (new Date(a.inspection_date).getTime() - new Date(b.inspection_date).getTime());
        case 'status':
          return factor * a.status.localeCompare(b.status);
        case 'submittedAt':
          return factor * ((a.submitted_at || '').localeCompare(b.submitted_at || ''));
        default:
          return 0;
      }
    });
  }, [inspections, sortField, sortDirection]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortField(field);
    setSortDirection('asc');
  }

  return (
    <div className="border border-slate-700 rounded-lg overflow-hidden">
      <Table className="min-w-full">
        <TableHeader>
          <TableRow className="border-border">
            <TableHead
              className="bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border"
              onClick={() => handleSort('employee')}
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
              onClick={() => handleSort('hgv')}
            >
              <div className="flex items-center gap-2">
                HGV
                <ArrowUpDown className="h-3 w-3" />
              </div>
            </TableHead>
            {columnVisibility.nickname && (
              <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border">
                Nickname
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
          {sortedRows.map((inspection) => (
            <TableRow
              key={inspection.id}
              className="border-slate-700 hover:bg-slate-800/50 cursor-pointer"
              onClick={() => router.push(getInspectionHref(inspection))}
            >
              <TableCell className="font-medium text-white">
                {inspection.profile?.full_name || 'Unknown User'}
              </TableCell>
              {columnVisibility.employeeId && (
                <TableCell className="text-muted-foreground">
                  {inspection.profile?.employee_id || '-'}
                </TableCell>
              )}
              <TableCell className="text-white">
                {inspection.hgv?.reg_number || 'Unknown HGV'}
              </TableCell>
              {columnVisibility.nickname && (
                <TableCell className="text-muted-foreground">
                  {inspection.hgv?.nickname || '-'}
                </TableCell>
              )}
              <TableCell className="text-muted-foreground">
                {formatInspectionRange(inspection.inspection_date, inspection.inspection_end_date)}
              </TableCell>
              {columnVisibility.status && (
                <TableCell>
                  <div className="flex items-center gap-2">
                    {getStatusIcon(inspection)}
                    {getStatusBadge(inspection.status)}
                  </div>
                </TableCell>
              )}
              {columnVisibility.submittedAt && (
                <TableCell className="text-muted-foreground">
                  {inspection.status === 'submitted'
                    ? inspection.submitted_at
                      ? formatDate(inspection.submitted_at)
                      : 'Submitted'
                    : 'Draft'}
                </TableCell>
              )}
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-2" onClick={(event) => event.stopPropagation()}>
                  {inspection.status === 'submitted' && (
                    <Button
                      onClick={(event) => onDownloadPDF(event, inspection.id)}
                      disabled={downloadingId === inspection.id}
                      variant="outline"
                      size="sm"
                      className="border-hgv-inspection text-hgv-inspection hover:bg-hgv-inspection hover:text-white"
                    >
                      <Download className="h-4 w-4 mr-1.5" />
                      {downloadingId === inspection.id ? 'Downloading...' : 'PDF'}
                    </Button>
                  )}
                  {canDeleteInspection(inspection) && (
                    <Button
                      onClick={(event) => onDeleteInspection(event, inspection.id)}
                      disabled={deletingId === inspection.id}
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                      title="Delete inspection"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
