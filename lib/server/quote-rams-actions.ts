import 'server-only';
import pg from 'pg';
import { sendResendEmail } from '@/lib/server/resend';
import { getQuoteResendEmailConfig } from '@/lib/server/resend-email-config';
import type {
  QuoteRamsActionDto,
  QuoteRamsActionListItemDto,
  QuoteRamsActionStatus,
  QuoteRamsContextResponse,
  QuoteRamsEligibleManagerDto,
  QuoteRamsEmailStatus,
  QuoteRamsLinkedDocumentDto,
  QuoteRamsMutationResponse,
} from '@/types/quote-rams';

const { Client } = pg;

export class QuoteRamsActionError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors?: Record<string, string>;
  readonly eligibleManagers?: QuoteRamsEligibleManagerDto[];

  constructor(input: {
    message: string;
    status: number;
    code: string;
    fieldErrors?: Record<string, string>;
    eligibleManagers?: QuoteRamsEligibleManagerDto[];
  }) {
    super(input.message);
    this.name = 'QuoteRamsActionError';
    this.status = input.status;
    this.code = input.code;
    this.fieldErrors = input.fieldErrors;
    this.eligibleManagers = input.eligibleManagers;
  }
}

export interface QuoteRamsDb {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

export interface QuoteRamsAssigneeEmail {
  to: string;
  quoteReference: string;
  subjectLine: string | null;
  assigneeName: string | null;
}

export interface QuoteRamsEmailResult {
  success: boolean;
  uncertain?: boolean;
  error?: string;
}

export interface QuoteRamsDeps {
  runTransaction?: <T>(fn: (db: QuoteRamsDb) => Promise<T>) => Promise<T>;
  query?: QuoteRamsDb['query'];
  sendAssigneeEmail?: (input: QuoteRamsAssigneeEmail) => Promise<QuoteRamsEmailResult>;
  loadAssignee?: (profileId: string) => Promise<{ email: string | null; fullName: string | null }>;
  isManagerOrAdmin?: (userId: string) => Promise<boolean>;
  isQuoteAdmin?: (userId: string) => Promise<boolean>;
}

interface ActionRecord extends QuoteRamsActionDto {
  subject_line: string | null;
}

interface LockedQuote {
  id: string;
  status: string;
  is_latest_version: boolean;
  commercial_status: string;
  requester_id: string | null;
  quote_thread_id: string | null;
  quote_reference: string;
  subject_line: string | null;
}

interface ManagerSeriesRow {
  profile_id: string;
  initials: string;
  is_active: boolean;
  full_name?: string | null;
}

const LOCK_QUOTE = `
  /* quote_rams:lock_quote */
  SELECT id, status, is_latest_version, commercial_status, requester_id,
         quote_thread_id, quote_reference, subject_line
  FROM public.quotes
  WHERE id = $1
  FOR UPDATE
`;

const LOAD_ACTION = `
  /* quote_rams:load_action */
  SELECT a.id, a.quote_id, q.quote_reference, q.subject_line, a.assignee_profile_id,
         assignee.full_name AS assignee_name, a.assigned_by, a.status, a.rams_document_id,
         a.requested_by, a.requested_at, a.completed_by, a.completed_at, a.confirmation_note,
         a.email_status, a.email_error
  FROM public.quote_rams_actions a
  JOIN public.quotes q ON q.id = a.quote_id
  LEFT JOIN public.profiles assignee ON assignee.id = a.assignee_profile_id
  WHERE a.quote_id = $1
`;

const LOAD_ACTION_FOR_UPDATE = `
  /* quote_rams:load_action_for_update */
  SELECT a.id, a.quote_id, q.quote_reference, q.subject_line, a.assignee_profile_id,
         assignee.full_name AS assignee_name, a.assigned_by, a.status, a.rams_document_id,
         a.requested_by, a.requested_at, a.completed_by, a.completed_at, a.confirmation_note,
         a.email_status, a.email_error
  FROM public.quote_rams_actions a
  JOIN public.quotes q ON q.id = a.quote_id
  LEFT JOIN public.profiles assignee ON assignee.id = a.assignee_profile_id
  WHERE a.quote_id = $1
  FOR UPDATE OF a
`;

const LOAD_MANAGER = `
  /* quote_rams:load_manager */
  SELECT s.profile_id, s.initials, s.is_active, p.full_name
  FROM public.quote_manager_series s
  LEFT JOIN public.profiles p ON p.id = s.profile_id
  WHERE s.profile_id = $1
`;

const LIST_MANAGERS = `
  /* quote_rams:list_managers */
  SELECT s.profile_id, s.initials, p.full_name
  FROM public.quote_manager_series s
  LEFT JOIN public.profiles p ON p.id = s.profile_id
  WHERE s.is_active IS TRUE
  ORDER BY s.initials
`;

const UPDATE_QUOTE = `
  /* quote_rams:update_quote */
  UPDATE public.quotes
  SET status = 'po_received', rams_requested_at = NOW(), updated_by = $2
  WHERE id = $1
  RETURNING id
`;

const INSERT_ACTION = `
  /* quote_rams:insert_action */
  INSERT INTO public.quote_rams_actions (
    quote_id, assignee_profile_id, assigned_by, requested_by, status, email_status
  )
  VALUES ($1, $2, $3, $4, 'open', 'pending')
  RETURNING id
`;

const INSERT_TIMELINE = `
  /* quote_rams:insert_timeline */
  INSERT INTO public.quote_timeline_events (
    quote_id, quote_thread_id, quote_reference, event_type, title, description,
    from_status, to_status, actor_user_id
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
`;

const CLAIM_PENDING = `
  /* quote_rams:claim_pending */
  UPDATE public.quote_rams_actions
  SET email_status = 'sending', email_claim_token = $2, email_claimed_at = NOW(), updated_at = NOW()
  WHERE id = $1 AND assignee_profile_id = $3 AND status = 'open' AND email_status = 'pending'
  RETURNING id
`;

const CLAIM_RETRY = `
  /* quote_rams:claim_retry */
  UPDATE public.quote_rams_actions
  SET email_status = 'sending', email_claim_token = $2, email_claimed_at = NOW(), updated_at = NOW()
  WHERE id = $1 AND assignee_profile_id = $3 AND status = 'open' AND email_status IN ('pending', 'failed')
  RETURNING id
`;

const SET_EMAIL = `
  /* quote_rams:set_email */
  UPDATE public.quote_rams_actions
  SET email_status = $2,
      email_error = $3,
      email_sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE email_sent_at END,
      updated_at = NOW()
  WHERE id = $1 AND email_claim_token = $4 AND email_status = 'sending'
  RETURNING id
`;

const LOAD_DOCUMENT = `
  /* quote_rams:load_document */
  SELECT d.id, d.quote_id, d.is_active, t.name AS document_type_name
  FROM public.rams_documents d
  LEFT JOIN public.project_document_types t ON t.id = d.document_type_id
  WHERE d.id = $1
  FOR SHARE OF d
`;

const LIST_DOCUMENTS = `
  /* quote_rams:list_documents */
  SELECT d.id, d.title, t.name AS document_type_name
  FROM public.rams_documents d
  JOIN public.project_document_types t ON t.id = d.document_type_id
  WHERE d.quote_id = $1 AND d.is_active IS TRUE AND t.name = 'RAMS'
  ORDER BY d.created_at DESC
`;

const COMPLETE_ACTION = `
  /* quote_rams:complete */
  UPDATE public.quote_rams_actions
  SET status = 'completed', rams_document_id = $2, completed_by = $3,
      completed_at = NOW(), confirmation_note = $4, updated_at = NOW()
  WHERE id = $1 AND status = 'open'
  RETURNING id
`;

const REASSIGN_ACTION = `
  /* quote_rams:reassign */
  UPDATE public.quote_rams_actions
  SET assignee_profile_id = $2, assigned_by = $3, updated_at = NOW(),
      email_status = 'pending', email_error = NULL, email_claim_token = NULL,
      email_claimed_at = NULL, email_sent_at = NULL
  WHERE id = $1 AND status = 'open'
  RETURNING id
`;

const LIST_ACTIONS = `
  /* quote_rams:list_actions */
  SELECT a.id, a.quote_id, q.quote_reference, a.status, a.assignee_profile_id,
         assignee.full_name AS assignee_name, a.email_status, a.requested_at,
         a.completed_at, a.rams_document_id
  FROM public.quote_rams_actions a
  JOIN public.quotes q ON q.id = a.quote_id
  LEFT JOIN public.profiles assignee ON assignee.id = a.assignee_profile_id
  WHERE ($1::boolean IS TRUE OR a.assignee_profile_id = $2::uuid)
    AND ($3::text IS NULL OR a.status = $3)
  ORDER BY a.requested_at DESC
  LIMIT 500
`;

function getConnectionString(): string {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('Missing database connection string for quote RAMS actions');
  }
  return connectionString;
}

