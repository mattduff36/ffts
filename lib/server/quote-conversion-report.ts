import {
  ACCEPTED_QUOTE_STATUSES,
  QUOTE_STATUS_CONFIG,
  type QuoteStatus,
} from '@/app/(dashboard)/quotes/types';

export interface QuoteConversionReportRow {
  id: string;
  quote_reference: string;
  quote_date: string | null;
  status: string | null;
  total: number | null;
  accepted: boolean | null;
  created_at: string | null;
  updated_at: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  customer_sent_at: string | null;
  po_received_at: string | null;
  closed_at: string | null;
  commercial_status: string | null;
  customer?: {
    company_name?: string | null;
    short_name?: string | null;
  } | null;
  manager?: {
    full_name?: string | null;
    employee_id?: string | null;
    team?: {
      name?: string | null;
      code?: string | null;
    } | null;
  } | null;
}

export interface QuoteConversionSummaryRow {
  customerName: string;
  ownerName: string;
  teamName: string;
  createdCount: number;
  acceptedCount: number;
  declinedCount: number;
  agingCount: number;
  createdValue: number;
  acceptedValue: number;
  declinedValue: number;
  agingValue: number;
  averageOpenAgeDays: number | null;
  conversionRatePercent: number;
}

export interface QuoteStatusSummaryRow {
  status: string;
  label: string;
  count: number;
  value: number;
}

export interface QuoteDetailReportRow {
  quoteReference: string;
  customerName: string;
  ownerName: string;
  teamName: string;
  statusLabel: string;
  pipelineStage: string;
  quoteDate: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
  total: number;
  openAgeDays: number | null;
}

interface SummaryAccumulator {
  customerName: string;
  ownerName: string;
  teamName: string;
  createdCount: number;
  acceptedCount: number;
  declinedCount: number;
  agingCount: number;
  createdValue: number;
  acceptedValue: number;
  declinedValue: number;
  agingValue: number;
  totalOpenAgeDays: number;
}

interface StatusAccumulator {
  status: string;
  label: string;
  count: number;
  value: number;
}

function getCustomerName(row: QuoteConversionReportRow): string {
  return row.customer?.short_name || row.customer?.company_name || 'Unknown customer';
}

function getOwnerName(row: QuoteConversionReportRow): string {
  return row.manager?.full_name || 'Unknown owner';
}

function getTeamName(row: QuoteConversionReportRow): string {
  const teamName = row.manager?.team?.name || row.manager?.team?.code;
  return teamName || 'Unassigned team';
}

function getQuoteValue(row: QuoteConversionReportRow): number {
  return Number(row.total || 0);
}

function isAcceptedQuote(row: QuoteConversionReportRow): boolean {
  const status = row.status as QuoteStatus | null;
  return Boolean(
    row.accepted ||
      row.accepted_at ||
      row.po_received_at ||
      (status && ACCEPTED_QUOTE_STATUSES.has(status))
  );
}

function isDeclinedQuote(row: QuoteConversionReportRow): boolean {
  return row.status === 'lost';
}

function isClosedQuote(row: QuoteConversionReportRow): boolean {
  return row.status === 'closed' || row.commercial_status === 'closed' || Boolean(row.closed_at);
}

