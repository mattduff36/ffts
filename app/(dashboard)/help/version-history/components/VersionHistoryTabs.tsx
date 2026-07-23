'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, Clock3, Download, FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PanelLoader } from '@/components/ui/panel-loader';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils/cn';
import type { ReleaseHistoryEntry, ReleaseHistoryMonthOption } from '@/lib/config/release-version-logic';

interface VersionHistoryTabsProps {
  months: ReleaseHistoryMonthOption[];
  initialMonthKey: string;
}

interface VersionHistoryMonthResponse {
  entries: ReleaseHistoryEntry[];
  month: ReleaseHistoryMonthOption;
}

function formatPushedAt(value: string | null): string {
  if (!value) {
    return 'Timestamp unavailable';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Timestamp unavailable';
  }

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/London',
  }).format(date);
}

function getUpdateKindLabel(entry: ReleaseHistoryEntry): string {
  return entry.updateKind === 'major' ? 'Major update' : 'Minor update';
}

function getUpdateKindClassName(entry: ReleaseHistoryEntry): string {
  return entry.updateKind === 'major'
    ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-200'
    : 'border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-200';
}

function getDownloadFilename(response: Response): string {
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename="?([^"]+)"?/iu.exec(disposition);
  return match?.[1] || 'squireapp-version-history.pdf';
}

function VersionHistoryTable({ entries }: { entries: ReleaseHistoryEntry[] }) {
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-sm text-muted-foreground">
        No version updates were published for this month.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-white dark:bg-slate-900">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="min-w-36">Version</TableHead>
              <TableHead className="min-w-40">Update</TableHead>
              <TableHead className="min-w-80">Plain-English summary</TableHead>
              <TableHead className="min-w-48 text-right">Published</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => {
              const isExpanded = expandedVersion === entry.version;
              const details = entry.details.length > 0 ? entry.details : [entry.summary || entry.description];

              return (
                <Fragment key={entry.version}>
                  <TableRow
                    className="cursor-pointer align-top"
                    onClick={() => setExpandedVersion(isExpanded ? null : entry.version)}
                  >
                    <TableCell className="font-medium tabular-nums">
                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        className="flex items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-yellow"
                        onClick={(event) => {
                          event.stopPropagation();
                          setExpandedVersion(isExpanded ? null : entry.version);
                        }}
                      >
                        <ChevronDown
                          aria-hidden
                          className={cn('h-4 w-4 shrink-0 transition-transform', isExpanded && 'rotate-180')}
                        />
                        Version {entry.version}
                      </button>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <Badge variant="outline" className={getUpdateKindClassName(entry)}>
                          {getUpdateKindLabel(entry)}
                        </Badge>
                        <div className="text-sm font-semibold text-foreground">{entry.title}</div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm leading-6 text-muted-foreground">
                      {entry.summary || entry.description}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      <span title={entry.pushedAt ?? undefined}>{formatPushedAt(entry.pushedAt)}</span>
                    </TableCell>
                  </TableRow>
                  {isExpanded ? (
                    <TableRow className="bg-muted/20 hover:bg-muted/20">
                      <TableCell colSpan={4} className="p-4">
                        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                              <FileText className="h-4 w-4 text-brand-yellow" />
                              More detail
                            </div>
                            <ul className="space-y-2 text-sm leading-6 text-muted-foreground">
                              {details.map((detail) => (
                                <li key={detail} className="flex gap-2">
                                  <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-yellow" />
                                  <span>{detail}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                          <div className="space-y-2 rounded-md border border-border bg-background/70 p-3">
                            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              <Clock3 className="h-3.5 w-3.5" />
                              Areas touched
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {entry.areas.length > 0 ? (
                                entry.areas.map((area) => (
                                  <Badge key={area} variant="secondary" className="font-normal">
                                    {area}
                                  </Badge>
                                ))
                              ) : (
                                <span className="text-sm text-muted-foreground">General app update</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function VersionHistoryTabs({ months, initialMonthKey }: VersionHistoryTabsProps) {
  const [activeMonth, setActiveMonth] = useState(initialMonthKey);
  const [entriesByMonth, setEntriesByMonth] = useState<Record<string, ReleaseHistoryEntry[]>>({});
  const [loadingMonth, setLoadingMonth] = useState<string | null>(initialMonthKey);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  const activeEntries = useMemo(() => entriesByMonth[activeMonth] ?? [], [activeMonth, entriesByMonth]);
  const isLoadingActiveMonth = loadingMonth === activeMonth && !entriesByMonth[activeMonth];

  useEffect(() => {
    if (!activeMonth || entriesByMonth[activeMonth]) {
      return;
    }

    const controller = new AbortController();
    setLoadingMonth(activeMonth);
    setErrorMessage(null);

    fetch(`/api/version-history?month=${encodeURIComponent(activeMonth)}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(payload?.error || 'Failed to load version history');
        }

        return response.json() as Promise<VersionHistoryMonthResponse>;
      })
      .then((payload) => {
        setEntriesByMonth((current) => ({
          ...current,
          [activeMonth]: payload.entries,
        }));
      })
      .catch((error) => {
        if ((error as Error).name === 'AbortError') {
          return;
        }

        setErrorMessage(error instanceof Error ? error.message : 'Failed to load version history');
      })
      .finally(() => {
        setLoadingMonth((current) => (current === activeMonth ? null : current));
      });

    return () => controller.abort();
  }, [activeMonth, entriesByMonth]);

  const handleDownloadPdf = useCallback(async () => {
    setIsDownloadingPdf(true);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/version-history/pdf', { cache: 'no-store' });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || 'Failed to generate version history PDF');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = getDownloadFilename(response);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to generate version history PDF');
    } finally {
      setIsDownloadingPdf(false);
    }
  }, []);

  return (
    <div className="space-y-4">
      <Tabs value={activeMonth} onValueChange={setActiveMonth} className="space-y-4">
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-white p-3 dark:bg-slate-900 lg:flex-row lg:items-center lg:justify-between">
          <TabsList className="justify-start">
            {months.map((month) => (
              <TabsTrigger key={month.key} value={month.key}>
                {month.label}
              </TabsTrigger>
            ))}
            <Button
              type="button"
              variant="ghost"
              onClick={handleDownloadPdf}
              disabled={isDownloadingPdf}
              className="inline-flex min-h-8 items-center justify-center gap-2 whitespace-normal rounded-md px-3 py-1 text-center text-sm font-medium leading-tight text-muted-foreground ring-offset-background transition-all hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              {isDownloadingPdf ? 'Preparing PDF...' : 'Full Version History'}
            </Button>
          </TabsList>
          <p className="text-xs text-muted-foreground">
            Only the selected month is loaded. Use the PDF option for the complete history.
          </p>
        </div>
      </Tabs>

      {isDownloadingPdf ? (
        <PanelLoader message="Generating full version history PDF..." accent="reports" className="py-6" />
      ) : null}

      {errorMessage ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {errorMessage}
        </div>
      ) : null}

      {isLoadingActiveMonth ? (
        <PanelLoader message="Loading version history..." accent="reports" className="py-12" />
      ) : (
        <VersionHistoryTable key={activeMonth} entries={activeEntries} />
      )}
    </div>
  );
}