function createPgClient(): pg.Client {
  const url = new URL(getConnectionString());
  return new Client({
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  });
}

async function defaultRunTransaction<T>(fn: (db: QuoteRamsDb) => Promise<T>): Promise<T> {
  const client = createPgClient();
  await client.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The original error is the one the caller needs.
    }
    throw error;
  } finally {
    await client.end();
  }
}

async function defaultQuery<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<{ rows: T[]; rowCount: number | null }> {
  const client = createPgClient();
  await client.connect();
  try {
    const result = await client.query(sql, params);
    return { rows: result.rows as T[], rowCount: result.rowCount };
  } finally {
    await client.end();
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').slice(0, 180);
}

export async function sendQuoteRamsAssigneeEmail(
  input: QuoteRamsAssigneeEmail
): Promise<QuoteRamsEmailResult> {
  if (process.env.NODE_ENV === 'test') {
    return { success: false, error: 'Email sending is disabled when NODE_ENV=test' };
  }

  const { apiKey, fromEmail } = getQuoteResendEmailConfig();
  if (!apiKey) {
    return { success: false, error: 'Email service not configured' };
  }

  const reference = escapeHtml(input.quoteReference);
  const subjectLine = input.subjectLine?.trim()
    ? `<p>${escapeHtml(input.subjectLine.trim())}</p>`
    : '';
  const greeting = input.assigneeName?.trim()
    ? `<p>Hello ${escapeHtml(input.assigneeName.trim())},</p>`
    : '<p>Hello,</p>';
  const html = `<!DOCTYPE html><html><body style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">${greeting}<p>You have been assigned the RAMS action for quote <strong>${reference}</strong>.</p>${subjectLine}<p>Open the quote in the app to complete it with the linked RAMS document.</p></body></html>`;

  try {
    const response = await sendResendEmail({
      apiKey,
      payload: {
        from: fromEmail,
        to: [input.to],
        subject: singleLine(`RAMS required for quote ${input.quoteReference}`),
        html,
      },
    });
    if (!response.ok) {
      let message = 'Failed to send email';
      try {
        const body = (await response.json()) as { message?: string };
        if (body.message) message = body.message;
      } catch {
        message = 'Failed to send email';
      }
      return { success: false, error: message };
    }
    return { success: true };
  } catch {
    return { success: false, uncertain: true, error: 'Email outcome is uncertain and was not retried.' };
  }
}

async function defaultLoadAssignee(profileId: string): Promise<{ email: string | null; fullName: string | null }> {
  const { createAdminClient } = await import('@/lib/supabase/admin');
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(profileId);
  if (error || !data.user) {
    return { email: null, fullName: null };
  }
  const email = data.user.email?.trim() || null;
  const { data: profile } = await admin.from('profiles').select('full_name').eq('id', profileId).maybeSingle();
  return {
    email: email && email.includes('@') ? email : null,
    fullName: (profile?.full_name as string | null | undefined) ?? null,
  };
}

async function quotesAccessLevelForActor(userId: string): Promise<number> {
  const { getEffectiveRole } = await import('@/lib/utils/view-as');
  const effectiveRole = await getEffectiveRole();
  if (!effectiveRole.user_id || effectiveRole.user_id !== userId) return 0;

  const { getEffectiveModuleAccessLevel } = await import('@/lib/utils/rbac');
  return getEffectiveModuleAccessLevel('quotes');
}

async function defaultIsManagerOrAdmin(userId: string): Promise<boolean> {
  return (await quotesAccessLevelForActor(userId)) >= 4;
}

async function defaultIsQuoteAdmin(userId: string): Promise<boolean> {
  return (await quotesAccessLevelForActor(userId)) >= 5;
}

function resolveDeps(deps?: QuoteRamsDeps) {
  return {
    runTransaction: deps?.runTransaction ?? defaultRunTransaction,
    query: deps?.query ?? defaultQuery,
    sendAssigneeEmail: deps?.sendAssigneeEmail ?? sendQuoteRamsAssigneeEmail,
    loadAssignee: deps?.loadAssignee ?? defaultLoadAssignee,
    isManagerOrAdmin: deps?.isManagerOrAdmin ?? defaultIsManagerOrAdmin,
    isQuoteAdmin: deps?.isQuoteAdmin ?? defaultIsQuoteAdmin,
  };
}

function asIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapAction(row: Record<string, unknown>): ActionRecord {
  return {
    id: String(row.id),
    quote_id: String(row.quote_id),
    quote_reference: String(row.quote_reference),
    subject_line: row.subject_line == null ? null : String(row.subject_line),
    status: String(row.status) as QuoteRamsActionStatus,
    assignee_profile_id: String(row.assignee_profile_id),
    assignee_name: row.assignee_name == null ? null : String(row.assignee_name),
    assigned_by: row.assigned_by == null ? null : String(row.assigned_by),
    rams_document_id: row.rams_document_id == null ? null : String(row.rams_document_id),
    requested_by: row.requested_by == null ? null : String(row.requested_by),
    requested_at: asIso(row.requested_at) || new Date(0).toISOString(),
    completed_by: row.completed_by == null ? null : String(row.completed_by),
    completed_at: asIso(row.completed_at),
    confirmation_note: row.confirmation_note == null ? null : String(row.confirmation_note),
    email_status: String(row.email_status) as QuoteRamsEmailStatus,
    email_error: row.email_error == null ? null : String(row.email_error),
  };
}

function toDto(record: ActionRecord): QuoteRamsActionDto {
  const { subject_line: _subjectLine, ...dto } = record;
  return dto;
}

function optionalText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 2000) : null;
}

