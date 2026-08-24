'use client';

import Link from 'next/link';
import { MoreVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { QuoteOverviewItem } from '../overview-types';
import {
  canEditQuote,
  canManageQuoteSchedule,
  canRequestQuotePo,
  canToggleQuoteArchive,
  getQuoteCostOverviewHref,
  getQuoteNextWorkflowAction,
  getQuotePdfHref,
  type QuoteQuickWorkflowAction,
} from '../quote-quick-actions';
import type { Quote } from '../types';

export interface QuoteQuickActionsMenuProps {
  quote?: Quote | null;
  overviewItem?: QuoteOverviewItem;
  actionLoading?: boolean;
  onViewDetails?: (quoteId: string) => void;
  onEdit?: (quote: Quote) => void;
  onWorkflowAction?: (quote: Quote, action: QuoteQuickWorkflowAction) => void;
}

export function QuoteQuickActionsMenu({
  quote,
  overviewItem,
  actionLoading = false,
  onViewDetails,
  onEdit,
  onWorkflowAction,
}: QuoteQuickActionsMenuProps) {
  const quoteId = quote?.id || overviewItem?.quote_id;
  const reference = quote?.quote_reference || overviewItem?.reference || 'record';
  const overviewHref = overviewItem?.href || (quote ? getQuoteCostOverviewHref(quote) : null);
  const nextAction = quote ? getQuoteNextWorkflowAction(quote) : null;
  const showEdit = Boolean(quote && onEdit && canEditQuote(quote));
  const showRequestPo = Boolean(quote && onWorkflowAction && canRequestQuotePo(quote));
  const showSchedule = Boolean(quote && onWorkflowAction && canManageQuoteSchedule(quote));
  const showArchive = Boolean(quote && onWorkflowAction && canToggleQuoteArchive(quote));
  const showNextStatus = Boolean(quote && nextAction && (nextAction.mode !== 'immediate' || onWorkflowAction));
  const archiveLabel = quote?.commercial_status === 'closed' ? 'Restore Quote' : 'Archive Quote';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={actionLoading}
          aria-label={`Quick actions for ${reference}`}
          className="h-8 w-8 shrink-0 text-slate-300 hover:bg-slate-800 hover:text-white"
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 bg-slate-900 border-slate-700 text-slate-100">
        {showNextStatus && nextAction ? (
          <DropdownMenuItem
            disabled={nextAction.disabled || actionLoading || (nextAction.mode === 'immediate' && !onWorkflowAction)}
            title={nextAction.disabled ? nextAction.disabledReason : undefined}
            onSelect={() => {
              if (!quote || nextAction.disabled) return;
              onWorkflowAction?.(quote, nextAction.key);
            }}
          >
            {nextAction.label}
          </DropdownMenuItem>
        ) : null}

        {quoteId && onViewDetails ? (
          <DropdownMenuItem onSelect={() => onViewDetails(quoteId)}>
            View details
          </DropdownMenuItem>
        ) : null}

        {overviewHref ? (
          <DropdownMenuItem asChild>
            <Link href={overviewHref}>Cost overview</Link>
          </DropdownMenuItem>
        ) : null}

        {quoteId ? (
          <DropdownMenuItem asChild>
            <a href={getQuotePdfHref(quoteId)} target="_blank" rel="noopener noreferrer">
              Download
            </a>
          </DropdownMenuItem>
        ) : null}

        {showEdit && quote ? (
          <DropdownMenuItem onSelect={() => onEdit?.(quote)}>
            Edit
          </DropdownMenuItem>
        ) : null}

        {showRequestPo && quote ? (
          <DropdownMenuItem disabled={actionLoading} onSelect={() => onWorkflowAction?.(quote, 'request_po')}>
            Request PO
          </DropdownMenuItem>
        ) : null}

        {showSchedule && quote ? (
          <DropdownMenuItem disabled={actionLoading} onSelect={() => onWorkflowAction?.(quote, 'schedule')}>
            Schedule
          </DropdownMenuItem>
        ) : null}

        {showArchive && quote ? (
          <>
            <DropdownMenuSeparator className="bg-slate-700" />
            <DropdownMenuItem disabled={actionLoading} onSelect={() => onWorkflowAction?.(quote, 'toggle_closed')}>
              {archiveLabel}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