export function getQuotePipelineStage(row: QuoteConversionReportRow): 'Accepted' | 'Declined' | 'Aging Pipeline' | 'Closed' {
  if (isAcceptedQuote(row)) return 'Accepted';
  if (isDeclinedQuote(row)) return 'Declined';
  if (isClosedQuote(row)) return 'Closed';
  return 'Aging Pipeline';
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function differenceInDays(fromValue: string | null | undefined, toDate = new Date()): number | null {
  const fromDate = parseDate(fromValue);
  if (!fromDate) return null;

  const from = new Date(fromDate);
  const to = new Date(toDate);
  from.setHours(0, 0, 0, 0);
  to.setHours(0, 0, 0, 0);

  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
}

function getQuoteOpenAgeDays(row: QuoteConversionReportRow, now = new Date()): number | null {
  if (getQuotePipelineStage(row) !== 'Aging Pipeline') return null;
  return differenceInDays(row.quote_date || row.created_at, now);
}

function getStatusLabel(status: string | null): string {
  if (!status) return 'Unknown';
  return QUOTE_STATUS_CONFIG[status as QuoteStatus]?.label || status.replace(/_/g, ' ');
}

export function buildQuoteConversionSummaryRows(
  rows: QuoteConversionReportRow[],
  now = new Date()
): QuoteConversionSummaryRow[] {
  const grouped = new Map<string, SummaryAccumulator>();

  rows.forEach((row) => {
    const customerName = getCustomerName(row);
    const ownerName = getOwnerName(row);
    const teamName = getTeamName(row);
    const key = `${customerName}||${ownerName}||${teamName}`;
    const value = getQuoteValue(row);
    const stage = getQuotePipelineStage(row);
    const existing = grouped.get(key) || {
      customerName,
      ownerName,
      teamName,
      createdCount: 0,
      acceptedCount: 0,
      declinedCount: 0,
      agingCount: 0,
      createdValue: 0,
      acceptedValue: 0,
      declinedValue: 0,
      agingValue: 0,
      totalOpenAgeDays: 0,
    };

    existing.createdCount += 1;
    existing.createdValue += value;

    if (stage === 'Accepted') {
      existing.acceptedCount += 1;
      existing.acceptedValue += value;
    } else if (stage === 'Declined') {
      existing.declinedCount += 1;
      existing.declinedValue += value;
    } else if (stage === 'Aging Pipeline') {
      const ageDays = getQuoteOpenAgeDays(row, now) || 0;
      existing.agingCount += 1;
      existing.agingValue += value;
      existing.totalOpenAgeDays += ageDays;
    }

    grouped.set(key, existing);
  });

  return Array.from(grouped.values())
    .map((row) => ({
      customerName: row.customerName,
      ownerName: row.ownerName,
      teamName: row.teamName,
      createdCount: row.createdCount,
      acceptedCount: row.acceptedCount,
      declinedCount: row.declinedCount,
      agingCount: row.agingCount,
      createdValue: Math.round(row.createdValue * 100) / 100,
      acceptedValue: Math.round(row.acceptedValue * 100) / 100,
      declinedValue: Math.round(row.declinedValue * 100) / 100,
      agingValue: Math.round(row.agingValue * 100) / 100,
      averageOpenAgeDays: row.agingCount > 0 ? Math.round(row.totalOpenAgeDays / row.agingCount) : null,
      conversionRatePercent: row.createdCount > 0 ? Math.round((row.acceptedCount / row.createdCount) * 10_000) / 100 : 0,
    }))
    .sort((a, b) => b.createdCount - a.createdCount || a.customerName.localeCompare(b.customerName));
}

export function buildQuoteStatusSummaryRows(rows: QuoteConversionReportRow[]): QuoteStatusSummaryRow[] {
  const grouped = new Map<string, StatusAccumulator>();

  rows.forEach((row) => {
    const status = row.status || 'unknown';
    const existing = grouped.get(status) || {
      status,
      label: getStatusLabel(row.status),
      count: 0,
      value: 0,
    };

    existing.count += 1;
    existing.value += getQuoteValue(row);
    grouped.set(status, existing);
  });

  return Array.from(grouped.values())
    .map((row) => ({
      ...row,
      value: Math.round(row.value * 100) / 100,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function buildQuoteDetailRows(rows: QuoteConversionReportRow[], now = new Date()): QuoteDetailReportRow[] {
  return rows.map((row) => ({
    quoteReference: row.quote_reference,
    customerName: getCustomerName(row),
    ownerName: getOwnerName(row),
    teamName: getTeamName(row),
    statusLabel: getStatusLabel(row.status),
    pipelineStage: getQuotePipelineStage(row),
    quoteDate: row.quote_date,
    sentAt: row.customer_sent_at || row.sent_at,
    acceptedAt: row.accepted_at || row.po_received_at,
    total: Math.round(getQuoteValue(row) * 100) / 100,
    openAgeDays: getQuoteOpenAgeDays(row, now),
  }));
}