async function loadAction(query: QuoteRamsDb['query'], quoteId: string, forUpdateSql?: string): Promise<ActionRecord | null> {
  const result = await query<Record<string, unknown>>(forUpdateSql || LOAD_ACTION, [quoteId]);
  const row = result.rows[0];
  return row ? mapAction(row) : null;
}

async function listEligibleManagers(query: QuoteRamsDb['query']): Promise<QuoteRamsEligibleManagerDto[]> {
  const result = await query<ManagerSeriesRow>(LIST_MANAGERS);
  return result.rows.map((row) => ({
    profile_id: row.profile_id,
    full_name: row.full_name ?? null,
    initials: row.initials,
  }));
}

function managerRequired(managers: QuoteRamsEligibleManagerDto[]): QuoteRamsActionError {
  return new QuoteRamsActionError({
    message: 'Select an active quote manager.',
    status: 400,
    code: 'manager_required',
    fieldErrors: { manager_profile_id: 'Select an active quote manager.' },
    eligibleManagers: managers,
  });
}

async function resolveAssignee(
  db: QuoteRamsDb,
  quote: LockedQuote,
  managerProfileId: string | null
): Promise<string> {
  if (quote.requester_id) {
    const requester = await db.query<ManagerSeriesRow>(LOAD_MANAGER, [quote.requester_id]);
    const row = requester.rows[0];
    if (row?.is_active) return row.profile_id;
  }

  if (!managerProfileId) {
    throw managerRequired(await listEligibleManagers(db.query.bind(db)));
  }

  const selected = await db.query<ManagerSeriesRow>(LOAD_MANAGER, [managerProfileId]);
  const selectedRow = selected.rows[0];
  if (!selectedRow?.is_active) {
    throw managerRequired(await listEligibleManagers(db.query.bind(db)));
  }
  return selectedRow.profile_id;
}

