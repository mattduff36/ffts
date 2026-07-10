'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  DatabaseZap,
  Loader2,
  PlusCircle,
  RefreshCw,
  Search,
  Trash2,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { JobCodePicker } from '@/components/timesheets/JobCodeFields';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useTimesheetJobCodeOptions, type TimesheetJobCodeOption } from '@/lib/client/timesheet-job-codes';

interface LegacyJobCodeResponse {
  success?: boolean;
  message?: string;
  error?: string;
  legacy_job_code?: {
    quote_reference: string | null;
    customer_name: string;
    title: string;
    wasExisting: boolean;
  };
}

interface JobCodeCorrectionCounts {
  timesheetChildRows: number;
  timesheetScalarRows: number;
  childRowsToUpdate: number;
  childRowsToDeleteAsDuplicate: number;
  legacyQuoteRows: number;
  targetLegacyQuoteRows: number;
  legacyQuoteRowsToUpdate: number;
  legacyQuoteRowsToDelete: number;
  affectedTimesheets: number;
}

interface JobCodeCorrectionTimesheet {
  id: string;
  userId: string;
  employeeName: string;
  employeeId: string | null;
  email: string | null;
  weekEnding: string;
  status: string;
  jobCodes: string[];
  matchingJobCodeCount: number;
}

interface JobCodeCorrectionPreview {
  fromJobCode: string;
  toJobCode: string;
  scope: 'batch' | 'individual';
  deleteOldLegacyQuote: boolean;
  counts: JobCodeCorrectionCounts;
  affectedTimesheets: JobCodeCorrectionTimesheet[];
  warnings: string[];
}

interface JobCodeCorrectionApplyResult {
  preview: JobCodeCorrectionPreview;
  applied: {
    childRowsUpdated: number;
    childRowsDeletedAsDuplicates: number;
    scalarRowsUpdated: number;
    legacyQuoteRowsUpdated: number;
    legacyQuoteRowsDeleted: number;
  };
}

interface JobCodeCorrectionResponse {
  success?: boolean;
  error?: string;
  preview?: JobCodeCorrectionPreview;
  result?: JobCodeCorrectionApplyResult;
}

interface TimesheetSearchResponse {
  success?: boolean;
  error?: string;
  timesheets?: JobCodeCorrectionTimesheet[];
}

interface StoredJobCodesResponse {
  success?: boolean;
  error?: string;
  job_codes?: TimesheetJobCodeOption[];
}

type CorrectionScope = 'batch' | 'individual';

interface CorrectionPreviewSummaryProps {
  title: string;
  preview: JobCodeCorrectionPreview | null;
  result?: JobCodeCorrectionApplyResult | null;
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-GB');
}

