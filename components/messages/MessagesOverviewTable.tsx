'use client';

import { useMemo, useState } from 'react';
import { ArrowUpDown, FileDown, FileText, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime } from '@/lib/utils/date';
import type { MessageDisplayPriority, MessageReportData, MessageType } from '@/types/messages';

export interface MessagesOverviewColumnVisibility {
  type: boolean;
  priority: boolean;
  sender: boolean;
  sentAt: boolean;
  assigned: boolean;
  completion: boolean;
  compliance: boolean;
}

export const MESSAGES_OVERVIEW_COLUMN_VISIBILITY_STORAGE_KEY = 'toolbox-talks-overview-column-visibility';

export const DEFAULT_MESSAGES_OVERVIEW_COLUMN_VISIBILITY: MessagesOverviewColumnVisibility = {
  type: true,
  priority: true,
  sender: true,
  sentAt: true,
  assigned: true,
  completion: true,
  compliance: false,
};

type SortField = 'subject' | 'type' | 'priority' | 'sender' | 'sentAt' | 'assigned' | 'completion' | 'compliance';
type SortDirection = 'asc' | 'desc';

const PRIORITY_BADGE_CONFIG: Record<MessageDisplayPriority, { label: string; className: string }> = {
  LOW: {
    label: 'Low',
    className: 'border-emerald-400 bg-transparent text-emerald-300',
  },
  MEDIUM: {
    label: 'Medium',
    className: 'border-amber-400 bg-transparent text-amber-300',
  },
  HIGH: {
    label: 'High',
    className: 'border-orange-400 bg-transparent text-orange-300',
  },
  URGENT: {
    label: 'Urgent',
    className: 'border-red-500 bg-transparent text-red-500',
  },
};

const TYPE_BADGE_CONFIG: Record<MessageType, { label: string; className: string; variant?: 'destructive' }> = {
  TOOLBOX_TALK: {
    label: 'Toolbox Talk',
    className: 'whitespace-nowrap',
    variant: 'destructive',
  },
  NOTIFICATION: {
    label: 'Notification',
    className: 'whitespace-nowrap bg-brand-yellow text-slate-900 hover:bg-brand-yellow-hover',
  },
  REMINDER: {
    label: 'Reminder',
    className: 'whitespace-nowrap bg-reminders text-white hover:bg-reminders-dark',
  },
};

interface MessagesOverviewTableProps {
  messages: MessageReportData[];
  columnVisibility: MessagesOverviewColumnVisibility;
  deleting: boolean;
  onSelectMessage: (message: MessageReportData) => void;
  onDeleteMessage: (message: MessageReportData) => void;
  onExportPDF: (messageId: string, subject: string) => void;
  onViewAttachedPDF: (pdfFilePath: string) => void;
}

function SortableHead({
  field,
  children,
  onSort,
  className = '',
}: {
  field: SortField;
  children: React.ReactNode;
  onSort: (field: SortField) => void;
  className?: string;
}) {
  return (
    <TableHead
      className={`cursor-pointer bg-slate-900 text-muted-foreground hover:bg-slate-800 ${className}`}
      onClick={() => onSort(field)}
    >
      <div className="flex items-center gap-2">
        {children}
        <ArrowUpDown className="h-3 w-3" />
      </div>
    </TableHead>
  );
}

function getTypeLabel(type: MessageType) {
  if (type === 'TOOLBOX_TALK') return 'Toolbox Talk';
  if (type === 'NOTIFICATION') return 'Notification';
  if (type === 'REMINDER') return 'Reminder';
  return 'Reminder';
}

function getPriorityLabel(priority: MessageDisplayPriority) {
  return PRIORITY_BADGE_CONFIG[priority].label;
}

function getPriorityBadge(priority: MessageDisplayPriority) {
  const { label, className } = PRIORITY_BADGE_CONFIG[priority];

  return (
    <Badge variant="outline" className={className}>
      {label}
    </Badge>
  );
}

function getTypeBadge(type: MessageType) {
  const config = TYPE_BADGE_CONFIG[type];
  return (
    <Badge variant={config.variant} className={config.className}>
      {config.label}
    </Badge>
  );
}

function isMessageBackedReport(message: MessageReportData) {
  return !message.message.id.startsWith('reminder-action:');
}

function getCompletedLabel(message: MessageReportData) {
  return message.message.type === 'TOOLBOX_TALK' ? 'signed' : 'completed';
}

function CompletionProgressPill({ message }: { message: MessageReportData }) {
  const completedLabel = getCompletedLabel(message);
  const completedTotal = Math.max(0, message.total_signed);
  const pendingTotal = Math.max(0, message.total_pending);
  const total = completedTotal + pendingTotal;
  const completedPercent = total > 0 ? Math.round((completedTotal / total) * 100) : 0;
  const pendingPercent = total > 0 ? 100 - completedPercent : 0;
  const summary = `${completedTotal} ${completedLabel}, ${pendingTotal} pending, ${message.total_assigned} assigned`;

  return (
    <div
      role="img"
      aria-label={summary}
      title={summary}
      className="relative inline-grid h-7 w-36 grid-cols-2 overflow-hidden rounded-full border border-slate-600 bg-slate-800 text-xs font-semibold tabular-nums shadow-inner sm:w-40 xl:w-44 2xl:w-48"
    >
      {completedPercent > 0 ? (
        <span
          className="absolute inset-y-0 left-0 bg-emerald-500/35"
          style={{ width: `${completedPercent}%` }}
        />
      ) : null}
      {pendingPercent > 0 ? (
        <span
          className="absolute inset-y-0 right-0 bg-red-500/40"
          style={{ width: `${pendingPercent}%` }}
        />
      ) : null}
      <span className={`relative z-10 flex min-w-0 items-center justify-start gap-1 overflow-hidden px-2 ${completedTotal > 0 ? 'text-emerald-50' : 'text-slate-400'}`}>
        <span className="min-w-0 truncate">{completedTotal}</span>
        <span className="hidden min-w-0 truncate xl:inline">{completedLabel}</span>
      </span>
      <span className={`relative z-10 flex min-w-0 items-center justify-end gap-1 overflow-hidden px-2 ${pendingTotal > 0 ? 'text-red-50' : 'text-slate-400'}`}>
        <span className="hidden min-w-0 truncate xl:inline">pending</span>
        <span className="min-w-0 truncate text-right">{pendingTotal}</span>
      </span>
    </div>
  );
}