function assertAcceptable(quote: LockedQuote): void {
  if (quote.is_latest_version !== true) {
    throw new QuoteRamsActionError({
      message: 'Only the latest quote version can be accepted with RAMS.',
      status: 409,
      code: 'not_latest',
    });
  }
  if (quote.commercial_status !== 'open') {
    throw new QuoteRamsActionError({
      message: 'This quote is commercially closed.',
      status: 409,
      code: 'commercially_closed',
    });
  }
  if (quote.status === 'po_received') {
    throw new QuoteRamsActionError({
      message: 'This quote is already accepted.',
      status: 409,
      code: 'already_accepted',
    });
  }
  if (quote.status !== 'sent') {
    throw new QuoteRamsActionError({
      message: 'Only a sent quote can be accepted with RAMS.',
      status: 409,
      code: 'not_sent',
    });
  }
}

async function insertTimeline(
  db: QuoteRamsDb,
  quote: LockedQuote,
  eventType: string,
  title: string,
  description: string,
  fromStatus: string | null,
  toStatus: string | null,
  actorUserId: string
): Promise<void> {
  await db.query(INSERT_TIMELINE, [
    quote.id,
    quote.quote_thread_id || quote.id,
    quote.quote_reference,
    eventType,
    title,
    description,
    fromStatus,
    toStatus,
    actorUserId,
  ]);
}