function formatWeekEnding(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function getTotalChangeCount(preview: JobCodeCorrectionPreview | null): number {
  if (!preview) return 0;
  return preview.counts.childRowsToUpdate +
    preview.counts.childRowsToDeleteAsDuplicate +
    preview.counts.timesheetScalarRows +
    preview.counts.legacyQuoteRowsToUpdate +
    preview.counts.legacyQuoteRowsToDelete;
}

function getStatusBadgeClassName(status: string): string {
  switch (status) {
    case 'approved':
    case 'processed':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100';
    case 'submitted':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-100';
    case 'rejected':
      return 'border-red-500/30 bg-red-500/10 text-red-100';
    default:
      return 'border-slate-500/30 bg-slate-500/10 text-slate-100';
  }
}

function normalizeDisplayCode(value: string): string {
  return value.trim().toUpperCase();
}

function CorrectionPreviewSummary({ title, preview, result }: CorrectionPreviewSummaryProps) {
  if (!preview) return null;

  const metrics = [
    {
      label: 'Affected weekly timesheets',
      value: preview.counts.affectedTimesheets,
      detail: 'Timesheets with at least one matching code.',
    },
    {
      label: 'Timesheet job-code rows',
      value: preview.counts.timesheetChildRows,
      detail: `${formatNumber(preview.counts.childRowsToUpdate)} update, ${formatNumber(preview.counts.childRowsToDeleteAsDuplicate)} duplicate delete.`,
    },
    {
      label: 'Legacy scalar entries',
      value: preview.counts.timesheetScalarRows,
      detail: 'Fallback primary job-code values to keep in sync.',
    },
    {
      label: 'Legacy quote rows',
      value: preview.counts.legacyQuoteRows,
      detail: `${formatNumber(preview.counts.legacyQuoteRowsToUpdate)} update, ${formatNumber(preview.counts.legacyQuoteRowsToDelete)} delete.`,
    },
  ];

  return (
    <div className="rounded-xl border border-slate-700/70 bg-slate-950/35 p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="font-semibold text-foreground">{title}</h3>
          <p className="text-sm text-slate-400">
            Preview for changing <span className="font-semibold text-slate-200">{preview.fromJobCode}</span> to{' '}
            <span className="font-semibold text-slate-200">{preview.toJobCode}</span>.
          </p>
        </div>
        <Badge className="w-fit border-red-500/30 bg-red-500/10 text-red-100">
          {formatNumber(getTotalChangeCount(preview))} destructive change(s)
        </Badge>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-lg border border-slate-700/70 bg-slate-900/60 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{metric.label}</p>
            <p className="mt-2 text-2xl font-bold text-foreground">{formatNumber(metric.value)}</p>
            <p className="mt-1 text-xs text-slate-400">{metric.detail}</p>
          </div>
        ))}
      </div>

      {preview.warnings.length > 0 ? (
        <div className="mt-4 space-y-2">
          {preview.warnings.map((warning) => (
            <div key={warning} className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <p>{warning}</p>
            </div>
          ))}
        </div>
      ) : null}

      {result ? (
        <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="h-4 w-4" />
            Applied successfully
          </div>
          <p className="mt-1 text-emerald-100/85">
            Updated {formatNumber(result.applied.childRowsUpdated)} job-code row(s), deleted{' '}
            {formatNumber(result.applied.childRowsDeletedAsDuplicates)} duplicate row(s), updated{' '}
            {formatNumber(result.applied.scalarRowsUpdated)} scalar fallback row(s), updated{' '}
            {formatNumber(result.applied.legacyQuoteRowsUpdated)} legacy quote row(s), and deleted{' '}
            {formatNumber(result.applied.legacyQuoteRowsDeleted)} legacy quote row(s).
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function LegacyJobCodesDebugPanel() {
  const {
    options: replacementJobCodeOptions,
    isLoading: replacementJobCodeOptionsLoading,
    error: replacementJobCodeOptionsError,
  } = useTimesheetJobCodeOptions();
  const [batchFromCode, setBatchFromCode] = useState('');
  const [batchToCode, setBatchToCode] = useState('');
  const [deleteOldLegacyQuote, setDeleteOldLegacyQuote] = useState(false);
  const [batchPreview, setBatchPreview] = useState<JobCodeCorrectionPreview | null>(null);
  const [batchResult, setBatchResult] = useState<JobCodeCorrectionApplyResult | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);

  const [individualFromCode, setIndividualFromCode] = useState('');
  const [individualToCode, setIndividualToCode] = useState('');
  const [timesheetSearch, setTimesheetSearch] = useState('');
  const [timesheetResults, setTimesheetResults] = useState<JobCodeCorrectionTimesheet[]>([]);
  const [selectedTimesheetIds, setSelectedTimesheetIds] = useState<string[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [individualPreview, setIndividualPreview] = useState<JobCodeCorrectionPreview | null>(null);
  const [individualResult, setIndividualResult] = useState<JobCodeCorrectionApplyResult | null>(null);
  const [individualLoading, setIndividualLoading] = useState(false);
  const [storedJobCodeSearch, setStoredJobCodeSearch] = useState('');
  const [storedJobCodeOptions, setStoredJobCodeOptions] = useState<TimesheetJobCodeOption[]>([]);
  const [storedJobCodeOptionsLoading, setStoredJobCodeOptionsLoading] = useState(false);

  const [confirmScope, setConfirmScope] = useState<CorrectionScope | null>(null);

  const [jobCode, setJobCode] = useState('');
  const [name, setName] = useState('');
  const [customer, setCustomer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<LegacyJobCodeResponse['legacy_job_code'] | null>(null);

  const selectedTimesheets = useMemo(
    () => timesheetResults.filter((timesheet) => selectedTimesheetIds.includes(timesheet.id)),
    [selectedTimesheetIds, timesheetResults]
  );
  const activePreview = confirmScope === 'batch' ? batchPreview : individualPreview;
  const activeApplyLoading = confirmScope === 'batch' ? batchLoading : individualLoading;

  useEffect(() => {
    setBatchPreview(null);
    setBatchResult(null);
  }, [batchFromCode, batchToCode, deleteOldLegacyQuote]);

  useEffect(() => {
    setIndividualPreview(null);
    setIndividualResult(null);
  }, [individualFromCode, individualToCode, selectedTimesheetIds]);

  useEffect(() => {
    if (replacementJobCodeOptionsError) {
      toast.error(replacementJobCodeOptionsError);
    }
  }, [replacementJobCodeOptionsError]);

  useEffect(() => {
    const search = storedJobCodeSearch.trim();
    if (search.length < 3) {
      setStoredJobCodeOptions([]);
      setStoredJobCodeOptionsLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setStoredJobCodeOptionsLoading(true);

      try {
        const params = new URLSearchParams({
          mode: 'stored-codes',
          q: search,
          limit: '100',
        });
        const response = await fetch(`/api/debug/job-code-corrections?${params.toString()}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null) as StoredJobCodesResponse | null;
        if (!response.ok || !payload?.success) {
          throw new Error(payload?.error || 'Unable to search stored job codes.');
        }

        setStoredJobCodeOptions(payload.job_codes || []);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        toast.error(error instanceof Error ? error.message : 'Unable to search stored job codes.');
      } finally {
        setStoredJobCodeOptionsLoading(false);
      }
    }, 300);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [storedJobCodeSearch]);

  useEffect(() => {
    const search = timesheetSearch.trim();
    if (search.length < 3) {
      setTimesheetResults([]);
      setSelectedTimesheetIds([]);
      setSearchLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setSearchLoading(true);

      try {
        const params = new URLSearchParams({
          q: search,
          limit: '50',
        });
        if (individualFromCode.trim()) params.set('from_job_code', individualFromCode.trim());

        const response = await fetch(`/api/debug/job-code-corrections?${params.toString()}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null) as TimesheetSearchResponse | null;
        if (!response.ok || !payload?.success) {
          throw new Error(payload?.error || 'Unable to search timesheets.');
        }

        const nextTimesheets = payload.timesheets || [];
        setTimesheetResults(nextTimesheets);
        setSelectedTimesheetIds((current) => {
          const availableIds = new Set(nextTimesheets.map((timesheet) => timesheet.id));
          return current.filter((id) => availableIds.has(id));
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        toast.error(error instanceof Error ? error.message : 'Unable to search timesheets.');
      } finally {
        setSearchLoading(false);
      }
    }, 350);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [individualFromCode, timesheetSearch]);

  async function requestCorrectionPreview(scope: CorrectionScope): Promise<JobCodeCorrectionPreview | null> {
    const isBatch = scope === 'batch';
    const fromJobCode = isBatch ? batchFromCode : individualFromCode;
    const toJobCode = isBatch ? batchToCode : individualToCode;
    const setLoading = isBatch ? setBatchLoading : setIndividualLoading;
    const setPreview = isBatch ? setBatchPreview : setIndividualPreview;
    const setResult = isBatch ? setBatchResult : setIndividualResult;

    setLoading(true);
    setResult(null);
    try {
      const response = await fetch('/api/debug/job-code-corrections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'preview',
          scope,
          from_job_code: fromJobCode,
          to_job_code: toJobCode,
          timesheet_ids: isBatch ? [] : selectedTimesheetIds,
          delete_old_legacy_quote: isBatch ? deleteOldLegacyQuote : false,
        }),
      });
      const payload = await response.json().catch(() => null) as JobCodeCorrectionResponse | null;
      if (!response.ok || !payload?.success || !payload.preview) {
        throw new Error(payload?.error || 'Unable to preview job-code correction.');
      }

      setPreview(payload.preview);
      toast.success('Job-code correction preview generated.');
      return payload.preview;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to preview job-code correction.');
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function applyCorrection(scope: CorrectionScope) {
    const isBatch = scope === 'batch';
    const fromJobCode = isBatch ? batchFromCode : individualFromCode;
    const toJobCode = isBatch ? batchToCode : individualToCode;
    const setLoading = isBatch ? setBatchLoading : setIndividualLoading;
    const setPreview = isBatch ? setBatchPreview : setIndividualPreview;
    const setResult = isBatch ? setBatchResult : setIndividualResult;

    setLoading(true);
    try {
      const response = await fetch('/api/debug/job-code-corrections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'apply',
          scope,
          from_job_code: fromJobCode,
          to_job_code: toJobCode,
          timesheet_ids: isBatch ? [] : selectedTimesheetIds,
          delete_old_legacy_quote: isBatch ? deleteOldLegacyQuote : false,
          confirm_destructive_change: true,
        }),
      });
      const payload = await response.json().catch(() => null) as JobCodeCorrectionResponse | null;
      if (!response.ok || !payload?.success || !payload.result) {
        throw new Error(payload?.error || 'Unable to apply job-code correction.');
      }

      setPreview(payload.result.preview);
      setResult(payload.result);
      setConfirmScope(null);
      toast.success('Job-code correction applied.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to apply job-code correction.');
    } finally {
      setLoading(false);
    }
  }

  function toggleTimesheetSelection(timesheetId: string) {
    setSelectedTimesheetIds((current) =>
      current.includes(timesheetId)
        ? current.filter((id) => id !== timesheetId)
        : [...current, timesheetId]
    );
  }

  function selectAllVisibleTimesheets() {
    setSelectedTimesheetIds(timesheetResults.map((timesheet) => timesheet.id));
  }

  function clearSelectedTimesheets() {
    setSelectedTimesheetIds([]);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setLastResult(null);

    try {
      const response = await fetch('/api/debug/legacy-job-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_code: jobCode,
          name,
          customer,
        }),
      });
      const payload = await response.json().catch(() => null) as LegacyJobCodeResponse | null;

      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Unable to add legacy job code.');
      }

      setLastResult(payload.legacy_job_code || null);
      toast.success(payload.message || 'Legacy job code added.');
      if (!payload.legacy_job_code?.wasExisting) {
        setJobCode('');
        setName('');
        setCustomer('');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to add legacy job code.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-brand-yellow/20 bg-slate-950/60">
        <div className="h-1 bg-gradient-to-r from-orange-500 to-red-600" />
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <DatabaseZap className="h-5 w-5 text-red-300" />
            Job Code Corrections
          </CardTitle>
          <CardDescription>
            Preview and apply destructive database changes for incorrect job codes across timesheets and the legacy quotes archive.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <RefreshCw className="h-5 w-5 text-red-300" />
            Batch Change
          </CardTitle>
          <CardDescription>
            Change every stored use of one job code to another across timesheets and the legacy quotes table.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-[220px_220px_1fr]">
            <div className="space-y-2">
              <Label>Change all job codes from</Label>
              <JobCodePicker
                value={batchFromCode}
                onChange={setBatchFromCode}
                placeholder="Select stored code"
                inputClassName="h-10 justify-start border-slate-700 bg-slate-900/70 font-mono uppercase hover:bg-slate-900"
                jobCodeOptions={storedJobCodeOptions}
                jobCodeOptionsLoading={storedJobCodeOptionsLoading}
                onSearchChange={setStoredJobCodeSearch}
                serverSideFiltering
                ariaLabel={batchFromCode ? `Selected source job code ${batchFromCode}` : 'Select source job code for batch change'}
              />
            </div>
            <div className="space-y-2">
              <Label>To</Label>
              <JobCodePicker
                value={batchToCode}
                onChange={setBatchToCode}
                placeholder="Select valid code"
                inputClassName="h-10 justify-start border-emerald-500/30 bg-emerald-500/10 font-mono uppercase text-emerald-50 hover:bg-emerald-500/15"
                jobCodeOptions={replacementJobCodeOptions}
                jobCodeOptionsLoading={replacementJobCodeOptionsLoading}
                ariaLabel={batchToCode ? `Selected replacement job code ${batchToCode}` : 'Select replacement job code for batch change'}
              />
            </div>
            <div className="flex items-end">
              <button
                type="button"
                aria-pressed={deleteOldLegacyQuote}
                onClick={() => setDeleteOldLegacyQuote((current) => !current)}
                className={[
                  'flex min-h-16 w-full items-start gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-all',
                  deleteOldLegacyQuote
                    ? 'border-red-500/70 bg-red-500/15 text-red-50 shadow-[0_0_0_1px_rgba(239,68,68,0.25)] hover:bg-red-500/20'
                    : 'border-slate-700/70 bg-slate-900/60 text-slate-300 hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-100',
                ].join(' ')}
              >
                <span className={[
                  'mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border',
                  deleteOldLegacyQuote ? 'border-red-300 bg-red-500 text-white' : 'border-slate-500 bg-slate-950',
                ].join(' ')}>
                  {deleteOldLegacyQuote ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
                </span>
                <span>
                  <span className="block font-semibold">
                    Delete old legacy quote row if the replacement already exists
                  </span>
                  <span className={deleteOldLegacyQuote ? 'mt-1 block text-xs text-red-100/80' : 'mt-1 block text-xs text-slate-400'}>
                    {deleteOldLegacyQuote
                      ? 'Enabled: old archive rows can be deleted during apply.'
                      : 'Off by default. Click to enable this destructive archive cleanup.'}
                  </span>
                </span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => void requestCorrectionPreview('batch')}
              disabled={batchLoading}
              className="border-blue-500/40 bg-blue-500/10 text-blue-100 hover:bg-blue-500/20 hover:text-blue-50"
            >
              {batchLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Preview Batch Change
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => setConfirmScope('batch')}
              disabled={batchLoading || getTotalChangeCount(batchPreview) === 0}
              className="bg-red-600 text-white shadow-lg shadow-red-950/20 hover:bg-red-700 disabled:shadow-none"
            >
              <AlertTriangle className="mr-2 h-4 w-4" />
              Apply Batch Change
            </Button>
          </div>

          <CorrectionPreviewSummary title="Batch change preview" preview={batchPreview} result={batchResult} />
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Users className="h-5 w-5 text-red-300" />
            Individual Weekly Timesheets
          </CardTitle>
          <CardDescription>
            Select one or more weekly timesheets for a user, then change the chosen job code only within those selected weeks.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-[220px_220px_1fr]">
            <div className="space-y-2">
              <Label>Change from</Label>
              <JobCodePicker
                value={individualFromCode}
                onChange={setIndividualFromCode}
                placeholder="Select stored code"
                inputClassName="h-10 justify-start border-slate-700 bg-slate-900/70 font-mono uppercase hover:bg-slate-900"
                jobCodeOptions={storedJobCodeOptions}
                jobCodeOptionsLoading={storedJobCodeOptionsLoading}
                onSearchChange={setStoredJobCodeSearch}
                serverSideFiltering
                ariaLabel={individualFromCode ? `Selected source job code ${individualFromCode}` : 'Select source job code for individual change'}
              />
            </div>
            <div className="space-y-2">
              <Label>To</Label>
              <JobCodePicker
                value={individualToCode}
                onChange={setIndividualToCode}
                placeholder="Select valid code"
                inputClassName="h-10 justify-start border-emerald-500/30 bg-emerald-500/10 font-mono uppercase text-emerald-50 hover:bg-emerald-500/15"
                jobCodeOptions={replacementJobCodeOptions}
                jobCodeOptionsLoading={replacementJobCodeOptionsLoading}
                ariaLabel={individualToCode ? `Selected replacement job code ${individualToCode}` : 'Select replacement job code for individual change'}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="timesheet-search">Search/filter weekly timesheets</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-500" />
                <Input
                  id="timesheet-search"
                  value={timesheetSearch}
                  onChange={(event) => setTimesheetSearch(event.target.value)}
                  placeholder="Enter at least 3 characters: employee, week ending, or job code"
                  className="pl-9"
                />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-700/70 bg-slate-950/35 p-4">
            <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="font-semibold text-foreground">Timesheet results</h3>
                <p className="text-sm text-slate-400">
                  Results appear only after 3 characters. Selected weeks: {formatNumber(selectedTimesheetIds.length)}.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={selectAllVisibleTimesheets}
                  disabled={timesheetResults.length === 0}
                >
                  Select visible
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={clearSelectedTimesheets}
                  disabled={selectedTimesheetIds.length === 0}
                >
                  Clear
                </Button>
              </div>
            </div>

            {timesheetSearch.trim().length < 3 ? (
              <div className="rounded-lg border border-slate-700/70 bg-slate-900/60 p-6 text-center text-sm text-slate-400">
                Enter at least 3 characters to search weekly timesheets.
              </div>
            ) : searchLoading ? (
              <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-700/70 bg-slate-900/60 p-6 text-sm text-slate-300">
                <Loader2 className="h-4 w-4 animate-spin" />
                Searching timesheets...
              </div>
            ) : timesheetResults.length === 0 ? (
              <div className="rounded-lg border border-slate-700/70 bg-slate-900/60 p-6 text-center text-sm text-slate-400">
                No weekly timesheets match the current search.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-700/70">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-12">Select</TableHead>
                      <TableHead>Employee</TableHead>
                      <TableHead>Week Ending</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Job Codes</TableHead>
                      <TableHead className="text-right">Matches</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {timesheetResults.map((timesheet) => {
                      const checked = selectedTimesheetIds.includes(timesheet.id);
                      return (
                        <TableRow key={timesheet.id} data-state={checked ? 'selected' : undefined}>
                          <TableCell>
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => toggleTimesheetSelection(timesheet.id)}
                              aria-label={`Select ${timesheet.employeeName} timesheet ending ${timesheet.weekEnding}`}
                            />
                          </TableCell>
                          <TableCell>
                            <p className="font-medium text-foreground">{timesheet.employeeName}</p>
                            <p className="text-xs text-slate-400">{timesheet.employeeId || 'No employee ID'}</p>
                          </TableCell>
                          <TableCell className="text-slate-200">{formatWeekEnding(timesheet.weekEnding)}</TableCell>
                          <TableCell>
                            <Badge className={getStatusBadgeClassName(timesheet.status)}>{timesheet.status}</Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex max-w-xl flex-wrap gap-1">
                              {timesheet.jobCodes.length > 0 ? timesheet.jobCodes.map((code) => (
                                <Badge key={code} variant="outline" className="border-slate-600 text-slate-200">
                                  {code}
                                </Badge>
                              )) : <span className="text-sm text-slate-500">No job codes</span>}
                            </div>
                          </TableCell>
                          <TableCell className="text-right text-slate-300">
                            {formatNumber(timesheet.matchingJobCodeCount)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          {selectedTimesheets.length > 0 ? (
            <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-4 text-sm text-blue-100">
              <p className="font-semibold">Selected weekly timesheets</p>
              <p className="mt-1 text-blue-100/85">
                {selectedTimesheets.map((timesheet) => `${timesheet.employeeName} (${formatWeekEnding(timesheet.weekEnding)})`).join(', ')}
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => void requestCorrectionPreview('individual')}
              disabled={individualLoading || selectedTimesheetIds.length === 0}
              className="border-blue-500/40 bg-blue-500/10 text-blue-100 hover:bg-blue-500/20 hover:text-blue-50"
            >
              {individualLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Preview Individual Change
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => setConfirmScope('individual')}
              disabled={individualLoading || getTotalChangeCount(individualPreview) === 0}
              className="bg-red-600 text-white shadow-lg shadow-red-950/20 hover:bg-red-700 disabled:shadow-none"
            >
              <AlertTriangle className="mr-2 h-4 w-4" />
              Apply Individual Change
            </Button>
          </div>

          <CorrectionPreviewSummary title="Individual change preview" preview={individualPreview} result={individualResult} />
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <PlusCircle className="h-5 w-5 text-red-300" />
            Add Missing Legacy Job Code
          </CardTitle>
          <CardDescription>
            Add missing job codes to the read-only legacy quotes archive so they appear in the timesheet job-code picker.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-[220px_1fr_1fr_auto]" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="legacy-job-code">Job code</Label>
              <Input
                id="legacy-job-code"
                value={jobCode}
                onChange={(event) => setJobCode(normalizeDisplayCode(event.target.value))}
                placeholder="0003-NF"
                className="uppercase"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="legacy-job-name">Name</Label>
              <Input
                id="legacy-job-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Short description"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="legacy-job-customer">Customer</Label>
              <Input
                id="legacy-job-customer"
                value={customer}
                onChange={(event) => setCustomer(event.target.value)}
                placeholder="Customer name"
                required
              />
            </div>
            <div className="flex items-end">
              <Button
                type="submit"
                disabled={submitting}
                className="w-full bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90 md:w-auto"
              >
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4" />}
                Add Code
              </Button>
            </div>
          </form>

          {lastResult ? (
            <div className="mt-4 rounded-lg border border-slate-700 bg-slate-900/60 p-4 text-sm text-slate-200">
              <p className="font-semibold text-foreground">
                {lastResult.wasExisting ? 'Already existed' : 'Added'}: {lastResult.quote_reference}
              </p>
              <p className="mt-1 text-slate-400">{lastResult.customer_name} - {lastResult.title}</p>
            </div>
          ) : null}

          <p className="mt-4 text-xs text-slate-400">
            This writes to `legacy_quotes` only. It does not create live quotes or project numbers.
          </p>
        </CardContent>
      </Card>

      <AlertDialog open={Boolean(confirmScope)} onOpenChange={(open) => !open && setConfirmScope(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Confirm destructive job-code change
            </AlertDialogTitle>
            <AlertDialogDescription>
              {activePreview ? (
                <>
                  This will change <strong>{activePreview.fromJobCode}</strong> to <strong>{activePreview.toJobCode}</strong>{' '}
                  and apply {formatNumber(getTotalChangeCount(activePreview))} destructive database change(s). This action cannot be undone from this screen.
                </>
              ) : (
                'Generate a preview before applying this destructive database change.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {activePreview?.counts.legacyQuoteRowsToDelete ? (
            <div className="flex gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
              <Trash2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <p>{formatNumber(activePreview.counts.legacyQuoteRowsToDelete)} legacy quote archive row(s) will be deleted.</p>
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={activeApplyLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (confirmScope) void applyCorrection(confirmScope);
              }}
              disabled={!activePreview || getTotalChangeCount(activePreview) === 0 || activeApplyLoading}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {activeApplyLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <AlertTriangle className="mr-2 h-4 w-4" />}
              Apply Destructive Change
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
