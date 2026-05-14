'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { PageLoader } from '@/components/ui/page-loader';
import { AppPageShell } from '@/components/layout/AppPageShell';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { toast } from 'sonner';
import { useQueryState } from 'nuqs';
import { NuqsClientAdapter } from '@/components/providers/NuqsClientAdapter';
import {
  Calendar,
  ClipboardList,
  Download,
  FileArchive,
  FileText,
  Loader2,
  Package,
  PlaneTakeoff,
  Settings,
} from 'lucide-react';

interface BulkDownloadProgress {
  isDownloading: boolean;
  current: number;
  total: number;
  currentPart: number;
  totalParts: number;
  status: string;
}

interface ReportCardConfig {
  title: string;
  description: string;
  dateUsageNote?: string;
  endpoint: string;
  filenamePrefix: string;
  buttonClassName: string;
}

interface ReportActionCardProps {
  report: ReportCardConfig;
  dateFrom: string;
  dateTo: string;
  downloadingEndpoint: string | null;
  onDownload: (endpoint: string, filename: string) => Promise<void>;
}

interface ReportDateRangeCardProps {
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onSetLastWeek: () => void;
  onSetLastMonth: () => void;
  onSetThisMonth: () => void;
}

interface UserSuggestedReport {
  id: string;
  title: string;
  description: string;
  suggestedBy: string | null;
  createdAt: string;
}

type ReportsPageTab = 'overview' | 'settings';
type ReportsFilterTab = 'timesheets' | 'daily-checks' | 'absence-leave' | 'future';

const TIMESHEET_REPORTS: ReportCardConfig[] = [
  {
    title: 'Weekly Timesheet Summary',
    description: 'Daily hours, leave-aware totals, and did-not-work details.',
    endpoint: '/api/reports/timesheets/summary',
    filenamePrefix: 'Timesheet_Summary',
    buttonClassName: 'bg-timesheet hover:bg-timesheet-dark text-white',
  },
  {
    title: 'Payroll Export',
    description: 'Approved worked hours with overtime and leave breakdown for payroll.',
    endpoint: '/api/reports/timesheets/payroll',
    filenamePrefix: 'Payroll_Export',
    buttonClassName: 'bg-timesheet hover:bg-timesheet-dark text-white',
  },
];

const DAILY_CHECK_REPORTS: ReportCardConfig[] = [
  {
    title: 'Daily Checks Compliance Summary',
    description: 'Daily check completion and compliance performance across van, plant, and HGV checks.',
    endpoint: '/api/reports/inspections/compliance',
    filenamePrefix: 'Daily_Checks_Compliance',
    buttonClassName: 'bg-inspection hover:bg-inspection-dark text-white',
  },
  {
    title: 'Daily Checks Defects Log',
    description: 'All reported daily check defects requiring review and follow-up actions.',
    endpoint: '/api/reports/inspections/defects',
    filenamePrefix: 'Daily_Checks_Defects_Log',
    buttonClassName: 'bg-inspection hover:bg-inspection-dark text-white',
  },
];

const ABSENCE_REPORTS: ReportCardConfig[] = [
  {
    title: 'Absence & Leave Bookings',
    description: 'Approved active and archived bookings that overlap the selected date range.',
    endpoint: '/api/reports/absence-leave/bookings',
    filenamePrefix: 'Absence_Leave_Bookings',
    buttonClassName: 'bg-absence hover:bg-absence-dark text-white',
  },
  {
    title: 'Absence Allowance Snapshot',
    description: 'Employee annual leave allowance and booking totals at a single snapshot date.',
    dateUsageNote: 'This report uses START DATE only. END DATE is ignored.',
    endpoint: '/api/reports/absence-leave/allowance-totals',
    filenamePrefix: 'Absence_Allowance_Snapshot',
    buttonClassName: 'bg-absence hover:bg-absence-dark text-white',
  },
];
const ABSENCE_WEEKLY_PRINT_PDF_ENDPOINT = '/api/reports/absence-leave/weekly-print-pdf';