async function recordEmailResult(
  query: QuoteRamsDb['query'],
  actionId: string,
  token: string,
  status: QuoteRamsEmailStatus,
  error: string | null
): Promise<boolean> {
  const updated = await query(SET_EMAIL, [actionId, status, error, token]);
  return (updated.rowCount ?? updated.rows.length) > 0;
}

async function deliverAssigneeEmail(
  deps: ReturnType<typeof resolveDeps>,
  action: ActionRecord,
  claimSql: string
): Promise<string | null> {
  const token = crypto.randomUUID();
  const claimed = await deps.query(claimSql, [action.id, token, action.assignee_profile_id]);
  if ((claimed.rowCount ?? claimed.rows.length) === 0) {
    return null;
  }

  try {
    const assignee = await deps.loadAssignee(action.assignee_profile_id);
    if (!assignee.email) {
      await recordEmailResult(deps.query, action.id, token, 'failed', 'Assigned manager has no auth email');
      return 'Assigned manager has no auth email. The quote acceptance was kept.';
    }

    const result = await deps.sendAssigneeEmail({
      to: assignee.email,
      quoteReference: action.quote_reference,
      subjectLine: action.subject_line,
      assigneeName: assignee.fullName || action.assignee_name,
    });

    if (result.uncertain) {
      await recordEmailResult(deps.query, action.id, token, 'uncertain', result.error || 'Email outcome is uncertain');
      return result.error || 'Email outcome is uncertain and was not retried. The quote acceptance was kept.';
    }
    if (!result.success) {
      await recordEmailResult(deps.query, action.id, token, 'failed', result.error || 'Failed to send email');
      return result.error || 'The assignee email could not be sent. The quote acceptance was kept.';
    }

    const recorded = await recordEmailResult(deps.query, action.id, token, 'sent', null);
    if (!recorded) {
      return 'The assignee email was sent, but its state could not be recorded. It was not sent again.';
    }
    return null;
  } catch {
    try {
      await recordEmailResult(deps.query, action.id, token, 'uncertain', 'Email outcome is uncertain');
    } catch {
      // Acceptance must survive a failed email-state write.
    }
    return 'Email outcome is uncertain and was not retried. The quote acceptance was kept.';
  }
}

