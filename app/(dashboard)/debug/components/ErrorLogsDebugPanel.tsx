'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SelectableCard } from '@/components/ui/selectable-card';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Filter,
  Loader2,
  Monitor,
  RefreshCw,
  Search,
  Smartphone,
  Trash,
  Users,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { ErrorLogEntry } from '../types';

type ErrorSeverity = 'urgent' | 'important' | 'medium' | 'low';

const UNHANDLED_COMPONENTS = ['Global Error Handler', 'Unhandled Promise Rejection', 'Error Boundary'];
const ERROR_SEVERITY_ORDER: ErrorSeverity[] = ['urgent', 'important', 'medium', 'low'];

interface UserFacingMessageSnapshot {
  title: string | null;
  description: string | null;
  combined: string;
}

interface ErrorClassificationSnapshot {
  category: string;
  confidence: string;
  reason: string;
}

interface UserActionSnapshot {
  actionType: string;
  label: string | null;
  element: string | null;
  href: string | null;
  pageUrl: string | null;
  timestamp: string | null;
  ageMs: number | null;
}

function getUserFacingMessage(log: ErrorLogEntry): UserFacingMessageSnapshot | null {
  const additionalData = (log.additional_data as Record<string, unknown> | null) || null;
  if (!additionalData) return null;

  const errorHandling = (additionalData.errorHandling as Record<string, unknown> | undefined) || undefined;
  const directMessage = typeof additionalData.userMessage === 'string' ? additionalData.userMessage : null;
  const directTitle = typeof additionalData.userMessageTitle === 'string' ? additionalData.userMessageTitle : null;
  const directDescription = typeof additionalData.userMessageDescription === 'string' ? additionalData.userMessageDescription : null;

  const handlingMessage = typeof errorHandling?.userMessage === 'string' ? errorHandling.userMessage : null;
  const handlingTitle = typeof errorHandling?.userMessageTitle === 'string' ? errorHandling.userMessageTitle : null;
  const handlingDescription =
    typeof errorHandling?.userMessageDescription === 'string' ? errorHandling.userMessageDescription : null;

  const title = directTitle || handlingTitle;
  const description = directDescription || handlingDescription;
  const combined = directMessage || handlingMessage || (title && description ? `${title} - ${description}` : title);

  if (!combined) return null;
  return { title: title || null, description: description || null, combined };
}

function getErrorClassification(log: ErrorLogEntry): ErrorClassificationSnapshot | null {
  const additionalData = (log.additional_data as Record<string, unknown> | null) || null;
  const classificationRaw = additionalData?.errorClassification;
  if (!classificationRaw || typeof classificationRaw !== 'object') return null;

  const classification = classificationRaw as Record<string, unknown>;
  const category = typeof classification.category === 'string' ? classification.category : null;
  if (!category) return null;

  return {
    category,
    confidence: typeof classification.confidence === 'string' ? classification.confidence : 'unknown',
    reason: typeof classification.reason === 'string' ? classification.reason : '',
  };
}

function getUserAction(log: ErrorLogEntry): UserActionSnapshot | null {
  const additionalData = (log.additional_data as Record<string, unknown> | null) || null;
  const actionRaw = additionalData?.userAction;
  if (!actionRaw || typeof actionRaw !== 'object') return null;

  const action = actionRaw as Record<string, unknown>;
  const actionType = typeof action.actionType === 'string' ? action.actionType : 'unknown';
  const label = typeof action.label === 'string' ? action.label : null;
  const element = typeof action.element === 'string' ? action.element : null;
  const href = typeof action.href === 'string' ? action.href : null;
  const pageUrl = typeof action.pageUrl === 'string' ? action.pageUrl : null;
  const timestamp = typeof action.timestamp === 'string' ? action.timestamp : null;
  const ageMs = typeof action.ageMs === 'number' ? action.ageMs : null;

  return { actionType, label, element, href, pageUrl, timestamp, ageMs };
}

function formatCategoryLabel(category: string): string {
  if (category === 'user_error_expected') return 'Expected User Error';
  if (category === 'codebase_error') return 'Codebase Error';
  if (category === 'connection_error') return 'Connection Error';
  return 'Other';
}

