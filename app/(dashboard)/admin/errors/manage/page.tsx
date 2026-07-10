'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { AppPageShell } from '@/components/layout/AppPageShell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageLoader } from '@/components/ui/page-loader';
import { PanelLoader } from '@/components/ui/panel-loader';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { ReviewDetailDialog } from '@/components/management/ReviewDetailDialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  AlertTriangle, 
  Loader2, 
  Search,
  CheckCircle2,
  Eye,
  User,
  Clock,
  ImageIcon
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDateTime } from '@/lib/utils/date';
import { fetchAllPaginatedItems } from '@/lib/client/paginated-fetch';
import { getErrorReportScreenshots } from '@/lib/utils/error-report-screenshots';
import type { 
  ErrorReportWithUser, 
  ErrorReportStatus, 
  ErrorReportUpdateWithUser 
} from '@/types/error-reports';
import { 
  ERROR_REPORT_STATUS_LABELS, 
  ERROR_REPORT_STATUS_COLORS 
} from '@/types/error-reports';

function buildErrorReportScreenshotUrl(reportId: string, screenshotId: string): string {
  return `/api/error-reports/${encodeURIComponent(reportId)}/screenshots/${encodeURIComponent(screenshotId)}`;
}

export default function ErrorReportsManagePage() {
  const router = useRouter();
  const { hasPermission: canManageErrors, loading: permissionLoading } = usePermissionCheck('error-reports', false);
  
  const [reports, setReports] = useState<ErrorReportWithUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [countsLoaded, setCountsLoaded] = useState(false);
  
  // Detail dialog
  const [selectedReport, setSelectedReport] = useState<ErrorReportWithUser | null>(null);
  const [reportUpdates, setReportUpdates] = useState<ErrorReportUpdateWithUser[]>([]);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  
  // Update form
  const [newStatus, setNewStatus] = useState<ErrorReportStatus | ''>('');
  const [adminNote, setAdminNote] = useState('');
  const [updateNote, setUpdateNote] = useState('');
  const [updating, setUpdating] = useState(false);


  // Redirect non-admins
  useEffect(() => {
    if (!permissionLoading && !canManageErrors) {
      router.push('/dashboard');
    }
  }, [permissionLoading, canManageErrors, router]);

  const fetchReports = useCallback(async (filter: string) => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filter !== 'all') {
        params.set('status', filter);
      }
      const endpoint = params.size > 0
        ? `/api/management/error-reports?${params.toString()}`
        : '/api/management/error-reports';
      const result = await fetchAllPaginatedItems<ErrorReportWithUser>(endpoint, 'reports', {
        limit: 200,
        errorMessage: 'Failed to fetch error reports',
      });

      setReports(result.items);
      setCounts((result.firstPagePayload?.counts as Record<string, number> | undefined) || {});
      setCountsLoaded(true);
    } catch (error) {
      const errorContextId = 'admin-errors-fetch-reports-error';
      console.error('Error fetching error reports:', error, { errorContextId });
      toast.error('Failed to load error reports', { id: errorContextId });
      setCountsLoaded(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch reports
  useEffect(() => {
    if (canManageErrors) {
      fetchReports(statusFilter);
    }
  }, [statusFilter, canManageErrors, fetchReports]);

  const openDetailDialog = async (report: ErrorReportWithUser) => {
    setSelectedReport(report);
    setNewStatus(report.status);
    setAdminNote(report.admin_notes || '');
    setUpdateNote('');
    setDetailDialogOpen(true);
    
    // Fetch update history
    try {
      setLoadingDetail(true);
      const response = await fetch(`/api/management/error-reports/${report.id}`);
      const data = await response.json();
      
      if (data.success) {
        setReportUpdates(data.updates || []);
      }
    } catch (error) {
      const errorContextId = 'admin-errors-fetch-report-details-error';
      console.error('Error fetching report details:', error, { errorContextId });
      toast.error('Failed to load error report details', { id: errorContextId });
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleUpdateReport = async () => {
    if (!selectedReport) return;
    
    try {
      setUpdating(true);
      
      const response = await fetch(`/api/management/error-reports/${selectedReport.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: newStatus || undefined,
          admin_notes: adminNote || undefined,
          note: updateNote || undefined,
        }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        toast.success('Error report updated');
        setDetailDialogOpen(false);
        fetchReports(statusFilter);
      } else {
        throw new Error(data.error || 'Failed to update error report');
      }
    } catch (error) {
      const errorContextId = 'admin-errors-update-report-error';
      console.error('Error updating report:', error, { errorContextId });
      toast.error('Failed to update error report', { id: errorContextId });
    } finally {
      setUpdating(false);
    }
  };

  // Filter reports by search
  const filteredReports = reports.filter(r => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      r.title.toLowerCase().includes(query) ||
      r.description.toLowerCase().includes(query) ||
      r.user?.full_name?.toLowerCase().includes(query) ||
      r.error_code?.toLowerCase().includes(query)
    );
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'new': return <AlertTriangle className="h-4 w-4" />;
      case 'investigating': return <Eye className="h-4 w-4" />;
      case 'resolved': return <CheckCircle2 className="h-4 w-4" />;
      default: return <Clock className="h-4 w-4" />;
    }
  };

  if (permissionLoading) {
    return <PageLoader message="Loading error reports..." />;
  }

  if (!canManageErrors) {
    return null;
  }

  const showCountsLoading = loading && !countsLoaded;
  const selectedReportScreenshots = selectedReport
    ? getErrorReportScreenshots(selectedReport.additional_context)
    : [];
  const selectedReportContext = selectedReport?.additional_context
    ? JSON.stringify(selectedReport.additional_context, null, 2)
    : '';

  return (
    <AppPageShell>
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-border">
        <div className="flex items-start gap-3">
          <div className="shrink-0 p-3 bg-red-100 dark:bg-red-950 rounded-lg">
            <AlertTriangle className="h-6 w-6 text-red-600" />
          </div>
          <div className="min-w-0">
            <h1 className="text-3xl font-bold text-foreground mb-2">
              Manage Error Reports
            </h1>
            <p className="text-muted-foreground">
              Review and resolve user-reported errors
            </p>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { key: 'all', label: 'All', color: 'bg-slate-500' },
          { key: 'new', label: 'New', color: 'bg-red-500' },
          { key: 'investigating', label: 'Investigating', color: 'bg-yellow-500' },
          { key: 'resolved', label: 'Resolved', color: 'bg-green-500' },
        ].map(({ key, label, color }) => (
          <Card 
            key={key}
            className={`cursor-pointer transition-all ${
              statusFilter === key ? 'ring-2 ring-red-500 bg-white/10' : ''
            } bg-white dark:bg-slate-900 border-border`}
            onClick={() => setStatusFilter(key)}
          >
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  {showCountsLoading ? (
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mt-1" />
                  ) : (
                    <p className="text-2xl font-bold text-foreground">
                      {counts[key] || 0}
                    </p>
                  )}
                </div>
                <div className={`h-3 w-3 rounded-full ${color}`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search */}
      <Card className="">
        <CardContent className="pt-4">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search error reports..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-slate-50 dark:bg-slate-800 dark:text-slate-100 text-slate-900"
            />
          </div>
        </CardContent>
      </Card>

      {/* Error Reports List */}
      <Card className="">
        <CardHeader>
          <CardTitle className="text-foreground">
            Error Reports
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {filteredReports.length} report{filteredReports.length !== 1 ? 's' : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <PanelLoader message="Loading error reports..." accent="debug" className="py-8" />
          ) : filteredReports.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p>No error reports found</p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredReports.map((report) => (
                <div
                  key={report.id}
                  className="p-4 rounded-lg border border-border bg-slate-50 dark:bg-slate-800 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                  onClick={() => openDetailDialog(report)}
                >
                  <div className="flex min-w-0 items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <h3 className="min-w-0 font-medium text-foreground">
                          {report.title}
                        </h3>
                        <Badge className={`${ERROR_REPORT_STATUS_COLORS[report.status]} text-white shrink-0`}>
                          {getStatusIcon(report.status)}
                          <span className="ml-1">{ERROR_REPORT_STATUS_LABELS[report.status]}</span>
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground dark:text-muted-foreground line-clamp-2">
                        {report.description}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {report.user?.full_name || 'Unknown'}
                        </span>
                        <span>{formatDateTime(report.created_at)}</span>
                        {report.error_code && (
                          <code className="text-muted-foreground bg-slate-200 dark:bg-slate-700 px-2 py-0.5 rounded">
                            {report.error_code}
                          </code>
                        )}
                        {getErrorReportScreenshots(report.additional_context).length > 0 && (
                          <span className="flex items-center gap-1">
                            <ImageIcon className="h-3 w-3" />
                            {getErrorReportScreenshots(report.additional_context).length} screenshot{getErrorReportScreenshots(report.additional_context).length === 1 ? '' : 's'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <ReviewDetailDialog
        open={detailDialogOpen}
        onOpenChange={setDetailDialogOpen}
        title="Error Report Details"
        description="Review the user report, screenshots, technical context, and admin history."
        icon={<AlertTriangle className="h-5 w-5 text-red-400" />}
        statusBadge={selectedReport ? (
          <Badge className={`${ERROR_REPORT_STATUS_COLORS[selectedReport.status]} text-white`}>
            {ERROR_REPORT_STATUS_LABELS[selectedReport.status]}
          </Badge>
        ) : null}
        sidebar={selectedReport ? (
          <>
            <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow-sm">
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-slate-100">Admin update</h3>
                <p className="text-xs text-slate-400">
                  Change status and keep internal investigation notes together.
                </p>
              </div>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="error-report-status" className="text-slate-300">Status</Label>
                  <Select value={newStatus} onValueChange={(v) => setNewStatus(v as ErrorReportStatus)}>
                    <SelectTrigger id="error-report-status" className="border-slate-700 bg-slate-950 text-slate-100">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">New</SelectItem>
                      <SelectItem value="investigating">Investigating</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="error-report-admin-note" className="text-slate-300">
                    Internal Notes (not visible to reporter)
                  </Label>
                  <Textarea
                    id="error-report-admin-note"
                    value={adminNote}
                    onChange={(e) => setAdminNote(e.target.value)}
                    placeholder="Add internal notes about this error..."
                    rows={5}
                    className="border-slate-700 bg-slate-950 text-slate-100 placeholder:text-slate-500"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="error-report-update-note" className="text-slate-300">
                    Update Note (for history)
                  </Label>
                  <Input
                    id="error-report-update-note"
                    value={updateNote}
                    onChange={(e) => setUpdateNote(e.target.value)}
                    placeholder="Brief note about this update..."
                    className="border-slate-700 bg-slate-950 text-slate-100 placeholder:text-slate-500"
                  />
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-slate-100">History</h3>
              </div>
              {loadingDetail ? (
                <PanelLoader message="Loading update history..." accent="debug" className="py-4" />
              ) : reportUpdates.length > 0 ? (
                <ScrollArea className="max-h-[32vh] pr-2">
                  <div className="space-y-2">
                    {reportUpdates.map((update) => (
                      <div
                        key={update.id}
                        className="rounded-lg border border-slate-800 bg-slate-950/80 p-3 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium text-slate-200">
                            {update.old_status && update.new_status ? (
                              <>
                                {ERROR_REPORT_STATUS_LABELS[update.old_status as ErrorReportStatus]} → {ERROR_REPORT_STATUS_LABELS[update.new_status as ErrorReportStatus]}
                              </>
                            ) : (
                              'Note added'
                            )}
                          </span>
                          <span className="text-slate-500">
                            {new Date(update.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        {update.note && (
                          <p className="mt-2 whitespace-pre-wrap leading-5 text-slate-300">
                            {update.note}
                          </p>
                        )}
                        <p className="mt-2 text-slate-500">
                          by {update.user?.full_name || 'Unknown'}
                        </p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <p className="text-sm text-slate-400">No history has been added yet.</p>
              )}
            </section>
          </>
        ) : null}
        footer={(
          <>
            <Button
              variant="outline"
              onClick={() => setDetailDialogOpen(false)}
              className="border-slate-700 bg-transparent text-slate-100 hover:bg-slate-800 hover:text-slate-50"
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpdateReport}
              disabled={updating}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {updating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </>
        )}
      >
        {selectedReport && (
          <>
            <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold leading-6 text-slate-50">
                    {selectedReport.title}
                  </h3>
                  <p className="mt-1 text-xs text-slate-400">
                    Submitted by {selectedReport.user?.full_name || 'Unknown'} on {formatDateTime(selectedReport.created_at)}
                  </p>
                </div>
                {selectedReport.error_code && (
                  <code className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs font-medium text-red-200">
                    {selectedReport.error_code}
                  </code>
                )}
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-4">
                <p className="whitespace-pre-wrap text-sm leading-6 text-slate-200">
                  {selectedReport.description}
                </p>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 text-xs text-slate-400 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                  <span className="block text-slate-500">Reporter</span>
                  <span className="mt-1 block text-slate-200">{selectedReport.user?.full_name || 'Unknown'}</span>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                  <span className="block text-slate-500">Submitted</span>
                  <span className="mt-1 block text-slate-200">{formatDateTime(selectedReport.created_at)}</span>
                </div>
                {selectedReport.page_url && (
                  <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3 sm:col-span-2">
                    <span className="block text-slate-500">Page</span>
                    <a
                      href={selectedReport.page_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 block break-all text-blue-300 hover:text-blue-200 hover:underline"
                    >
                      {selectedReport.page_url}
                    </a>
                  </div>
                )}
              </div>
            </section>

            {selectedReportScreenshots.length > 0 && (
              <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow-sm">
                <div className="mb-3 flex items-center gap-2">
                  <ImageIcon className="h-4 w-4 text-red-400" />
                  <h3 className="text-sm font-semibold text-slate-100">
                    Screenshots
                  </h3>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {selectedReportScreenshots.map((screenshot, index) => {
                    const screenshotUrl = buildErrorReportScreenshotUrl(selectedReport.id, screenshot.id);

                    return (
                      <a
                        key={screenshot.id}
                        href={screenshotUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group overflow-hidden rounded-lg border border-slate-800 bg-slate-950 transition-colors hover:border-red-400/70"
                      >
                        <div className="relative aspect-video bg-slate-900">
                          <Image
                            src={screenshotUrl}
                            alt={`Error report screenshot ${index + 1}`}
                            fill
                            sizes="(min-width: 640px) 50vw, 100vw"
                            unoptimized
                            className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
                          />
                        </div>
                        <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-slate-300">
                          <span>Screenshot {index + 1}</span>
                          <span className="text-slate-500">Open full size</span>
                        </div>
                      </a>
                    );
                  })}
                </div>
              </section>
            )}

            {(selectedReport.user_agent || selectedReportContext) && (
              <section className="rounded-xl border border-slate-800 bg-slate-900/80 px-4 shadow-sm">
                <Accordion type="single" collapsible>
                  <AccordionItem value="technical-details" className="border-0">
                    <AccordionTrigger className="py-4 text-sm font-semibold text-slate-100 hover:no-underline">
                      Technical details
                    </AccordionTrigger>
                    <AccordionContent className="space-y-3 pb-4">
                      {selectedReport.user_agent && (
                        <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3">
                          <span className="block text-xs font-medium text-slate-500">User Agent</span>
                          <p className="mt-1 break-words text-xs leading-5 text-slate-300">
                            {selectedReport.user_agent}
                          </p>
                        </div>
                      )}
                      {selectedReportContext && (
                        <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3">
                          <span className="block text-xs font-medium text-slate-500">Additional Context</span>
                          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-slate-300">
                            {selectedReportContext}
                          </pre>
                        </div>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </section>
            )}
          </>
        )}
      </ReviewDetailDialog>
    </AppPageShell>
  );
}