async function responseFromQuote(
  deps: ReturnType<typeof resolveDeps>,
  quoteId: string,
  created: boolean,
  emailWarning: string | null
): Promise<QuoteRamsMutationResponse> {
  const action = await loadAction(deps.query, quoteId);
  if (!action) {
    throw new QuoteRamsActionError({
      message: 'RAMS action not found.',
      status: 404,
      code: 'action_not_found',
    });
  }
  return { action: toDto(action), created, email_warning: emailWarning };
}

export async function getQuoteRamsContext(quoteId: string, deps?: QuoteRamsDeps): Promise<QuoteRamsContextResponse> {
  const resolved = resolveDeps(deps);
  const [action, managers, documents] = await Promise.all([
    loadAction(resolved.query, quoteId),
    listEligibleManagers(resolved.query),
    resolved.query<QuoteRamsLinkedDocumentDto>(LIST_DOCUMENTS, [quoteId]),
  ]);
  return {
    action: action ? toDto(action) : null,
    eligible_managers: managers,
    linked_documents: documents.rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      document_type_name: 'RAMS',
    })),
  };
}

export async function acceptQuoteRams(input: {
  quoteId: string;
  actorUserId: string;
  managerProfileId?: string | null;
}, deps?: QuoteRamsDeps): Promise<QuoteRamsMutationResponse> {
  const resolved = resolveDeps(deps);
  const managerProfileId = optionalText(input.managerProfileId);
  const outcome = await resolved.runTransaction(async (db) => {
    const locked = await db.query<LockedQuote>(LOCK_QUOTE, [input.quoteId]);
    const quote = locked.rows[0];
    if (!quote) {
      throw new QuoteRamsActionError({ message: 'Quote not found.', status: 404, code: 'quote_not_found' });
    }
    const existing = await loadAction(db.query.bind(db), input.quoteId, LOAD_ACTION_FOR_UPDATE);
    if (existing) return { created: false };

    assertAcceptable(quote);
    const assigneeId = await resolveAssignee(db, quote, managerProfileId);
    await db.query(UPDATE_QUOTE, [quote.id, input.actorUserId]);
    await db.query(INSERT_ACTION, [quote.id, assigneeId, input.actorUserId, input.actorUserId]);
    await insertTimeline(db, quote, 'quote_accepted', 'Quote accepted', 'Status changed to Accepted.', quote.status, 'po_received', input.actorUserId);
    await insertTimeline(db, quote, 'rams_requested', 'RAMS requested', 'RAMS action assigned.', quote.status, 'po_received', input.actorUserId);
    return { created: true };
  });

  if (!outcome.created) {
    return responseFromQuote(resolved, input.quoteId, false, null);
  }

  const createdAction = await loadAction(resolved.query, input.quoteId);
  let emailWarning: string | null = null;
  if (createdAction) {
    try {
      emailWarning = await deliverAssigneeEmail(resolved, createdAction, CLAIM_PENDING);
    } catch {
      emailWarning = 'The quote was accepted, but the assignee email could not be sent.';
    }
  }
  return responseFromQuote(resolved, input.quoteId, true, emailWarning);
}