const DEFAULT_USER_SUGGESTIONS: Array<Pick<UserSuggestedReport, 'title' | 'description'>> = [
  {
    title: 'Approval SLA & Backlog',
    description: 'Approval turnaround times and outstanding workload by module and team.',
  },
  {
    title: 'Maintenance Risk Window',
    description: 'Vehicles and equipment due or overdue by mileage/date with severity ranking.',
  },
  {
    title: 'Quotes Conversion Funnel',
    description: 'Quotes created, accepted, declined, and aging pipeline by customer owner/team.',
  },
];

function formatDateInput(date: Date): string {
  return date.toISOString().split('T')[0];
}

function getMonday(date: Date): Date {
  const nextDate = new Date(date);
  const day = nextDate.getDay();
  const diff = nextDate.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(nextDate.setDate(diff));
}

function getSunday(date: Date): Date {
  const monday = getMonday(date);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return sunday;
}

function resetBulkProgress(): BulkDownloadProgress {
  return {
    isDownloading: false,
    current: 0,
    total: 0,
    currentPart: 1,
    totalParts: 1,
    status: '',
  };
}

function isReportsPageTab(value: string): value is ReportsPageTab {
  return value === 'overview' || value === 'settings';
}

function isReportsFilterTab(value: string): value is ReportsFilterTab {
  return value === 'timesheets' || value === 'daily-checks' || value === 'absence-leave' || value === 'future';
}

function downloadBase64File(fileName: string, base64Data: string, contentType: string): void {
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);

  for (let index = 0; index < binaryString.length; index += 1) {
    bytes[index] = binaryString.charCodeAt(index);
  }

  const blob = new Blob([bytes], { type: contentType });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(anchor);
}

