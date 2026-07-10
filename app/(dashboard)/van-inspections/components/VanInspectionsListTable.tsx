'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpDown, Clipboard, Clock, Download, Trash2 } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/utils/date';

export interface VanInspectionsColumnVisibility {
  employeeId: boolean;
  vehicleCategory: boolean;
  status: boolean;
  submittedAt: boolean;
}

export const VAN_INSPECTIONS_COLUMN_VISIBILITY_STORAGE_KEY = 'van-inspections-table-column-visibility';

export const DEFAULT_VAN_INSPECTIONS_COLUMN_VISIBILITY: VanInspectionsColumnVisibility = {
  employeeId: false,
  vehicleCategory: true,
  status: true,
  submittedAt: true,
};

interface VanInspectionRow {
  id: string;
  user_id: string;
  status: 'draft' | 'submitted';
  has_reported_defect?: boolean;
  has_inform_workshop_task?: boolean;
  inspection_date: string;
  inspection_end_date: string | null;
  submitted_at: string | null;
  vans: {
    reg_number: string;
    van_categories: { name: string } | null;
  } | null;
  profile?: {
    full_name?: string;
    employee_id?: string | null;
  } | null;
}

interface VanInspectionsListTableProps {
  inspections: VanInspectionRow[];
  columnVisibility: VanInspectionsColumnVisibility;
  downloadingId: string | null;
  deleting: boolean;
  getInspectionHref: (inspection: VanInspectionRow) => string;
  canDeleteInspection: (inspection: VanInspectionRow) => boolean;
  onDownloadPDF: (event: React.MouseEvent, inspectionId: string) => void;
  onOpenDeleteDialog: (event: React.MouseEvent, inspection: VanInspectionRow) => void;
}

type SortField = 'employee' | 'vehicle' | 'date' | 'status' | 'submittedAt';
type SortDirection = 'asc' | 'desc';

function getStatusBadge(status: string) {
  const variants = {
    draft: { variant: 'secondary' as const, label: 'Draft' },
    submitted: { variant: 'default' as const, label: 'Submitted' },
  };
  const config = variants[status as keyof typeof variants] || variants.draft;
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

function getStatusIcon(inspection: VanInspectionRow) {
  const iconColorClass = inspection.has_inform_workshop_task
    ? 'text-inspection'
    : inspection.has_reported_defect
      ? 'text-red-500'
      : 'text-green-500';

  if (inspection.status === 'submitted') {
    return <Clock className={`h-4 w-4 ${iconColorClass}`} />;
  }

  return <Clipboard className={`h-4 w-4 ${iconColorClass}`} />;
}

export function VanInspectionsListTable({
  inspections,
  columnVisibility,
  downloadingId,
  deleting,
  getInspectionHref,
  canDeleteInspection,
  onDownloadPDF,
  onOpenDeleteDialog,
}: VanInspectionsListTableProps) {
  const router = useRouter();
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const sortedRows = useMemo(() => {
    return [...inspections].sort((a, b) => {
      const factor = sortDirection === 'asc' ? 1 : -1;
      switch (sortField) {
        case 'employee':
          return factor * ((a.profile?.full_name || '').localeCompare(b.profile?.full_name || ''));
        case 'vehicle':
          return factor * ((a.vans?.reg_number || '').localeCompare(b.vans?.reg_number || ''));
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
              onClick={() => handleSort('vehicle')}
            >
              <div className="flex items-center gap-2">
                Van
                <ArrowUpDown className="h-3 w-3" />
              </div>
            </TableHead>
            {columnVisibility.vehicleCategory && (
              <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border">
                Category
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
                {inspection.vans?.reg_number || 'Unknown Van'}
              </TableCell>
              {columnVisibility.vehicleCategory && (
                <TableCell className="text-muted-foreground">
                  {inspection.vans?.van_categories?.name || '-'}
                </TableCell>
              )}
              <TableCell className="text-muted-foreground">
                {formatDate(inspection.inspection_date)}
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
                      className="border-inspection text-inspection hover:bg-inspection hover:text-white"
                    >
                      <Download className="h-4 w-4 mr-1.5" />
                      {downloadingId === inspection.id ? 'Downloading...' : 'PDF'}
                    </Button>
                  )}
                  {canDeleteInspection(inspection) && (
                    <Button
                      onClick={(event) => onOpenDeleteDialog(event, inspection)}
                      disabled={deleting}
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