export async function reassignQuoteRams(input: {
  quoteId: string;
  actorUserId: string;
  managerProfileId?: string | null;
}, deps?: QuoteRamsDeps): Promise<QuoteRamsMutationResponse> {
  const resolved = resolveDeps(deps);
  const allowed = (await resolved.isManagerOrAdmin(input.actorUserId)) || (await resolved.isQuoteAdmin(input.actorUserId));
  if (!allowed) {
    throw new QuoteRamsActionError({
      message: 'Only a manager or admin can reassign this RAMS action.',
      status: 403,
      code: 'reassign_forbidden',
    });
  }

  const managerProfileId = optionalText(input.managerProfileId);
  const changed = await resolved.runTransaction(async (db) => {
    const locked = await db.query<LockedQuote>(LOCK_QUOTE, [input.quoteId]);
    const quote = locked.rows[0];
    if (!quote) {
      throw new QuoteRamsActionError({ message: 'Quote not found.', status: 404, code: 'quote_not_found' });
    }
    const existing = await loadAction(db.query.bind(db), input.quoteId, LOAD_ACTION_FOR_UPDATE);
    if (!existing) {
      throw new QuoteRamsActionError({ message: 'RAMS action not found.', status: 404, code: 'action_not_found' });
    }
    if (existing.status !== 'open') {
      throw new QuoteRamsActionError({
        message: 'Only an open RAMS action can be reassigned.',
        status: 409,
        code: 'action_not_open',
      });
    }
    if (!managerProfileId) {
      throw managerRequired(await listEligibleManagers(db.query.bind(db)));
    }
    if (managerProfileId === existing.assignee_profile_id) return false;
    if (existing.email_status === 'sending' || existing.email_status === 'uncertain') {
      throw new QuoteRamsActionError({ message: 'Resolve the current email delivery before reassigning this action.', status: 409, code: 'email_delivery_unresolved' });
    }
    const selected = await db.query<ManagerSeriesRow>(LOAD_MANAGER, [managerProfileId]);
    if (!selected.rows[0]?.is_active) {
      throw managerRequired(await listEligibleManagers(db.query.bind(db)));
    }
    const updated = await db.query(REASSIGN_ACTION, [existing.id, managerProfileId, input.actorUserId]);
    if ((updated.rowCount ?? updated.rows.length) === 0) {
      throw new QuoteRamsActionError({
        message: 'Only an open RAMS action can be reassigned.',
        status: 409,
        code: 'action_not_open',
      });
    }
    await insertTimeline(
      db,
      quote,
      'rams_reassigned',
      'RAMS reassigned',
      'RAMS action assigned to another quote manager.',
      quote.status,
      quote.status,
      input.actorUserId
    );
    return true;
  });

  const reassigned = changed ? await loadAction(resolved.query, input.quoteId) : null;
  let warning: string | null = null;
  if (reassigned) {
    try { warning = await deliverAssigneeEmail(resolved, reassigned, CLAIM_PENDING); }
    catch { warning = 'The action was reassigned, but its email could not be sent. Check the delivery status before retrying.'; }
  }
  return responseFromQuote(resolved, input.quoteId, false, warning);
}

export async function completeQuoteRams(input: {
  quoteId: string;
  actorUserId: string;
  ramsDocumentId?: string | null;
  confirmationNote?: string | null;
}, deps?: QuoteRamsDeps): Promise<QuoteRamsMutationResponse> {
  const resolved = resolveDeps(deps);
  const documentId = optionalText(input.ramsDocumentId);
  if (!documentId) {
    throw new QuoteRamsActionError({
      message: 'Choose an active RAMS document linked to this quote.',
      status: 400,
      code: 'document_required',
      fieldErrors: { rams_document_id: 'Choose an active RAMS document linked to this quote.' },
    });
  }

  await resolved.runTransaction(async (db) => {
    const locked = await db.query<LockedQuote>(LOCK_QUOTE, [input.quoteId]);
    const quote = locked.rows[0];
    if (!quote) {
      throw new QuoteRamsActionError({ message: 'Quote not found.', status: 404, code: 'quote_not_found' });
    }
    const existing = await loadAction(db.query.bind(db), input.quoteId, LOAD_ACTION_FOR_UPDATE);
    if (!existing) {
      throw new QuoteRamsActionError({ message: 'RAMS action not found.', status: 404, code: 'action_not_found' });
    }
    const isAssignee = existing.assignee_profile_id === input.actorUserId;
    if (!isAssignee && !(await resolved.isQuoteAdmin(input.actorUserId))) {
      throw new QuoteRamsActionError({
        message: 'Only the assigned manager or an admin can complete this RAMS action.',
        status: 403,
        code: 'completion_forbidden',
      });
    }
    if (existing.status === 'completed') return;
    if (existing.status !== 'open') {
      throw new QuoteRamsActionError({ message: 'Only an open RAMS action can be completed.', status: 409, code: 'action_not_open' });
    }

    const document = await db.query<{ id: string; quote_id: string | null; is_active: boolean; document_type_name: string | null }>(
      LOAD_DOCUMENT,
      [documentId]
    );
    const linked = document.rows[0];
    if (!linked) {
      throw new QuoteRamsActionError({
        message: 'RAMS document not found.',
        status: 400,
        code: 'document_not_found',
        fieldErrors: { rams_document_id: 'RAMS document not found.' },
      });
    }
    if (linked.quote_id !== input.quoteId) {
      throw new QuoteRamsActionError({
        message: 'The document is not linked to this quote.',
        status: 400,
        code: 'unrelated_document',
        fieldErrors: { rams_document_id: 'The document is not linked to this quote.' },
      });
    }
    if (linked.is_active !== true) {
      throw new QuoteRamsActionError({
        message: 'The linked document must be active.',
        status: 400,
        code: 'inactive_document',
        fieldErrors: { rams_document_id: 'The linked document must be active.' },
      });
    }
    if (linked.document_type_name !== 'RAMS') {
      throw new QuoteRamsActionError({
        message: 'The linked document must be a RAMS document.',
        status: 400,
        code: 'not_rams',
        fieldErrors: { rams_document_id: 'The linked document must be a RAMS document.' },
      });
    }

    const note = optionalText(input.confirmationNote);
    const updated = await db.query(COMPLETE_ACTION, [existing.id, documentId, input.actorUserId, note]);
    if ((updated.rowCount ?? updated.rows.length) === 0) return;
    await insertTimeline(
      db,
      quote,
      'rams_completed',
      'RAMS completed',
      note || 'RAMS action completed.',
      quote.status,
      quote.status,
      input.actorUserId
    );
  });

  return responseFromQuote(resolved, input.quoteId, false, null);
}