export function MessagesOverviewTable({
  messages,
  columnVisibility,
  deleting,
  onSelectMessage,
  onDeleteMessage,
  onExportPDF,
  onViewAttachedPDF,
}: MessagesOverviewTableProps) {
  const [sortField, setSortField] = useState<SortField>('sentAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const sortedRows = useMemo(() => {
    return [...messages].sort((a, b) => {
      const factor = sortDirection === 'asc' ? 1 : -1;
      switch (sortField) {
        case 'subject':
          return factor * a.message.subject.localeCompare(b.message.subject);
        case 'type':
          return factor * getTypeLabel(a.message.type).localeCompare(getTypeLabel(b.message.type));
        case 'priority':
          return factor * getPriorityLabel(a.message.priority).localeCompare(getPriorityLabel(b.message.priority));
        case 'sender':
          return factor * ((a.message.sender?.full_name || '').localeCompare(b.message.sender?.full_name || ''));
        case 'sentAt':
          return factor * (new Date(a.message.created_at).getTime() - new Date(b.message.created_at).getTime());
        case 'assigned':
          return factor * (a.total_assigned - b.total_assigned);
        case 'completion':
          return factor * (
            (a.compliance_rate - b.compliance_rate) ||
            (a.total_signed - b.total_signed) ||
            (b.total_pending - a.total_pending)
          );
        case 'compliance':
          return factor * (a.compliance_rate - b.compliance_rate);
        default:
          return 0;
      }
    });
  }, [messages, sortDirection, sortField]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setSortField(field);
    setSortDirection('asc');
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-700">
      <Table className="min-w-full">
        <TableHeader>
          <TableRow className="border-border">
            <SortableHead field="subject" onSort={handleSort}>Subject</SortableHead>
            {columnVisibility.type ? <SortableHead field="type" onSort={handleSort}>Type</SortableHead> : null}
            {columnVisibility.priority ? <SortableHead field="priority" onSort={handleSort}>Priority</SortableHead> : null}
            {columnVisibility.sender ? <SortableHead field="sender" onSort={handleSort}>Sender</SortableHead> : null}
            {columnVisibility.sentAt ? <SortableHead field="sentAt" onSort={handleSort}>Sent</SortableHead> : null}
            {columnVisibility.assigned ? <SortableHead field="assigned" onSort={handleSort}>Assigned</SortableHead> : null}
            {columnVisibility.completion ? <SortableHead field="completion" onSort={handleSort}>Completion</SortableHead> : null}
            {columnVisibility.compliance ? <SortableHead field="compliance" onSort={handleSort}>Compliance</SortableHead> : null}
            <TableHead className="bg-slate-900 text-right text-muted-foreground">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedRows.map((message) => (
            <TableRow
              key={message.message.id}
              className="cursor-pointer border-slate-700 hover:bg-slate-800/50"
              onClick={() => onSelectMessage(message)}
            >
              <TableCell className="max-w-[18rem] font-medium text-white">
                <span className="line-clamp-2">{message.message.subject}</span>
              </TableCell>
              {columnVisibility.type ? <TableCell>{getTypeBadge(message.message.type)}</TableCell> : null}
              {columnVisibility.priority ? <TableCell>{getPriorityBadge(message.message.priority)}</TableCell> : null}
              {columnVisibility.sender ? (
                <TableCell className="text-muted-foreground">{message.message.sender?.full_name || 'System'}</TableCell>
              ) : null}
              {columnVisibility.sentAt ? (
                <TableCell className="text-muted-foreground">{formatDateTime(message.message.created_at)}</TableCell>
              ) : null}
              {columnVisibility.assigned ? <TableCell className="text-muted-foreground">{message.total_assigned}</TableCell> : null}
              {columnVisibility.completion ? (
                <TableCell className="whitespace-nowrap">
                  <CompletionProgressPill message={message} />
                </TableCell>
              ) : null}
              {columnVisibility.compliance ? (
                <TableCell className="text-muted-foreground">{message.compliance_rate}%</TableCell>
              ) : null}
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1.5" onClick={(event) => event.stopPropagation()}>
                  {message.message.type === 'TOOLBOX_TALK' ? (
                    <>
                      {message.message.pdf_file_path ? (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => onViewAttachedPDF(message.message.pdf_file_path as string)}
                          className="h-8 w-8 bg-red-600 p-0 text-white shadow-sm hover:bg-red-700 focus-visible:ring-red-500"
                          title="View attached file"
                          aria-label="View attached file"
                        >
                          <FileText className="h-4 w-4" />
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        onClick={() => onExportPDF(message.message.id, message.message.subject)}
                        className="h-8 w-8 bg-brand-yellow p-0 text-slate-900 hover:bg-brand-yellow-hover"
                        title="Export PDF"
                        aria-label="Export PDF"
                      >
                        <FileDown className="h-4 w-4" />
                      </Button>
                    </>
                  ) : null}
                  {isMessageBackedReport(message) ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDeleteMessage(message)}
                      disabled={deleting}
                      className="h-8 w-8 p-0 text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950"
                      title="Delete message"
                      aria-label="Delete message"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