function getErrorSeverity(log: ErrorLogEntry): ErrorSeverity {
  const handling = (log.additional_data as Record<string, unknown> | null)?.errorHandling as
    | { wasHandled?: boolean; didShowMessage?: boolean | null }
    | undefined;

  if (handling) {
    if (!handling.wasHandled && handling.didShowMessage === false) return 'urgent';
    if (handling.wasHandled && handling.didShowMessage === true) return 'important';
    if (handling.wasHandled && handling.didShowMessage === false) return 'medium';
    if (handling.didShowMessage === null) return 'low';
  }

  const comp = log.component_name ?? '';
  if (UNHANDLED_COMPONENTS.includes(comp)) return 'urgent';
  if (comp === 'Console Error') return 'medium';
  if (comp.startsWith('/api/')) return 'low';
  return 'urgent';
}

function getErrorBadgeMeta(severity: ErrorSeverity): {
  variant: 'destructive' | 'warning' | 'secondary';
  className: string;
  label: string;
  description: string;
} {
  switch (severity) {
    case 'urgent':
      return {
        variant: 'destructive',
        className: 'font-mono text-xs',
        label: 'Critical',
        description: 'Unhandled or likely user-blocking. The app may not have shown a helpful recovery message.',
      };
    case 'important':
      return {
        variant: 'warning',
        className: 'font-mono text-xs',
        label: 'Handled with Message',
        description: 'The app caught the issue and showed a toast, inline state, or modal to the user.',
      };
    case 'medium':
      return {
        variant: 'secondary',
        className: 'font-mono text-xs bg-yellow-500 text-black hover:bg-yellow-600',
        label: 'Console / Investigate',
        description: 'Usually surfaced through console logging. Worth checking, but user impact can vary.',
      };
    case 'low':
      return {
        variant: 'secondary',
        className: 'font-mono text-xs bg-slate-500 text-white hover:bg-slate-600',
        label: 'Low Priority / API',
        description: 'Often API-side, background, or lower-urgency telemetry with less direct UI impact.',
      };
  }
}