function ReportActionCard({ report, dateFrom, dateTo, downloadingEndpoint, onDownload }: ReportActionCardProps) {
  const isDownloading = downloadingEndpoint === report.endpoint;

  return (
    <Card className="border-border transition-colors hover:border-brand-yellow/40">
      <CardContent className="flex flex-col gap-4 p-6 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <h3 className="text-lg font-semibold text-foreground">{report.title}</h3>
          <p className="text-sm text-muted-foreground">{report.description}</p>
          {report.dateUsageNote ? <p className="text-xs font-medium text-foreground">{report.dateUsageNote}</p> : null}
        </div>

        <Button
          onClick={() => onDownload(report.endpoint, `${report.filenamePrefix}_${dateFrom}_to_${dateTo}.xlsx`)}
          disabled={isDownloading}
          variant="default"
          className={`${report.buttonClassName} md:ml-4`}
        >
          {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
          Download
        </Button>
      </CardContent>
    </Card>
  );
}

function ReportDateRangeCard({
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onSetLastWeek,
  onSetLastMonth,
  onSetThisMonth,
}: ReportDateRangeCardProps) {
  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Calendar className="h-5 w-5 text-brand-yellow" />
          Report Date Range
        </CardTitle>
        <CardDescription>
          This report tab uses the selected date range. Default selection is the previous week.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="report-date-from">Date From</Label>
            <Input id="report-date-from" type="date" value={dateFrom} onChange={(event) => onDateFromChange(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="report-date-to">Date To</Label>
            <Input id="report-date-to" type="date" value={dateTo} onChange={(event) => onDateToChange(event.target.value)} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onSetLastWeek}>
            Last Week
          </Button>
          <Button variant="outline" size="sm" onClick={onSetLastMonth}>
            Last Month
          </Button>
          <Button variant="outline" size="sm" onClick={onSetThisMonth}>
            This Month
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ReportsContent() {
  const { hasPermission: canViewReports, loading: reportsPermissionLoading } = usePermissionCheck('reports');
  const [tabParam, setTabParam] = useQueryState('tab', {
    defaultValue: 'overview',
    clearOnDefault: true,
    shallow: true,
  });
  const [reportTabParam, setReportTabParam] = useQueryState('reportTab', {
    defaultValue: 'timesheets',
    clearOnDefault: true,
    shallow: true,
  });
  const [downloadingEndpoint, setDownloadingEndpoint] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [bulkProgress, setBulkProgress] = useState<BulkDownloadProgress>(resetBulkProgress());
  const abortControllerRef = useRef<AbortController | null>(null);
  const hasSeededDefaultSuggestionsRef = useRef(false);
  const [suggestedReportTitle, setSuggestedReportTitle] = useState('');
  const [suggestedReportDescription, setSuggestedReportDescription] = useState('');
  const [userSuggestedReports, setUserSuggestedReports] = useState<UserSuggestedReport[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionSubmitting, setSuggestionSubmitting] = useState(false);

  const setLastWeek = useCallback(() => {
    const today = new Date();
    const lastWeekEnd = new Date(today);
    lastWeekEnd.setDate(today.getDate() - today.getDay() - (today.getDay() === 0 ? 0 : 1));
    const start = getMonday(lastWeekEnd);
    const end = getSunday(start);
    setDateFrom(formatDateInput(start));
    setDateTo(formatDateInput(end));
  }, []);

  const setLastMonth = useCallback(() => {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 0);
    setDateFrom(formatDateInput(start));
    setDateTo(formatDateInput(end));
  }, []);

  const setThisMonth = useCallback(() => {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    setDateFrom(formatDateInput(start));
    setDateTo(formatDateInput(today));
  }, []);

  useEffect(() => {
    setLastWeek();
  }, [setLastWeek]);

  const fetchSuggestedReports = useCallback(async (allowSeed = true): Promise<void> => {
    setSuggestionsLoading(true);

    try {
      const response = await fetch('/api/reports/suggestions');
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; suggestions?: Array<{ id: string; title: string; body: string; created_at: string; user?: { full_name: string | null } | null }> }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to load report suggestions');
      }

      const mappedSuggestions: UserSuggestedReport[] = (payload?.suggestions || []).map((suggestion) => ({
        id: suggestion.id,
        title: suggestion.title,
        description: suggestion.body,
        suggestedBy: suggestion.user?.full_name || null,
        createdAt: suggestion.created_at,
      }));

      if (allowSeed && mappedSuggestions.length === 0 && !hasSeededDefaultSuggestionsRef.current) {
        hasSeededDefaultSuggestionsRef.current = true;

        await Promise.all(
          DEFAULT_USER_SUGGESTIONS.map(async (defaultSuggestion) => {
            await fetch('/api/reports/suggestions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                title: defaultSuggestion.title,
                body: defaultSuggestion.description,
              }),
            });
          })
        );

        await fetchSuggestedReports(false);
        return;
      }

      setUserSuggestedReports(mappedSuggestions);
    } catch (error) {
      console.error('Failed to fetch report suggestions:', error);
      toast.error('Failed to load report suggestions', {
        description: 'Please refresh and try again.',
      });
    } finally {
      setSuggestionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canViewReports || reportsPermissionLoading) return;
    void fetchSuggestedReports();
  }, [canViewReports, reportsPermissionLoading, fetchSuggestedReports]);

  useEffect(() => {
    if (reportTabParam === 'inspections') {
      void setReportTabParam('daily-checks');
    }
  }, [reportTabParam, setReportTabParam]);

  useEffect(() => {
    if (isReportsFilterTab(tabParam)) {
      void setTabParam('overview');
      void setReportTabParam(tabParam);
      return;
    }

    if (tabParam === 'inspections') {
      void setTabParam('overview');
      void setReportTabParam('daily-checks');
    }
  }, [tabParam, setTabParam, setReportTabParam]);

  async function downloadReport(endpoint: string, filename: string): Promise<void> {
    const errorContextId = 'reports-download-error';
    setDownloadingEndpoint(endpoint);

    try {
      const queryParams = new URLSearchParams({ dateFrom, dateTo });
      const response = await fetch(`${endpoint}?${queryParams.toString()}`);

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        toast.error('Failed to generate report', {
          id: errorContextId,
          description: payload?.error || 'Please try again or contact support.',
        });
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(anchor);
    } catch (error) {
      console.error('Error downloading report:', error, { errorContextId, endpoint });
      toast.error('Failed to download report', {
        id: errorContextId,
        description: 'Please try again or contact support if the issue persists.',
      });
    } finally {
      setDownloadingEndpoint(null);
    }
  }

  async function downloadBulkInspectionPDFs(): Promise<void> {
    const errorContextId = 'reports-bulk-inspection-download-error';
    abortControllerRef.current = new AbortController();
    setBulkProgress({
      isDownloading: true,
      current: 0,
      total: 0,
      currentPart: 1,
      totalParts: 1,
      status: 'Generating daily check PDFs...',
    });

    try {
      const response = await fetch('/api/reports/inspections/bulk-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateFrom, dateTo }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        toast.error('Failed to generate daily check PDFs', {
          id: errorContextId,
          description: payload?.error || 'Please try again or contact support.',
        });
        setBulkProgress(resetBulkProgress());
        return;
      }

      if (!response.body) {
        toast.error('Failed to generate daily check PDFs', {
          id: errorContextId,
          description: 'No stream received from server.',
        });
        setBulkProgress(resetBulkProgress());
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let completed = false;

      while (!completed) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }

          const data = JSON.parse(line) as {
            type?: 'init' | 'progress' | 'complete';
            total?: number;
            numParts?: number;
            current?: number;
            currentPart?: number;
            totalParts?: number;
            fileName?: string;
            contentType?: string;
            data?: string;
            error?: string;
          };

          if (data.error) {
            toast.error('Failed during bulk PDF generation', {
              id: errorContextId,
              description: data.error,
            });
            setBulkProgress(resetBulkProgress());
            completed = true;
            break;
          }

          if (data.type === 'init') {
            setBulkProgress((prev) => ({
              ...prev,
              total: data.total || 0,
              totalParts: data.numParts || 1,
            }));
          }

          if (data.type === 'progress') {
            setBulkProgress((prev) => ({
              ...prev,
              current: data.current || 0,
              total: data.total || prev.total,
              currentPart: data.currentPart || prev.currentPart,
              totalParts: data.totalParts || prev.totalParts,
            }));
          }

          if (data.type === 'complete' && data.data && data.fileName && data.contentType) {
            downloadBase64File(data.fileName, data.data, data.contentType);
            setBulkProgress(resetBulkProgress());
            completed = true;
            break;
          }
        }

        if (done) {
          break;
        }
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) {
        console.error('Error downloading bulk daily check PDFs:', error, { errorContextId });
        toast.error('Failed to download bulk daily check PDFs', {
          id: errorContextId,
          description: 'Please try again or contact support if the issue persists.',
        });
      }
      setBulkProgress(resetBulkProgress());
    }
  }

  async function addSuggestedReport() {
    const trimmedTitle = suggestedReportTitle.trim();
    const trimmedDescription = suggestedReportDescription.trim();

    if (!trimmedTitle || !trimmedDescription) {
      toast.error('Please enter a report name and description before adding your suggestion.');
      return;
    }

    setSuggestionSubmitting(true);

    try {
      const response = await fetch('/api/reports/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: trimmedTitle,
          body: trimmedDescription,
        }),
      });

      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to add suggestion');
      }

      setSuggestedReportTitle('');
      setSuggestedReportDescription('');
      toast.success('Report suggestion added.');
      await fetchSuggestedReports(false);
    } catch (error) {
      console.error('Failed to add report suggestion:', error);
      toast.error('Failed to add report suggestion', {
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    } finally {
      setSuggestionSubmitting(false);
    }
  }

  const isInitialLoading = reportsPermissionLoading || !dateFrom || !dateTo;
  const activePageTab: ReportsPageTab = isReportsPageTab(tabParam) ? tabParam : 'overview';
  const activeFilterTab: ReportsFilterTab = isReportsFilterTab(reportTabParam)
    ? reportTabParam
    : reportTabParam === 'inspections'
      ? 'daily-checks'
      : isReportsFilterTab(tabParam)
      ? tabParam
      : tabParam === 'inspections'
        ? 'daily-checks'
      : 'timesheets';

  if (isInitialLoading) {
    return <PageLoader message="Preparing reports..." />;
  }

  if (!canViewReports) {
    return null;
  }

  return (
    <AppPageShell>
      <div className="rounded-lg border border-border bg-white p-6 dark:bg-slate-900">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-brand-yellow/15 p-2 text-brand-yellow">
            <FileText className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <h1 className="text-3xl font-bold text-foreground">Reports</h1>
            <p className="text-sm text-muted-foreground">
              Generate operational reports aligned to your current module and team permissions.
            </p>
          </div>
        </div>
      </div>

      <Tabs
        value={activePageTab}
        onValueChange={(value) => {
          if (isReportsPageTab(value)) {
            void setTabParam(value);
          }
        }}
        className="space-y-6"
      >
        <TabsList>
          <TabsTrigger value="overview" className="gap-2">
            <FileText className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2">
            <Settings className="h-4 w-4" />
            Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-0 space-y-4">
          <div className="flex justify-end">
            <Tabs
              value={activeFilterTab}
              onValueChange={(value) => {
                if (isReportsFilterTab(value)) {
                  void setReportTabParam(value);
                  if (activePageTab !== 'overview') {
                    void setTabParam('overview');
                  }
                }
              }}
            >
              <TabsList>
                <TabsTrigger value="timesheets" className="gap-2">
                  <FileText className="h-4 w-4" />
                  Timesheets
                </TabsTrigger>
                <TabsTrigger value="daily-checks" className="gap-2">
                  <ClipboardList className="h-4 w-4" />
                  Daily Checks
                </TabsTrigger>
                <TabsTrigger value="absence-leave" className="gap-2">
                  <PlaneTakeoff className="h-4 w-4" />
                  Absence & Leave
                </TabsTrigger>
                <TabsTrigger value="future" className="gap-2">
                  <Package className="h-4 w-4" />
                  More Reports
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {activeFilterTab === 'timesheets' &&
            (
              <div className="space-y-4">
                <ReportDateRangeCard
                  dateFrom={dateFrom}
                  dateTo={dateTo}
                  onDateFromChange={setDateFrom}
                  onDateToChange={setDateTo}
                  onSetLastWeek={setLastWeek}
                  onSetLastMonth={setLastMonth}
                  onSetThisMonth={setThisMonth}
                />
                {TIMESHEET_REPORTS.map((report) => (
                  <ReportActionCard
                    key={report.endpoint}
                    report={report}
                    dateFrom={dateFrom}
                    dateTo={dateTo}
                    downloadingEndpoint={downloadingEndpoint}
                    onDownload={downloadReport}
                  />
                ))}
              </div>
            )}

          {activeFilterTab === 'daily-checks' && (
            <div className="space-y-4">
              <ReportDateRangeCard
                dateFrom={dateFrom}
                dateTo={dateTo}
                onDateFromChange={setDateFrom}
                onDateToChange={setDateTo}
                onSetLastWeek={setLastWeek}
                onSetLastMonth={setLastMonth}
                onSetThisMonth={setThisMonth}
              />
              {DAILY_CHECK_REPORTS.map((report) => (
                <ReportActionCard
                  key={report.endpoint}
                  report={report}
                  dateFrom={dateFrom}
                  dateTo={dateTo}
                  downloadingEndpoint={downloadingEndpoint}
                  onDownload={downloadReport}
                />
              ))}

              <Card className="border-border transition-colors hover:border-brand-yellow/40">
                <CardContent className="flex flex-col gap-4 p-6 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-2">
                    <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                      <FileArchive className="h-5 w-5" />
                      Bulk Daily Check PDFs
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Download all van, plant, and HGV daily checks in range as one PDF or a ZIP split by size.
                    </p>
                    {bulkProgress.isDownloading && (
                      <div className="space-y-2 pt-1">
                        <Progress value={bulkProgress.total > 0 ? (bulkProgress.current / bulkProgress.total) * 100 : 0} />
                        <p className="text-xs text-muted-foreground">
                          {bulkProgress.total > 0
                            ? `Processing ${bulkProgress.current} of ${bulkProgress.total} daily checks${
                                bulkProgress.totalParts > 1
                                  ? ` (Part ${bulkProgress.currentPart}/${bulkProgress.totalParts})`
                                  : ''
                              }`
                            : bulkProgress.status}
                        </p>
                      </div>
                    )}
                  </div>

                  <Button
                    onClick={downloadBulkInspectionPDFs}
                    disabled={bulkProgress.isDownloading}
                    className="bg-inspection hover:bg-inspection-dark text-white md:ml-4"
                  >
                    {bulkProgress.isDownloading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="mr-2 h-4 w-4" />
                    )}
                    Download
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}

          {activeFilterTab === 'absence-leave' &&
            (
              <div className="space-y-4">
                <ReportDateRangeCard
                  dateFrom={dateFrom}
                  dateTo={dateTo}
                  onDateFromChange={setDateFrom}
                  onDateToChange={setDateTo}
                  onSetLastWeek={setLastWeek}
                  onSetLastMonth={setLastMonth}
                  onSetThisMonth={setThisMonth}
                />
                {ABSENCE_REPORTS.map((report) => (
                  <ReportActionCard
                    key={report.endpoint}
                    report={report}
                    dateFrom={dateFrom}
                    dateTo={dateTo}
                    downloadingEndpoint={downloadingEndpoint}
                    onDownload={downloadReport}
                  />
                ))}

                <Card className="border-border transition-colors hover:border-brand-yellow/40">
                  <CardContent className="flex flex-col gap-4 p-6 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-2">
                      <h3 className="text-lg font-semibold text-foreground">Absence Weekly Print Sheet</h3>
                      <p className="text-sm text-muted-foreground">
                        Weekly printable day-by-day report with national holiday flags and employees off with reasons.
                      </p>
                      <p className="text-xs font-medium text-foreground">
                        Uses selected date range and auto-splits into weekly pages.
                      </p>
                    </div>

                    <div className="flex flex-col gap-2 md:ml-4 md:items-end">
                      <Button
                        onClick={() =>
                          downloadReport(
                            ABSENCE_WEEKLY_PRINT_PDF_ENDPOINT,
                            `Absence_Weekly_Print_${dateFrom}_to_${dateTo}.pdf`
                          )
                        }
                        disabled={downloadingEndpoint === ABSENCE_WEEKLY_PRINT_PDF_ENDPOINT}
                        className="bg-absence hover:bg-absence-dark text-white"
                      >
                        {downloadingEndpoint === ABSENCE_WEEKLY_PRINT_PDF_ENDPOINT ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="mr-2 h-4 w-4" />
                        )}
                        Download
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

          {activeFilterTab === 'future' && (
            <div className="space-y-4">
              <Card className="border-border">
                <CardHeader>
                  <CardTitle className="text-foreground">Suggest a Report</CardTitle>
                  <CardDescription>
                    Add your own report ideas for admins and management to review.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="suggest-report-title">Report Name</Label>
                    <Input
                      id="suggest-report-title"
                      value={suggestedReportTitle}
                      onChange={(event) => setSuggestedReportTitle(event.target.value)}
                      placeholder="e.g. Team Absence Trend by Month"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="suggest-report-description">Description</Label>
                    <Input
                      id="suggest-report-description"
                      value={suggestedReportDescription}
                      onChange={(event) => setSuggestedReportDescription(event.target.value)}
                      placeholder="Briefly describe what this report should show"
                    />
                  </div>

                  <Button type="button" onClick={addSuggestedReport} disabled={suggestionSubmitting}>
                    {suggestionSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Add Suggestion
                  </Button>

                  {suggestionsLoading && (
                    <p className="text-sm text-muted-foreground">Loading report suggestions...</p>
                  )}

                  {!suggestionsLoading && userSuggestedReports.length > 0 && (
                    <div className="space-y-3 border-t border-border pt-4">
                      <p className="text-sm font-medium text-foreground">Suggested Reports</p>
                      {userSuggestedReports.map((suggestion) => (
                        <div key={suggestion.id} className="rounded-md border border-border p-4">
                          <h3 className="font-medium text-foreground">{suggestion.title}</h3>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Suggested by {suggestion.suggestedBy || 'Unknown user'} on{' '}
                            {new Date(suggestion.createdAt).toLocaleDateString('en-GB')}
                          </p>
                          <p className="mt-2 text-sm text-muted-foreground">{suggestion.description}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {!suggestionsLoading && userSuggestedReports.length === 0 && (
                    <p className="text-sm text-muted-foreground">No report suggestions yet.</p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="settings" className="mt-0">
          <Card className="border-border">
            <CardContent className="py-10">
              <p className="text-sm text-muted-foreground">No settings for this module yet.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </AppPageShell>
  );
}

export default function ReportsPage() {
  return (
    <NuqsClientAdapter>
      <ReportsContent />
    </NuqsClientAdapter>
  );
}
