'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { BackButton } from '@/components/ui/back-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageLoader } from '@/components/ui/page-loader';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { SensitiveModuleGate, SensitiveModuleSessionManager, useSensitiveModuleAccess } from '@/components/security/SensitiveModuleGate';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { cn } from '@/lib/utils/cn';
import { ArrowRight, Clock, Coins, FileText, HardHat, Receipt, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import type {
  QuoteOverviewDetailPayload,
  QuoteOverviewLabourRow,
  QuoteOverviewSummary,
} from '../../overview-types';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function formatCurrency(value: number | null | undefined): string {
  const amount = Number(value || 0);
  return `£${amount.toLocaleString('en-GB', {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatHours(value: number | null | undefined): string {
  const amount = Number(value || 0);
  return `${amount.toLocaleString('en-GB', {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 1,
    maximumFractionDigits: 2,
  })}h`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '-';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function getEstimatedValue(hours: number, rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Math.round(hours * rate * 100) / 100;
}

function getStatusBadgeClass(status: string | null | undefined): string {
  if (status === 'rejected' || status === 'cancelled' || status === 'closed') {
    return 'border-slate-500/40 bg-slate-500/10 text-slate-200';
  }
  if (status === 'approved' || status === 'processed' || status === 'adjusted' || status === 'invoiced') {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
  }
  return 'border-brand-yellow/30 bg-brand-yellow/10 text-brand-yellow';
}

function getStatusLabel(status: string | null | undefined): string {
  return (status || 'unknown').replace(/_/g, ' ');
}

interface SummaryCardProps {
  label: string;
  value: string;
  helper?: string;
  icon: ReactNode;
  accent?: 'yellow' | 'green' | 'blue' | 'slate';
}

function SummaryCard({ label, value, helper, icon, accent = 'slate' }: SummaryCardProps) {
  const accentClass = {
    yellow: 'border-brand-yellow/30 bg-brand-yellow/10 text-brand-yellow',
    green: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
    blue: 'border-blue-500/30 bg-blue-500/10 text-blue-200',
    slate: 'border-slate-700 bg-slate-950 text-slate-200',
  }[accent];

  return (
    <Card className={cn('border', accentClass)}>
      <CardContent className="flex items-start justify-between gap-2 p-3">
        <div>
          <p className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
          <p className="mt-1 text-xl font-semibold leading-tight text-white">{value}</p>
          {helper ? <p className="mt-0.5 truncate text-xs text-slate-400">{helper}</p> : null}
        </div>
        <div className="rounded-md border border-white/10 bg-white/5 p-1.5">{icon}</div>
      </CardContent>
    </Card>
  );
}

interface DetailSummaryProps {
  summary: QuoteOverviewSummary;
  estimatedRate: number;
}

function DetailSummary({ summary, estimatedRate }: DetailSummaryProps) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <SummaryCard
        label="Invoices Sent"
        value={String(summary.invoice_count)}
        helper={formatCurrency(summary.invoice_total)}
        icon={<Receipt className="h-5 w-5" />}
        accent="green"
      />
      <SummaryCard
        label="Worked Hours"
        value={formatHours(summary.worked_hours)}
        helper={`${summary.employee_count} people, ${summary.timesheet_count} timesheets`}
        icon={<Clock className="h-5 w-5" />}
        accent="blue"
      />
      <SummaryCard
        label="Estimated Labour"
        value={estimatedRate > 0 ? formatCurrency(getEstimatedValue(summary.worked_hours, estimatedRate)) : 'Set rate'}
        helper={estimatedRate > 0 ? `${formatCurrency(estimatedRate)} per hour` : 'Optional average hourly rate'}
        icon={<Coins className="h-5 w-5" />}
        accent="yellow"
      />
      <SummaryCard
        label="Manual Costs"
        value={formatCurrency(summary.manual_cost_total)}
        helper="Project number costs"
        icon={<FileText className="h-5 w-5" />}
      />
    </div>
  );
}

function hasPlantDetails(row: QuoteOverviewLabourRow): boolean {
  return Boolean(
    row.timesheet_type === 'plant'
    || row.reg_number
    || row.machine_start_time
    || row.machine_finish_time
    || row.machine_working_hours
    || row.machine_travel_hours
    || row.machine_standing_hours
    || row.maintenance_breakdown_hours
  );
}

function PlantDetails({ row }: { row: QuoteOverviewLabourRow }) {
  if (!hasPlantDetails(row)) return <span className="text-slate-500">-</span>;

  const parts = [
    row.reg_number ? `Reg ${row.reg_number}` : null,
    row.hired_plant_description || row.hired_plant_id_serial,
    row.machine_start_time && row.machine_finish_time ? `${row.machine_start_time}-${row.machine_finish_time}` : null,
    row.machine_working_hours ? `${formatHours(row.machine_working_hours)} machine` : null,
    row.machine_travel_hours ? `${formatHours(row.machine_travel_hours)} travel` : null,
    row.machine_standing_hours ? `${formatHours(row.machine_standing_hours)} standing` : null,
    row.maintenance_breakdown_hours ? `${formatHours(row.maintenance_breakdown_hours)} breakdown` : null,
  ].filter(Boolean);

  return <span className="text-slate-300">{parts.join(' · ')}</span>;
}

function LabourRows({ rows }: { rows: QuoteOverviewLabourRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-700 p-5 text-sm text-slate-400">
        No timesheet entries have been recorded against this quote or job number yet.
      </p>
    );
  }

  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border border-slate-700 lg:block">
        <Table>
          <TableHeader className="bg-slate-950">
            <TableRow className="hover:bg-slate-950">
              <TableHead>Date</TableHead>
              <TableHead>Employee</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Job Codes</TableHead>
              <TableHead className="text-right">Hours</TableHead>
              <TableHead>Times</TableHead>
              <TableHead>Plant Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(row => (
              <TableRow key={row.id} className="bg-slate-900/40 hover:bg-slate-800/70">
                <TableCell>
                  <span className="font-medium text-white">{formatDate(row.entry_date)}</span>
                  <span className="block text-xs text-slate-500">{DAY_NAMES[row.day_of_week - 1] || `Day ${row.day_of_week}`}</span>
                </TableCell>
                <TableCell>
                  <span className="font-medium text-slate-100">{row.employee_name}</span>
                  {row.employee_number ? <span className="block text-xs text-slate-500">{row.employee_number}</span> : null}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={cn('capitalize', getStatusBadgeClass(row.timesheet_status))}>
                    {getStatusLabel(row.timesheet_status)}
                  </Badge>
                </TableCell>
                <TableCell className="text-slate-300">{row.job_numbers.join(', ')}</TableCell>
                <TableCell className="text-right font-semibold text-blue-200">{formatHours(row.allocated_hours)}</TableCell>
                <TableCell className="text-slate-300">
                  {row.time_started && row.time_finished ? `${row.time_started}-${row.time_finished}` : '-'}
                </TableCell>
                <TableCell className="max-w-md">
                  <PlantDetails row={row} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-3 lg:hidden">
        {rows.map(row => (
          <Card key={row.id} className="border-slate-700 bg-slate-900/70">
            <CardContent className="space-y-3 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-white">{row.employee_name}</p>
                  <p className="text-sm text-slate-400">{formatDate(row.entry_date)} · {DAY_NAMES[row.day_of_week - 1]}</p>
                </div>
                <p className="text-lg font-semibold text-blue-200">{formatHours(row.allocated_hours)}</p>
              </div>
              <div className="grid gap-2 text-sm text-slate-300 sm:grid-cols-2">
                <p><span className="text-slate-500">Status:</span> {getStatusLabel(row.timesheet_status)}</p>
                <p><span className="text-slate-500">Job codes:</span> {row.job_numbers.join(', ')}</p>
                <p><span className="text-slate-500">Times:</span> {row.time_started && row.time_finished ? `${row.time_started}-${row.time_finished}` : '-'}</p>
                <p><span className="text-slate-500">Plant:</span> <PlantDetails row={row} /></p>
              </div>
              {row.remarks ? <p className="text-sm text-slate-400">{row.remarks}</p> : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

export default function QuoteOverviewDetailPage() {
  const params = useParams<{ reference: string }>();
  const router = useRouter();
  const reference = params.reference;
  const { hasPermission: canViewQuotes, loading: permissionLoading } = usePermissionCheck('quotes', false);
  const sensitiveAccess = useSensitiveModuleAccess('quotes');
  const [payload, setPayload] = useState<QuoteOverviewDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [estimatedRateInput, setEstimatedRateInput] = useState('');
  const estimatedRate = useMemo(() => Number(estimatedRateInput || 0), [estimatedRateInput]);

  const loadDetail = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/quotes/overview/${encodeURIComponent(reference)}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to load quote overview detail.');
      setPayload(data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to load quote overview detail.');
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [reference]);

  useEffect(() => {
    if (permissionLoading || sensitiveAccess.loading) return;
    if (!canViewQuotes) {
      toast.error('You do not have access to quotes.', { id: 'quotes-overview-detail-access-denied' });
      router.push('/dashboard');
      return;
    }
    if (!sensitiveAccess.canAccess) return;
    loadDetail();
  }, [canViewQuotes, loadDetail, permissionLoading, router, sensitiveAccess.canAccess, sensitiveAccess.loading]);

  if (permissionLoading || sensitiveAccess.loading || (sensitiveAccess.canAccess && loading)) {
    return <PageLoader message="Loading quote overview..." />;
  }

  if (!canViewQuotes) {
    return <PageLoader message="Redirecting..." />;
  }

  if (!sensitiveAccess.canAccess) {
    return (
      <AppPageShell>
        <SensitiveModuleGate moduleLabel="Quotes" access={sensitiveAccess} />
      </AppPageShell>
    );
  }

  if (!payload) {
    return (
      <AppPageShell>
        <AppPageHeader
          title="Quote or Job Not Found"
          description="The selected quote or job number could not be loaded."
          leading={<BackButton fallbackHref="/quotes?tab=overview" />}
          icon={<FileText className="h-5 w-5" />}
          actions={(
            <Button asChild variant="outline">
              <Link href="/quotes?tab=overview">Back to Overview</Link>
            </Button>
          )}
        />
      </AppPageShell>
    );
  }

  const { item, quote, project } = payload;

  return (
    <AppPageShell width="wide">
      <SensitiveModuleSessionManager moduleLabel="Quotes" access={sensitiveAccess} />
      <AppPageHeader
        title={item.reference}
        description={item.title}
        leading={<BackButton fallbackHref="/quotes?tab=overview" />}
        icon={<FileText className="h-5 w-5" />}
        className="p-4"
        titleClassName="text-2xl"
        actions={(
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-end">
            <div className="space-y-1">
              <Label htmlFor="quotes-overview-detail-rate" className="text-xs">Avg hourly rate</Label>
              <Input
                id="quotes-overview-detail-rate"
                type="number"
                min="0"
                step="0.01"
                value={estimatedRateInput}
                onChange={(event) => setEstimatedRateInput(event.target.value)}
                placeholder="Optional"
                className="h-9 w-full sm:w-40"
              />
            </div>
            <Button asChild variant="outline">
              <Link href="/quotes?tab=overview">Overview</Link>
            </Button>
          </div>
        )}
      />

      <DetailSummary summary={payload.summary} estimatedRate={estimatedRate} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="space-y-4">
          <Card className="border-slate-700 bg-slate-950">
            <CardHeader className="p-4 pb-3">
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <Receipt className="h-5 w-5 text-brand-yellow" />
                Quote and Project Details
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 p-4 pt-0 md:grid-cols-2">
              <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                <h3 className="font-semibold text-white">Quote</h3>
                {quote ? (
                  <dl className="space-y-1.5 text-sm">
                    <div><dt className="text-slate-500">Customer</dt><dd className="text-slate-200">{quote.customer?.company_name || 'No customer linked'}</dd></div>
                    <div><dt className="text-slate-500">Contact</dt><dd className="text-slate-200">{quote.attention_name || quote.customer?.contact_name || '-'}</dd></div>
                    <div><dt className="text-slate-500">Manager</dt><dd className="text-slate-200">{quote.manager_name || '-'}</dd></div>
                    <div><dt className="text-slate-500">Quote Value</dt><dd className="text-slate-200">{formatCurrency(quote.total)}</dd></div>
                    <div><dt className="text-slate-500">PO Number</dt><dd className="text-slate-200">{quote.po_number || '-'}</dd></div>
                    <div><dt className="text-slate-500">Status</dt><dd><Badge variant="outline" className={cn('capitalize', getStatusBadgeClass(quote.status))}>{getStatusLabel(quote.status)}</Badge></dd></div>
                  </dl>
                ) : (
                  <p className="text-sm text-slate-400">No formal quote is linked to this job number yet.</p>
                )}
              </div>

              <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                <h3 className="font-semibold text-white">Project Number</h3>
                {project ? (
                  <dl className="space-y-1.5 text-sm">
                    <div><dt className="text-slate-500">Title</dt><dd className="text-slate-200">{project.title}</dd></div>
                    <div><dt className="text-slate-500">Manager</dt><dd className="text-slate-200">{project.manager?.full_name || '-'}</dd></div>
                    <div><dt className="text-slate-500">Status</dt><dd><Badge variant="outline" className={cn('capitalize', getStatusBadgeClass(project.status))}>{getStatusLabel(project.status)}</Badge></dd></div>
                    <div><dt className="text-slate-500">Created</dt><dd className="text-slate-200">{formatDate(project.created_at)}</dd></div>
                    {project.description ? <div><dt className="text-slate-500">Description</dt><dd className="text-slate-200">{project.description}</dd></div> : null}
                  </dl>
                ) : (
                  <p className="text-sm text-slate-400">No separate project-number record was found.</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-700 bg-slate-950">
            <CardHeader className="p-4 pb-3">
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <UserRound className="h-5 w-5 text-blue-300" />
                Employee Hours
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {payload.labour_by_employee.length > 0 ? (
                <div className="overflow-x-auto rounded-lg border border-slate-700">
                  <Table>
                    <TableHeader className="bg-slate-950">
                      <TableRow className="hover:bg-slate-950">
                        <TableHead>Employee</TableHead>
                        <TableHead className="text-right">Hours</TableHead>
                        <TableHead className="text-right">Timesheets</TableHead>
                        <TableHead className="text-right">Entries</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payload.labour_by_employee.map(employee => (
                        <TableRow key={employee.employee_id || employee.employee_name} className="bg-slate-900/40">
                          <TableCell>
                            <span className="font-medium text-white">{employee.employee_name}</span>
                            {employee.employee_number ? <span className="block text-xs text-slate-500">{employee.employee_number}</span> : null}
                          </TableCell>
                          <TableCell className="text-right font-semibold text-blue-200">{formatHours(employee.total_hours)}</TableCell>
                          <TableCell className="text-right text-slate-300">{employee.timesheet_count}</TableCell>
                          <TableCell className="text-right text-slate-300">{employee.entry_count}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-slate-700 p-4 text-sm text-slate-400">
                  No employee hours have been found for this reference.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-700 bg-slate-950">
            <CardHeader className="p-4 pb-3">
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <HardHat className="h-5 w-5 text-blue-300" />
                Timesheet and Plant Entries
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <LabourRows rows={payload.labour_rows} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="border-slate-700 bg-slate-950">
            <CardHeader className="p-4 pb-3">
              <CardTitle className="text-base text-white">Invoices</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-4 pt-0">
              {payload.invoices.length > 0 ? payload.invoices.map(invoice => (
                <div key={invoice.id} className="rounded-lg border border-slate-800 bg-slate-900/50 p-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-white">{invoice.invoice_number}</p>
                      <p className="text-sm text-slate-400">{formatDate(invoice.invoice_date)} · {invoice.invoice_scope}</p>
                    </div>
                    <p className="font-semibold text-emerald-200">{formatCurrency(invoice.amount)}</p>
                  </div>
                  {invoice.comments ? <p className="mt-2 text-sm text-slate-400">{invoice.comments}</p> : null}
                </div>
              )) : (
                <p className="rounded-lg border border-dashed border-slate-700 p-4 text-sm text-slate-400">No invoices recorded.</p>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-700 bg-slate-950">
            <CardHeader className="p-4 pb-3">
              <CardTitle className="text-base text-white">Quote Line Items</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-4 pt-0">
              {payload.line_items.length > 0 ? payload.line_items.map(itemRow => (
                <div key={itemRow.id} className="rounded-lg border border-slate-800 bg-slate-900/50 p-2.5">
                  <p className="font-medium text-white">{itemRow.description}</p>
                  <div className="mt-2 flex items-center justify-between gap-3 text-sm text-slate-400">
                    <span>{itemRow.quantity} {itemRow.unit || 'unit'} × {formatCurrency(itemRow.unit_rate)}</span>
                    <span className="font-semibold text-slate-100">{formatCurrency(itemRow.line_total)}</span>
                  </div>
                </div>
              )) : (
                <p className="rounded-lg border border-dashed border-slate-700 p-4 text-sm text-slate-400">No line items available.</p>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-700 bg-slate-950">
            <CardHeader className="p-4 pb-3">
              <CardTitle className="text-base text-white">Manual Project Costs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-4 pt-0">
              {payload.manual_costs.length > 0 ? payload.manual_costs.map(cost => (
                <div key={cost.id} className="rounded-lg border border-slate-800 bg-slate-900/50 p-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-white">{cost.description}</p>
                      <p className="text-sm capitalize text-slate-400">{cost.category} · {formatDate(cost.cost_date)}</p>
                    </div>
                    <p className="font-semibold text-slate-100">{formatCurrency(cost.amount)}</p>
                  </div>
                  {cost.supplier ? <p className="mt-2 text-sm text-slate-400">Supplier: {cost.supplier}</p> : null}
                </div>
              )) : (
                <p className="rounded-lg border border-dashed border-slate-700 p-4 text-sm text-slate-400">No manual costs recorded.</p>
              )}
            </CardContent>
          </Card>

          {payload.invoice_requests.length > 0 ? (
            <Card className="border-slate-700 bg-slate-950">
              <CardHeader className="p-4 pb-3">
                <CardTitle className="text-base text-white">Invoice Requests</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 p-4 pt-0">
                {payload.invoice_requests.map(request => (
                  <div key={request.id} className="rounded-lg border border-slate-800 bg-slate-900/50 p-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Badge variant="outline" className={cn('capitalize', getStatusBadgeClass(request.status))}>
                          {getStatusLabel(request.status)}
                        </Badge>
                        <p className="mt-2 text-sm text-slate-400">{formatDate(request.requested_invoice_date)}</p>
                      </div>
                      <p className="font-semibold text-slate-100">{formatCurrency(request.requested_amount)}</p>
                    </div>
                    {request.manager_comments ? <p className="mt-2 text-sm text-slate-400">{request.manager_comments}</p> : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {item.quote_id ? (
            <Button asChild className="w-full bg-brand-yellow font-semibold text-slate-950 hover:bg-brand-yellow/90">
              <Link href={`/quotes?tab=current&quote_id=${item.quote_id}`}>
                Open Existing Quote Modal
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
    </AppPageShell>
  );
}