export function ErrorLogsDebugPanel() {
  const [errorLogs, setErrorLogs] = useState<ErrorLogEntry[]>([]);
  const [clearingErrors, setClearingErrors] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [expandedErrors, setExpandedErrors] = useState<string[]>([]);
  const [viewedErrors, setViewedErrors] = useState<Set<string>>(new Set());
  const [lastCheckedErrorId, setLastCheckedErrorId] = useState<string | null>(null);
  const notifyingNewErrorsRef = useRef(false);
  const lastNotifiedErrorIdRef = useRef<string | null>(null);
  const clearAllConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [filterLocalhost, setFilterLocalhost] = useState(true);
  const [filterAdminAccount, setFilterAdminAccount] = useState(true);
  const [filterErrorType, setFilterErrorType] = useState<string>('all');
  const [filterDeviceType, setFilterDeviceType] = useState<string>('all');
  const [filterComponent, setFilterComponent] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const stored = localStorage.getItem('viewedErrorLogs');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setViewedErrors(new Set(parsed));
      } catch (err) {
        console.error('Failed to parse viewed errors:', err);
      }
    }
  }, []);

  useEffect(() => {
    void fetchErrorLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (clearAllConfirmTimerRef.current) {
        clearTimeout(clearAllConfirmTimerRef.current);
      }
    };
  }, []);

  const fetchErrorLogs = async () => {
    try {
      const response = await fetch('/api/debug/error-logs?limit=200', {
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (
          payload?.error === 'Unauthorized' ||
          payload?.error === 'Forbidden' ||
          payload?.error === 'Debug console only available in Actual Role mode'
        ) {
          toast.error(payload.error);
          setErrorLogs([]);
          return;
        }

        if (String(payload?.error || '').includes('does not exist')) {
          setErrorLogs([]);
          return;
        }

        toast.error('Failed to fetch error logs. Table may need to be created.');
        return;
      }

      const errorData = Array.isArray(payload?.logs) ? payload.logs : [];
      if (errorData) {
        const typedErrorData = errorData as ErrorLogEntry[];
        setErrorLogs(typedErrorData);

        if (typedErrorData.length > 0) {
          const newestErrorId = typedErrorData[0].id;

          if (lastCheckedErrorId && newestErrorId !== lastNotifiedErrorIdRef.current && !notifyingNewErrorsRef.current) {
            notifyingNewErrorsRef.current = true;
            try {
              const lastIndex = typedErrorData.findIndex((e) => e.id === lastCheckedErrorId);
              // If lastCheckedErrorId fell out of the 200-row window, avoid bulk backfill notifications.
              const newErrors = lastIndex > 0 ? typedErrorData.slice(0, lastIndex) : [];
              const unviewedNewErrors = newErrors.filter((newError) => !viewedErrors.has(newError.id));

              if (unviewedNewErrors.length > 0) {
                // Notify concurrently to avoid a long sequential loop blocking fetch flow.
                void Promise.allSettled(
                  unviewedNewErrors.map(async (newError) => {
                    const response = await fetch('/api/errors/notify-new', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ error_log_id: newError.id }),
                    });
                    if (!response.ok) {
                      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }
                    console.log(`Notified admins of new error: ${newError.id}`);
                  }),
                ).then((results) => {
                  for (const result of results) {
                    if (result.status === 'rejected') {
                      console.error('Failed to notify admins of new error:', result.reason);
                    }
                  }
                });
              }
            } finally {
              lastNotifiedErrorIdRef.current = newestErrorId;
              notifyingNewErrorsRef.current = false;
            }
          }

          setLastCheckedErrorId(newestErrorId);
        }
      }
    } catch {
      toast.error('Error loading error logs');
    }
  };

  const clearAllErrorLogs = async () => {
    if (!confirmClearAll) {
      setConfirmClearAll(true);
      if (clearAllConfirmTimerRef.current) {
        clearTimeout(clearAllConfirmTimerRef.current);
      }
      clearAllConfirmTimerRef.current = setTimeout(() => {
        setConfirmClearAll(false);
        clearAllConfirmTimerRef.current = null;
      }, 3000);
      return;
    }

    if (clearAllConfirmTimerRef.current) {
      clearTimeout(clearAllConfirmTimerRef.current);
      clearAllConfirmTimerRef.current = null;
    }
    setConfirmClearAll(false);
    setClearingErrors(true);
    try {
      const response = await fetch('/api/debug/error-logs', {
        method: 'DELETE',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to clear error logs');
      }

      toast.success('All error logs cleared successfully');
      setLastCheckedErrorId(null);
      lastNotifiedErrorIdRef.current = null;
      fetchErrorLogs();
    } catch (error) {
      console.error('Error clearing error logs:', error);
      toast.error('Failed to clear error logs');
    } finally {
      setClearingErrors(false);
    }
  };

  const toggleErrorExpanded = (id: string) => {
    const isExpanding = !expandedErrors.includes(id);

    if (isExpanding) {
      setExpandedErrors([id]);

      if (!viewedErrors.has(id)) {
        try {
          const storedViewed = localStorage.getItem('viewedErrorLogs');
          const currentViewed = storedViewed ? new Set(JSON.parse(storedViewed)) : new Set<string>();
          currentViewed.add(id);
          localStorage.setItem('viewedErrorLogs', JSON.stringify(Array.from(currentViewed)));
        } catch (error) {
          console.warn('Failed to update viewed errors in localStorage:', error);
        }
        setViewedErrors((prev) => new Set(prev).add(id));
      }
    } else {
      setExpandedErrors((prev) => prev.filter((x) => x !== id));
    }
  };

  const copyErrorToClipboard = async (log: ErrorLogEntry, e: MouseEvent) => {
    e.stopPropagation();

    const isMobile = log.user_agent.includes('Mobile') || log.user_agent.includes('iPhone') || log.user_agent.includes('Android');
    const browserMatch = log.user_agent.match(/(Chrome|Safari|Firefox|Edge)\/[\d.]+/);
    const browser = browserMatch ? browserMatch[0] : 'Unknown';
    const userFacingMessage = getUserFacingMessage(log);
    const classification = getErrorClassification(log);
    const userAction = getUserAction(log);
    const userActionSummary = userAction
      ? `${userAction.actionType}${userAction.label ? ` | ${userAction.label}` : ''}${userAction.element ? ` | ${userAction.element}` : ''}${
          userAction.ageMs !== null ? ` | ${Math.round(userAction.ageMs)}ms before error` : ''
        }`
      : null;

    const content = `ERROR LOG ENTRY
=================

Type: ${log.error_type}
Component: ${log.component_name || 'N/A'}
Device: ${isMobile ? 'Mobile' : 'Desktop'}
Browser: ${browser}

ERROR MESSAGE:
${log.error_message}

TIMESTAMP: ${new Date(log.timestamp).toLocaleString('en-GB')}
USER: ${log.user_name && log.user_email ? `${log.user_name} (${log.user_email})` : log.user_name || log.user_email || 'Anonymous'}
PAGE URL: ${log.page_url}
${classification ? `ERROR CLASSIFICATION:\n${formatCategoryLabel(classification.category)} (${classification.confidence})${classification.reason ? ` - ${classification.reason}` : ''}\n` : ''}
${userActionSummary ? `USER ACTION BEFORE ERROR:\n${userActionSummary}\n` : ''}
${userFacingMessage ? `USER MESSAGE SHOWN:\n${userFacingMessage.combined}\n` : ''}

${log.error_stack ? `STACK TRACE:\n${log.error_stack}\n\n` : ''}${log.additional_data ? `ADDITIONAL DATA:\n${JSON.stringify(log.additional_data, null, 2)}` : ''}`;

    try {
      await navigator.clipboard.writeText(content);
      toast.success('Error log copied to clipboard');
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  };

  const getFilteredErrorLogs = () => {
    let filtered = [...errorLogs];

    if (filterLocalhost) {
      filtered = filtered.filter((log) => !log.page_url.toLowerCase().includes('localhost'));
    }

    if (filterAdminAccount) {
      filtered = filtered.filter((log) => log.user_email !== 'template-admin@example.com');
    }

    if (filterErrorType !== 'all') {
      filtered = filtered.filter((log) => log.error_type === filterErrorType);
    }

    if (filterDeviceType !== 'all') {
      filtered = filtered.filter((log) => {
        const isMobile = log.user_agent.includes('Mobile') || log.user_agent.includes('iPhone') || log.user_agent.includes('Android');
        return filterDeviceType === 'mobile' ? isMobile : !isMobile;
      });
    }

    if (filterComponent !== 'all') {
      filtered = filtered.filter((log) => log.component_name === filterComponent);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (log) =>
          log.error_message.toLowerCase().includes(query) ||
          (log.error_stack && log.error_stack.toLowerCase().includes(query)) ||
          (log.component_name && log.component_name.toLowerCase().includes(query)) ||
          log.page_url.toLowerCase().includes(query),
      );
    }

    return filtered;
  };

  const uniqueErrorTypes = Array.from(new Set(errorLogs.map((log) => log.error_type))).sort();
  const uniqueComponents = Array.from(new Set(errorLogs.map((log) => log.component_name).filter((c): c is string => c != null))).sort();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Application Error Log</CardTitle>
            <CardDescription>Track all application errors and exceptions (Last 200 entries)</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button onClick={fetchErrorLogs} variant="outline" size="sm">
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            <Button
              onClick={clearAllErrorLogs}
              variant={confirmClearAll ? 'outline' : 'destructive'}
              size="sm"
              disabled={clearingErrors || errorLogs.length === 0}
              className={
                confirmClearAll
                  ? 'border-red-500 text-red-300 bg-red-500/10 hover:bg-red-500/20'
                  : 'bg-red-600 hover:bg-red-700 text-white border-red-600'
              }
            >
              {clearingErrors ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash className="h-4 w-4 mr-2" />}
              {clearingErrors ? 'Clearing...' : confirmClearAll ? 'Confirm?' : 'Clear All'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4 p-3 border border-border rounded-lg bg-muted/50">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm text-foreground">Filters</h3>
            <Badge variant="secondary" className="ml-auto text-xs">
              {getFilteredErrorLogs().length} / {errorLogs.length}
            </Badge>
          </div>

          <div className="mb-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search errors..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-11 h-9"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <SelectableCard selected={filterLocalhost} onSelect={() => setFilterLocalhost(!filterLocalhost)} variant="default" className="h-9">
              <span className="text-xs font-medium">Hide Localhost</span>
            </SelectableCard>

            <SelectableCard selected={filterAdminAccount} onSelect={() => setFilterAdminAccount(!filterAdminAccount)} variant="default" className="h-9">
              <span className="text-xs font-medium">Hide Admin</span>
            </SelectableCard>

            <div>
              <Select value={filterErrorType} onValueChange={setFilterErrorType}>
                <SelectTrigger className="w-full h-9">
                  <SelectValue placeholder="Error Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {uniqueErrorTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Select value={filterDeviceType} onValueChange={setFilterDeviceType}>
                <SelectTrigger className="w-full h-9">
                  <SelectValue placeholder="Device" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Devices</SelectItem>
                  <SelectItem value="mobile">
                    <div className="flex items-center gap-2">
                      <Smartphone className="h-3 w-3" />
                      Mobile
                    </div>
                  </SelectItem>
                  <SelectItem value="desktop">
                    <div className="flex items-center gap-2">
                      <Monitor className="h-3 w-3" />
                      Desktop
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {uniqueComponents.length > 0 && (
              <div className="lg:col-span-4">
                <Select value={filterComponent} onValueChange={setFilterComponent}>
                  <SelectTrigger className="w-full h-9">
                    <SelectValue placeholder="Component" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Components</SelectItem>
                    {uniqueComponents.map((component) => (
                      <SelectItem key={component} value={component}>
                        {component}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {(searchQuery ||
            filterErrorType !== 'all' ||
            filterDeviceType !== 'all' ||
            filterComponent !== 'all' ||
            filterLocalhost ||
            filterAdminAccount) && (
            <div className="mt-3 pt-3 border-t border-border">
              <div className="flex items-center gap-1.5 flex-wrap text-xs">
                <span className="text-muted-foreground">Active:</span>
                {filterLocalhost && (
                  <Badge variant="secondary" className="text-xs h-5">
                    No Localhost
                  </Badge>
                )}
                {filterAdminAccount && (
                  <Badge variant="secondary" className="text-xs h-5">
                    No Admin
                  </Badge>
                )}
                {filterErrorType !== 'all' && (
                  <Badge variant="secondary" className="text-xs h-5">
                    {filterErrorType}
                  </Badge>
                )}
                {filterDeviceType !== 'all' && (
                  <Badge variant="secondary" className="text-xs h-5">
                    {filterDeviceType === 'mobile' ? '📱' : '🖥️'}
                  </Badge>
                )}
                {filterComponent !== 'all' && (
                  <Badge variant="secondary" className="text-xs h-5">
                    {filterComponent}
                  </Badge>
                )}
                {searchQuery && (
                  <Badge variant="secondary" className="text-xs h-5">
                    Search
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 text-xs px-2 ml-auto"
                  onClick={() => {
                    setSearchQuery('');
                    setFilterErrorType('all');
                    setFilterDeviceType('all');
                    setFilterComponent('all');
                    setFilterLocalhost(true);
                    setFilterAdminAccount(true);
                  }}
                >
                  Clear
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="mb-4 rounded-lg border border-border/70 bg-muted/30 px-3 py-3">
          <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Badge Key</p>
              <p className="text-xs text-muted-foreground">
                Filled error badges show severity, not a different error type. Outline badges show extra context like classification, component, or device.
              </p>
            </div>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {ERROR_SEVERITY_ORDER.map((severity) => {
              const badgeMeta = getErrorBadgeMeta(severity);
              return (
                <div
                  key={severity}
                  className="flex items-start gap-2 rounded-md border border-border/60 bg-background/40 px-2.5 py-2"
                >
                  <Badge variant={badgeMeta.variant} className={`${badgeMeta.className} shrink-0`}>
                    Error
                  </Badge>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground">{badgeMeta.label}</p>
                    <p className="text-[11px] leading-4 text-muted-foreground">{badgeMeta.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {errorLogs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <CheckCircle2 className="h-12 w-12 mx-auto mb-3 opacity-50 text-green-500" />
            <p className="font-semibold">No errors logged</p>
            <p className="text-sm mt-1">Application errors will appear here when they occur</p>
          </div>
        ) : getFilteredErrorLogs().length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Filter className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p className="font-semibold">No errors match your filters</p>
            <p className="text-sm mt-1">Try adjusting your filter settings above</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => {
                setSearchQuery('');
                setFilterErrorType('all');
                setFilterDeviceType('all');
                setFilterComponent('all');
                setFilterLocalhost(false);
                setFilterAdminAccount(false);
              }}
            >
              Clear All Filters
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            {(() => {
              const filteredLogs = getFilteredErrorLogs();
              const newErrors = filteredLogs.filter((log) => !viewedErrors.has(log.id));
              const viewedErrorsList = filteredLogs.filter((log) => viewedErrors.has(log.id));

              return (
                <>
                  {newErrors.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-3 pb-2 border-b border-red-200 dark:border-red-900">
                        <Badge variant="destructive" className="font-semibold">
                          New
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          {newErrors.length} unread error{newErrors.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="space-y-2">
                        {newErrors.map((log) => {
                          const isMobile = log.user_agent.includes('Mobile') || log.user_agent.includes('iPhone') || log.user_agent.includes('Android');
                          const browserMatch = log.user_agent.match(/(Chrome|Safari|Firefox|Edge)\/[\d.]+/);
                          const browser = browserMatch ? browserMatch[0] : 'Unknown';
                          const isExpanded = expandedErrors.includes(log.id);
                          const severity = getErrorSeverity(log);
                          const badgeProps = getErrorBadgeMeta(severity);
                          const classification = getErrorClassification(log);
                          const userAction = getUserAction(log);
                          const userFacingMessage = getUserFacingMessage(log);

                          return (
                            <div
                              key={log.id}
                              className="border border-red-200 dark:border-red-900 rounded-lg overflow-hidden hover:border-red-300 dark:hover:border-red-800 transition-colors"
                            >
                              <div
                                className="p-4 cursor-pointer hover:bg-red-50/50 dark:hover:bg-red-950/20 transition-colors"
                                onClick={() => toggleErrorExpanded(log.id)}
                              >
                                <div className="flex items-start gap-3">
                                  {isExpanded ? (
                                    <ChevronDown className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
                                  ) : (
                                    <ChevronRight className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
                                  )}
                                  <XCircle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap mb-1">
                                      <Badge variant={badgeProps.variant} className={badgeProps.className}>
                                        {log.error_type}
                                      </Badge>
                                      {classification && (
                                        <Badge variant="outline" className="text-xs">
                                          {formatCategoryLabel(classification.category)}
                                        </Badge>
                                      )}
                                      {log.component_name && (
                                        <Badge variant="outline" className="text-xs">
                                          {log.component_name}
                                        </Badge>
                                      )}
                                      {isMobile && (
                                        <Badge variant="secondary" className="text-xs">
                                          📱 Mobile
                                        </Badge>
                                      )}
                                    </div>
                                    <p className="font-semibold text-red-700 dark:text-red-400 mb-2">{log.error_message}</p>
                                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                                      <div className="flex items-center gap-1">
                                        <Clock className="h-3 w-3" />
                                        {new Date(log.timestamp).toLocaleString('en-GB', {
                                          day: '2-digit',
                                          month: '2-digit',
                                          year: 'numeric',
                                          hour: '2-digit',
                                          minute: '2-digit',
                                          second: '2-digit',
                                        })}
                                      </div>
                                      {log.user_name && (
                                        <>
                                          <span>•</span>
                                          <div className="flex items-center gap-1">
                                            <Users className="h-3 w-3" />
                                            {log.user_name}
                                          </div>
                                        </>
                                      )}
                                      {log.user_email && (
                                        <>
                                          <span>•</span>
                                          <span className="font-mono text-xs">{log.user_email}</span>
                                        </>
                                      )}
                                      <span>•</span>
                                      <span className="font-mono">{browser}</span>
                                    </div>
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0 flex-shrink-0 hover:bg-red-100 dark:hover:bg-red-950"
                                    onClick={(e) => copyErrorToClipboard(log, e)}
                                    title="Copy to clipboard"
                                  >
                                    <Copy className="h-4 w-4 text-red-600 dark:text-red-400" />
                                  </Button>
                                </div>
                              </div>

                              {isExpanded && (
                                <div className="border-t border-red-200 dark:border-red-900 bg-red-50/30 dark:bg-red-950/10 p-4 space-y-3">
                                  <div>
                                    <p className="text-xs font-semibold text-muted-foreground mb-1">PAGE URL:</p>
                                    <p className="text-xs font-mono bg-muted/50 rounded p-2 break-all">{log.page_url}</p>
                                  </div>

                                  {log.error_stack && (
                                    <div>
                                      <p className="text-xs font-semibold text-muted-foreground mb-1">STACK TRACE:</p>
                                      <pre className="text-xs font-mono bg-muted/50 rounded p-2 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-words">
                                        {log.error_stack}
                                      </pre>
                                    </div>
                                  )}

                                  {classification && (
                                    <div>
                                      <p className="text-xs font-semibold text-muted-foreground mb-1">ERROR CLASSIFICATION:</p>
                                      <p className="text-xs font-mono bg-muted/50 rounded p-2 whitespace-pre-wrap break-words">
                                        {formatCategoryLabel(classification.category)} ({classification.confidence})
                                        {classification.reason ? ` - ${classification.reason}` : ''}
                                      </p>
                                    </div>
                                  )}

                                  {userAction && (
                                    <div>
                                      <p className="text-xs font-semibold text-muted-foreground mb-1">USER ACTION BEFORE ERROR:</p>
                                      <p className="text-xs font-mono bg-muted/50 rounded p-2 whitespace-pre-wrap break-words">
                                        {userAction.actionType}
                                        {userAction.label ? ` | ${userAction.label}` : ''}
                                        {userAction.element ? ` | ${userAction.element}` : ''}
                                        {userAction.ageMs !== null ? ` | ${Math.round(userAction.ageMs)}ms before error` : ''}
                                      </p>
                                    </div>
                                  )}

                                  {userFacingMessage && (
                                    <div>
                                      <p className="text-xs font-semibold text-muted-foreground mb-1">USER MESSAGE SHOWN:</p>
                                      <p className="text-xs font-mono bg-muted/50 rounded p-2 whitespace-pre-wrap break-words">
                                        {userFacingMessage.combined}
                                      </p>
                                    </div>
                                  )}

                                  {log.additional_data && (
                                    <div>
                                      <p className="text-xs font-semibold text-muted-foreground mb-1">ADDITIONAL DATA:</p>
                                      <pre className="text-xs font-mono bg-muted/50 rounded p-2 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-words">
                                        {JSON.stringify(log.additional_data, null, 2)}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {viewedErrorsList.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-3 pb-2 border-b border-muted">
                        <Badge variant="secondary" className="font-semibold">
                          Viewed
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          {viewedErrorsList.length} viewed error{viewedErrorsList.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="space-y-2">
                        {viewedErrorsList.map((log) => {
                          const isMobile = log.user_agent.includes('Mobile') || log.user_agent.includes('iPhone') || log.user_agent.includes('Android');
                          const browserMatch = log.user_agent.match(/(Chrome|Safari|Firefox|Edge)\/[\d.]+/);
                          const browser = browserMatch ? browserMatch[0] : 'Unknown';
                          const isExpanded = expandedErrors.includes(log.id);
                          const severity = getErrorSeverity(log);
                          const badgeProps = getErrorBadgeMeta(severity);
                          const classification = getErrorClassification(log);
                          const userAction = getUserAction(log);
                          const userFacingMessage = getUserFacingMessage(log);

                          return (
                            <div
                              key={log.id}
                              className="border border-red-200 dark:border-red-900 rounded-lg overflow-hidden hover:border-red-300 dark:hover:border-red-800 transition-colors"
                            >
                              <div
                                className="p-4 cursor-pointer hover:bg-red-50/50 dark:hover:bg-red-950/20 transition-colors"
                                onClick={() => toggleErrorExpanded(log.id)}
                              >
                                <div className="flex items-start gap-3">
                                  {isExpanded ? (
                                    <ChevronDown className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
                                  ) : (
                                    <ChevronRight className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
                                  )}
                                  <XCircle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap mb-1">
                                      <Badge variant={badgeProps.variant} className={badgeProps.className}>
                                        {log.error_type}
                                      </Badge>
                                      {classification && (
                                        <Badge variant="outline" className="text-xs">
                                          {formatCategoryLabel(classification.category)}
                                        </Badge>
                                      )}
                                      {log.component_name && (
                                        <Badge variant="outline" className="text-xs">
                                          {log.component_name}
                                        </Badge>
                                      )}
                                      {isMobile && (
                                        <Badge variant="secondary" className="text-xs">
                                          📱 Mobile
                                        </Badge>
                                      )}
                                    </div>
                                    <p className="font-semibold text-red-700 dark:text-red-400 mb-2">{log.error_message}</p>
                                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                                      <div className="flex items-center gap-1">
                                        <Clock className="h-3 w-3" />
                                        {new Date(log.timestamp).toLocaleString('en-GB', {
                                          day: '2-digit',
                                          month: '2-digit',
                                          year: 'numeric',
                                          hour: '2-digit',
                                          minute: '2-digit',
                                          second: '2-digit',
                                        })}
                                      </div>
                                      {log.user_name && (
                                        <>
                                          <span>•</span>
                                          <div className="flex items-center gap-1">
                                            <Users className="h-3 w-3" />
                                            {log.user_name}
                                          </div>
                                        </>
                                      )}
                                      {log.user_email && (
                                        <>
                                          <span>•</span>
                                          <span className="font-mono text-xs">{log.user_email}</span>
                                        </>
                                      )}
                                      <span>•</span>
                                      <span className="font-mono">{browser}</span>
                                    </div>
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0 flex-shrink-0 hover:bg-red-100 dark:hover:bg-red-950"
                                    onClick={(e) => copyErrorToClipboard(log, e)}
                                    title="Copy to clipboard"
                                  >
                                    <Copy className="h-4 w-4 text-red-600 dark:text-red-400" />
                                  </Button>
                                </div>
                              </div>

                              {isExpanded && (
                                <div className="border-t border-red-200 dark:border-red-900 bg-red-50/30 dark:bg-red-950/10 p-4 space-y-3">
                                  <div>
                                    <p className="text-xs font-semibold text-muted-foreground mb-1">PAGE URL:</p>
                                    <p className="text-xs font-mono bg-muted/50 rounded p-2 break-all">{log.page_url}</p>
                                  </div>

                                  {log.error_stack && (
                                    <div>
                                      <p className="text-xs font-semibold text-muted-foreground mb-1">STACK TRACE:</p>
                                      <pre className="text-xs font-mono bg-red-500/10 border border-red-500/20 rounded p-3 overflow-x-auto whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
                                        {log.error_stack}
                                      </pre>
                                    </div>
                                  )}

                                  {classification && (
                                    <div>
                                      <p className="text-xs font-semibold text-muted-foreground mb-1">ERROR CLASSIFICATION:</p>
                                      <p className="text-xs font-mono bg-muted/50 rounded p-2 whitespace-pre-wrap break-words">
                                        {formatCategoryLabel(classification.category)} ({classification.confidence})
                                        {classification.reason ? ` - ${classification.reason}` : ''}
                                      </p>
                                    </div>
                                  )}

                                  {userAction && (
                                    <div>
                                      <p className="text-xs font-semibold text-muted-foreground mb-1">USER ACTION BEFORE ERROR:</p>
                                      <p className="text-xs font-mono bg-muted/50 rounded p-2 whitespace-pre-wrap break-words">
                                        {userAction.actionType}
                                        {userAction.label ? ` | ${userAction.label}` : ''}
                                        {userAction.element ? ` | ${userAction.element}` : ''}
                                        {userAction.ageMs !== null ? ` | ${Math.round(userAction.ageMs)}ms before error` : ''}
                                      </p>
                                    </div>
                                  )}

                                  {userFacingMessage && (
                                    <div>
                                      <p className="text-xs font-semibold text-muted-foreground mb-1">USER MESSAGE SHOWN:</p>
                                      <p className="text-xs font-mono bg-muted/50 rounded p-2 whitespace-pre-wrap break-words">
                                        {userFacingMessage.combined}
                                      </p>
                                    </div>
                                  )}

                                  {log.additional_data && Object.keys(log.additional_data).length > 0 && (
                                    <div>
                                      <p className="text-xs font-semibold text-muted-foreground mb-1">ADDITIONAL DATA:</p>
                                      <pre className="text-xs font-mono bg-muted/50 rounded p-3 overflow-x-auto max-h-64 overflow-y-auto">
                                        {JSON.stringify(log.additional_data, null, 2)}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