export async function retryQuoteRamsEmail(input: {
  quoteId: string;
  actorUserId: string;
  hasQuotesAccess: boolean;
}, deps?: QuoteRamsDeps): Promise<QuoteRamsMutationResponse> {
  if (!input.hasQuotesAccess) {
    throw new QuoteRamsActionError({
      message: 'You cannot retry this RAMS email.',
      status: 403,
      code: 'retry_forbidden',
    });
  }

  const resolved = resolveDeps(deps);
  const existing = await loadAction(resolved.query, input.quoteId);
  if (!existing) {
    throw new QuoteRamsActionError({ message: 'RAMS action not found.', status: 404, code: 'action_not_found' });
  }

  if (existing.email_status === 'uncertain' || existing.email_status === 'sending' || existing.email_status === 'sent') {
    return {
      action: toDto(existing),
      created: false,
      email_warning: existing.email_status === 'uncertain'
        ? 'Email outcome is uncertain and was not sent again.'
        : null,
    };
  }

  let emailWarning: string | null = null;
  try {
    emailWarning = await deliverAssigneeEmail(resolved, existing, CLAIM_RETRY);
  } catch {
    emailWarning = 'The assignee email could not be sent.';
  }
  return responseFromQuote(resolved, input.quoteId, false, emailWarning);
}

export async function callerIsQuoteAdmin(userId: string, deps?: QuoteRamsDeps): Promise<boolean> {
  return resolveDeps(deps).isQuoteAdmin(userId);
}

export async function listQuoteRamsActions(input: {
  userId: string;
  listAll: boolean;
  status?: QuoteRamsActionStatus | null;
}, deps?: QuoteRamsDeps): Promise<QuoteRamsActionListItemDto[]> {
  const resolved = resolveDeps(deps);
  const result = await resolved.query<Record<string, unknown>>(LIST_ACTIONS, [
    input.listAll,
    input.userId,
    input.status ?? null,
  ]);
  return result.rows.map((row) => ({
    id: String(row.id),
    quote_id: String(row.quote_id),
    quote_reference: String(row.quote_reference),
    status: String(row.status) as QuoteRamsActionStatus,
    assignee_profile_id: String(row.assignee_profile_id),
    assignee_name: row.assignee_name == null ? null : String(row.assignee_name),
    email_status: String(row.email_status) as QuoteRamsEmailStatus,
    requested_at: asIso(row.requested_at) || new Date(0).toISOString(),
    completed_at: asIso(row.completed_at),
    rams_document_id: row.rams_document_id == null ? null : String(row.rams_document_id),
  }));
}
