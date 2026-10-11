import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendResendEmail } from '@/lib/server/resend';
import {
  QuoteRamsActionError,
  acceptQuoteRams,
  reassignQuoteRams,
  completeQuoteRams,
  listQuoteRamsActions,
  retryQuoteRamsEmail,
  sendQuoteRamsAssigneeEmail,
  type QuoteRamsDb,
  type QuoteRamsDeps,
} from '@/lib/server/quote-rams-actions';

const matrix = vi.hoisted(() => ({
  getEffectiveRole: vi.fn(),
  getEffectiveModuleAccessLevel: vi.fn(),
}));

vi.mock('@/lib/server/resend', () => ({
  sendResendEmail: vi.fn(),
}));

vi.mock('@/lib/utils/view-as', () => ({
  getEffectiveRole: matrix.getEffectiveRole,
}));

vi.mock('@/lib/utils/rbac', () => ({
  getEffectiveModuleAccessLevel: matrix.getEffectiveModuleAccessLevel,
}));

vi.mock('@/lib/server/resend-email-config', () => ({
  getQuoteResendEmailConfig: () => ({ apiKey: 'test-not-real', fromEmail: 'RAMS <rams@example.test>' }),
}));

const QUOTE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const REQUESTER_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_MANAGER_ID = '44444444-4444-4444-8444-444444444444';
const ADMIN_ID = '55555555-5555-4555-8555-555555555555';
const DOC_ID = '66666666-6666-4666-8666-666666666666';
const OTHER_DOC_ID = '77777777-7777-4777-8777-777777777777';
const NON_RAMS_ID = '88888888-8888-4888-8888-888888888888';
const INACTIVE_DOC_ID = '99999999-9999-4999-8999-999999999999';
const OTHER_QUOTE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

interface FakeAction {
  id: string;
  quote_id: string;
  assignee_profile_id: string;
  assigned_by: string | null;
  status: string;
  rams_document_id: string | null;
  requested_by: string | null;
  requested_at: string;
  completed_by: string | null;
  completed_at: string | null;
  confirmation_note: string | null;
  email_status: string;
  email_error: string | null;
  email_claim_token: string | null;
}

interface FakeState {
  quote: {
    id: string;
    status: string;
    is_latest_version: boolean;
    commercial_status: string;
    requester_id: string | null;
    quote_thread_id: string;
    quote_reference: string;
    subject_line: string | null;
    rams_requested_at: string | null;
    updated_by: string | null;
  } | null;
  actions: FakeAction[];
  timeline: Array<{ event_type: string }>;
  failTimeline: boolean;
  managers: Array<{ profile_id: string; initials: string; is_active: boolean; full_name: string }>;
  profiles: Record<string, string>;
  documents: Array<{ id: string; quote_id: string; is_active: boolean; document_type_name: string | null; title: string }>;
}

function createState(): FakeState {
  return {
    quote: {
      id: QUOTE_ID,
      status: 'sent',
      is_latest_version: true,
      commercial_status: 'open',
      requester_id: REQUESTER_ID,
      quote_thread_id: QUOTE_ID,
      quote_reference: '80001-RQ',
      subject_line: 'Hedge <work>',
      rams_requested_at: null,
      updated_by: null,
    },
    actions: [],
    timeline: [],
    failTimeline: false,
    managers: [
      { profile_id: REQUESTER_ID, initials: 'RQ', is_active: true, full_name: 'Requester' },
      { profile_id: OTHER_MANAGER_ID, initials: 'OM', is_active: true, full_name: 'Other Manager' },
    ],
    profiles: {
      [REQUESTER_ID]: 'Requester',
      [OTHER_MANAGER_ID]: 'Other Manager',
      [ADMIN_ID]: 'Admin',
      [ACTOR_ID]: 'Actor',
    },
    documents: [
      { id: DOC_ID, quote_id: QUOTE_ID, is_active: true, document_type_name: 'RAMS', title: 'Site RAMS' },
      { id: OTHER_DOC_ID, quote_id: OTHER_QUOTE_ID, is_active: true, document_type_name: 'RAMS', title: 'Other quote' },
      { id: NON_RAMS_ID, quote_id: QUOTE_ID, is_active: true, document_type_name: 'Method statement', title: 'Method' },
      { id: INACTIVE_DOC_ID, quote_id: QUOTE_ID, is_active: false, document_type_name: 'RAMS', title: 'Old RAMS' },
    ],
  };
}

function tagOf(sql: string): string {
  const match = sql.match(/\/\* quote_rams:([a-z_]+) \*\//);
  if (!match) throw new Error(`Untagged SQL: ${sql}`);
  return match[1];
}

function actionView(state: FakeState, action: FakeAction) {
  const quote = state.quote;
  return {
    ...action,
    quote_reference: quote?.quote_reference || '80001-RQ',
    subject_line: quote?.subject_line ?? null,
    assignee_name: state.profiles[action.assignee_profile_id] || null,
  };
}

function dispatch(state: FakeState, sql: string, params: unknown[] = []) {
  const tag = tagOf(sql);
  const rowsFor = (rows: unknown[]) => ({ rows, rowCount: rows.length });

  if (tag === 'lock_quote') {
    return rowsFor(state.quote && state.quote.id === params[0] ? [state.quote] : []);
  }
  if (tag === 'load_action' || tag === 'load_action_for_update') {
    const action = state.actions.find((row) => row.quote_id === params[0]);
    return rowsFor(action ? [actionView(state, action)] : []);
  }
  if (tag === 'load_manager') {
    const manager = state.managers.find((row) => row.profile_id === params[0]);
    return rowsFor(manager ? [manager] : []);
  }
  if (tag === 'list_managers') {
    return rowsFor(state.managers.filter((row) => row.is_active));
  }
  if (tag === 'update_quote') {
    if (!state.quote || state.quote.id !== params[0]) return rowsFor([]);
    state.quote.status = 'po_received';
    state.quote.rams_requested_at = '2026-10-11T21:00:00.000Z';
    state.quote.updated_by = String(params[1]);
    return rowsFor([{ id: state.quote.id }]);
  }
  if (tag === 'insert_action') {
    const action: FakeAction = {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      quote_id: String(params[0]),
      assignee_profile_id: String(params[1]),
      assigned_by: String(params[2]),
      status: 'open',
      rams_document_id: null,
      requested_by: String(params[3]),
      requested_at: '2026-10-11T21:00:00.000Z',
      completed_by: null,
      completed_at: null,
      confirmation_note: null,
      email_status: 'pending',
      email_error: null,
      email_claim_token: null,
    };
    state.actions.push(action);
    return rowsFor([{ id: action.id }]);
  }
  if (tag === 'insert_timeline') {
    if (state.failTimeline && params[3] === 'rams_requested') {
      throw new Error('timeline failed');
    }
    state.timeline.push({ event_type: String(params[3]) });
    return rowsFor([{ id: 'timeline' }]);
  }
  if (tag === 'claim_pending' || tag === 'claim_retry') {
    const action = state.actions.find((row) => row.id === params[0]);
    const allowed = tag === 'claim_pending' ? ['pending'] : ['pending', 'failed'];
    if (!action || !allowed.includes(action.email_status) || action.status !== 'open' || action.assignee_profile_id !== params[2]) return rowsFor([]);
    action.email_status = 'sending';
    action.email_claim_token = String(params[1]);
    return rowsFor([{ id: action.id }]);
  }
  if (tag === 'set_email') {
    const action = state.actions.find((row) => row.id === params[0]);
    if (!action || action.email_claim_token !== params[3] || action.email_status !== 'sending') return rowsFor([]);
    action.email_status = String(params[1]);
    action.email_error = params[2] == null ? null : String(params[2]);
    return rowsFor([{ id: action.id }]);
  }
  if (tag === 'load_document') {
    const document = state.documents.find((row) => row.id === params[0]);
    return rowsFor(document ? [document] : []);
  }
  if (tag === 'list_documents') {
    return rowsFor(state.documents.filter((row) => (
      row.quote_id === params[0] && row.is_active && row.document_type_name === 'RAMS'
    )));
  }
  if (tag === 'complete') {
    const action = state.actions.find((row) => row.id === params[0] && row.status === 'open');
    if (!action) return rowsFor([]);
    action.status = 'completed';
    action.rams_document_id = String(params[1]);
    action.completed_by = String(params[2]);
    action.completed_at = '2026-10-11T21:05:00.000Z';
    action.confirmation_note = params[3] == null ? null : String(params[3]);
    return rowsFor([{ id: action.id }]);
  }
  if (tag === 'reassign') {
    const action = state.actions.find((row) => row.id === params[0] && row.status === 'open');
    if (!action) return rowsFor([]);
    action.assignee_profile_id = String(params[1]);
    action.assigned_by = String(params[2]);
    action.email_status = 'pending';
    action.email_claim_token = null;
    return rowsFor([{ id: action.id }]);
  }
  if (tag === 'list_actions') {
    const listAll = params[0] === true;
    const userId = String(params[1]);
    const status = params[2] == null ? null : String(params[2]);
    const actions = state.actions.filter((row) => (
      (listAll || row.assignee_profile_id === userId) && (status === null || row.status === status)
    ));
    return rowsFor(actions.map((row) => actionView(state, row)));
  }
  throw new Error(`Unhandled SQL tag ${tag}`);
}

function createDeps(state: FakeState, overrides: Partial<QuoteRamsDeps> = {}) {
  const sent: string[] = [];
  const query: QuoteRamsDb['query'] = async (sql, params) => dispatch(state, sql, params);
  const deps: QuoteRamsDeps = {
    query,
    runTransaction: async (fn) => {
      const snapshot = structuredClone(state);
      try {
        return await fn({ query });
      } catch (error) {
        state.quote = snapshot.quote;
        state.actions = snapshot.actions;
        state.timeline = snapshot.timeline;
        state.failTimeline = snapshot.failTimeline;
        throw error;
      }
    },
    loadAssignee: async () => ({ email: 'manager@example.test', fullName: 'Requester' }),
    sendAssigneeEmail: async (input) => {
      sent.push(input.to);
      return { success: true };
    },
    isManagerOrAdmin: async () => false,
    isQuoteAdmin: async () => false,
    ...overrides,
  };
  return { deps, sent };
}

function withoutRoleOverrides(deps: QuoteRamsDeps): QuoteRamsDeps {
  const next = { ...deps };
  delete next.isManagerOrAdmin;
  delete next.isQuoteAdmin;
  return next;
}

describe('quote RAMS actions', () => {
  let state: FakeState;

  beforeEach(() => {
    state = createState();
    vi.mocked(sendResendEmail).mockReset();
  });

  it('keeps acceptance and the open action when assignee email fails', async () => {
    const { deps } = createDeps(state, {
      sendAssigneeEmail: async () => ({ success: false, error: 'mailbox unavailable' }),
    });

    const result = await acceptQuoteRams({ quoteId: QUOTE_ID, actorUserId: ACTOR_ID }, deps);

    expect(result.created).toBe(true);
    expect(result.email_warning).toContain('mailbox unavailable');
    expect(result.action.email_status).toBe('failed');
    expect(result.action).not.toHaveProperty('subject_line');
    expect(state.quote?.status).toBe('po_received');
    expect(state.actions).toHaveLength(1);
    expect(state.timeline.map((event) => event.event_type)).toEqual(['quote_accepted', 'rams_requested']);
  });

  it('returns the existing action without another timeline event or email', async () => {
    const { deps, sent } = createDeps(state);
    await acceptQuoteRams({ quoteId: QUOTE_ID, actorUserId: ACTOR_ID }, deps);
    const timelineCount = state.timeline.length;

    const repeat = await acceptQuoteRams({ quoteId: QUOTE_ID, actorUserId: ACTOR_ID }, deps);

    expect(repeat.created).toBe(false);
    expect(repeat.email_warning).toBeNull();
    expect(state.timeline).toHaveLength(timelineCount);
    expect(state.actions).toHaveLength(1);
    expect(sent).toEqual(['manager@example.test']);
  });

  it('rolls back quote acceptance and the action when the timeline insert fails', async () => {
    state.failTimeline = true;
    const { deps, sent } = createDeps(state);

    await expect(acceptQuoteRams({ quoteId: QUOTE_ID, actorUserId: ACTOR_ID }, deps)).rejects.toThrow('timeline failed');

    expect(state.quote?.status).toBe('sent');
    expect(state.quote?.rams_requested_at).toBeNull();
    expect(state.actions).toEqual([]);
    expect(state.timeline).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('requires an eligible manager and does not accept the quote when the requester is inactive', async () => {
    state.managers[0].is_active = false;
    const { deps } = createDeps(state);

    await expect(acceptQuoteRams({ quoteId: QUOTE_ID, actorUserId: ACTOR_ID }, deps)).rejects.toMatchObject({
      code: 'manager_required',
      status: 400,
      fieldErrors: { manager_profile_id: 'Select an active quote manager.' },
    });
    expect(state.quote?.status).toBe('sent');
    expect(state.actions).toEqual([]);

    const accepted = await acceptQuoteRams({
      quoteId: QUOTE_ID,
      actorUserId: ACTOR_ID,
      managerProfileId: OTHER_MANAGER_ID,
    }, deps);
    expect(accepted.action.assignee_profile_id).toBe(OTHER_MANAGER_ID);
  });

  it('rejects a quote that is not sent, not latest, commercially closed, or already accepted', async () => {
    const { deps } = createDeps(state);
    state.quote!.is_latest_version = false;
    await expect(acceptQuoteRams({ quoteId: QUOTE_ID, actorUserId: ACTOR_ID }, deps)).rejects.toMatchObject({ code: 'not_latest' });

    state.quote!.is_latest_version = true;
    state.quote!.commercial_status = 'closed';
    await expect(acceptQuoteRams({ quoteId: QUOTE_ID, actorUserId: ACTOR_ID }, deps)).rejects.toMatchObject({ code: 'commercially_closed' });

    state.quote!.commercial_status = 'open';
    state.quote!.status = 'po_received';
    await expect(acceptQuoteRams({ quoteId: QUOTE_ID, actorUserId: ACTOR_ID }, deps)).rejects.toMatchObject({ code: 'already_accepted' });
    expect(state.actions).toEqual([]);
  });

  it('lets only the assignee or an admin complete, and only with an active RAMS document on the quote', async () => {
    const { deps } = createDeps(state);
    await acceptQuoteRams({ quoteId: QUOTE_ID, actorUserId: ACTOR_ID }, deps);

    await expect(completeQuoteRams({
      quoteId: QUOTE_ID,
      actorUserId: OTHER_MANAGER_ID,
      ramsDocumentId: DOC_ID,
    }, deps)).rejects.toBeInstanceOf(QuoteRamsActionError);
    await expect(completeQuoteRams({
      quoteId: QUOTE_ID,
      actorUserId: OTHER_MANAGER_ID,
      ramsDocumentId: DOC_ID,
    }, { ...deps, isManagerOrAdmin: async () => true })).rejects.toMatchObject({ code: 'completion_forbidden' });

    await expect(completeQuoteRams({
      quoteId: QUOTE_ID,
      actorUserId: REQUESTER_ID,
      ramsDocumentId: OTHER_DOC_ID,
    }, deps)).rejects.toMatchObject({ code: 'unrelated_document' });
    await expect(completeQuoteRams({
      quoteId: QUOTE_ID,
      actorUserId: REQUESTER_ID,
      ramsDocumentId: NON_RAMS_ID,
    }, deps)).rejects.toMatchObject({ code: 'not_rams' });
    await expect(completeQuoteRams({
      quoteId: QUOTE_ID,
      actorUserId: REQUESTER_ID,
      ramsDocumentId: INACTIVE_DOC_ID,
    }, deps)).rejects.toMatchObject({ code: 'inactive_document' });

    const completed = await completeQuoteRams({
      quoteId: QUOTE_ID,
      actorUserId: ADMIN_ID,
      ramsDocumentId: DOC_ID,
    }, { ...deps, isQuoteAdmin: async () => true });

    expect(completed.action.status).toBe('completed');
    expect(completed.action.rams_document_id).toBe(DOC_ID);
    expect(completed.action.completed_by).toBe(ADMIN_ID);
    expect(state.timeline.map((event) => event.event_type)).toContain('rams_completed');
    await expect(completeQuoteRams({ quoteId: QUOTE_ID, actorUserId: OTHER_MANAGER_ID, ramsDocumentId: DOC_ID }, deps)).rejects.toMatchObject({ code: 'completion_forbidden' });
  });

  it('emails a new assignee once and refuses reassignment during delivery', async () => {
    const { deps, sent } = createDeps(state, { isManagerOrAdmin: async () => true });
    await acceptQuoteRams({ quoteId: QUOTE_ID, actorUserId: ACTOR_ID }, deps);
    await reassignQuoteRams({ quoteId: QUOTE_ID, actorUserId: ACTOR_ID, managerProfileId: OTHER_MANAGER_ID }, deps);
    expect(sent).toHaveLength(2);
    await reassignQuoteRams({ quoteId: QUOTE_ID, actorUserId: ACTOR_ID, managerProfileId: OTHER_MANAGER_ID }, deps);
    expect(sent).toHaveLength(2);
    state.actions[0].email_status = 'sending';
    await expect(reassignQuoteRams({ quoteId: QUOTE_ID, actorUserId: ACTOR_ID, managerProfileId: REQUESTER_ID }, deps)).rejects.toMatchObject({ code: 'email_delivery_unresolved' });
  });

  it('keeps an uncertain email and retries only an explicit failed send once', async () => {
    const calls: string[] = [];
    const { deps } = createDeps(state, {
      sendAssigneeEmail: async () => {
        calls.push('send');
        return { success: false, uncertain: true, error: 'socket closed' };
      },
    });
    const accepted = await acceptQuoteRams({ quoteId: QUOTE_ID, actorUserId: ACTOR_ID }, deps);
    expect(accepted.action.email_status).toBe('uncertain');

    const retained = await retryQuoteRamsEmail({
      quoteId: QUOTE_ID,
      actorUserId: REQUESTER_ID,
      hasQuotesAccess: true,
    }, deps);
    expect(retained.email_warning).toContain('uncertain');
    expect(calls).toHaveLength(1);

    state.actions[0].email_status = 'failed';
    const { deps: retryDeps } = createDeps(state, {
      sendAssigneeEmail: async (input) => {
        calls.push(input.to);
        return { success: true };
      },
    });
    const retried = await retryQuoteRamsEmail({
      quoteId: QUOTE_ID,
      actorUserId: REQUESTER_ID,
      hasQuotesAccess: true,
    }, retryDeps);
    expect(retried.action.email_status).toBe('sent');
    expect(calls).toEqual(['send', 'manager@example.test']);
  });

  it('denies retry without quotes access even for the assignee or a quote admin', async () => {
    const { deps, sent } = createDeps(state);
    await acceptQuoteRams({ quoteId: QUOTE_ID, actorUserId: ACTOR_ID }, deps);
    state.actions[0].email_status = 'failed';

    await expect(retryQuoteRamsEmail({
      quoteId: QUOTE_ID,
      actorUserId: REQUESTER_ID,
      hasQuotesAccess: false,
    }, { ...deps, isQuoteAdmin: async () => true })).rejects.toMatchObject({ code: 'retry_forbidden' });
    await expect(retryQuoteRamsEmail({
      quoteId: QUOTE_ID,
      actorUserId: ADMIN_ID,
      hasQuotesAccess: false,
    }, { ...deps, isQuoteAdmin: async () => true })).rejects.toMatchObject({ code: 'retry_forbidden' });

    expect(sent).toEqual(['manager@example.test']);
    expect(state.actions[0].email_status).toBe('failed');
  });

  it('uses quotes matrix levels for the effective user and fails closed when lookup throws', async () => {
    const { deps, sent } = createDeps(state);
    const defaults = withoutRoleOverrides(deps);
    await acceptQuoteRams({ quoteId: QUOTE_ID, actorUserId: ACTOR_ID }, defaults);
    expect(state.actions[0].assignee_profile_id).toBe(REQUESTER_ID);

    matrix.getEffectiveRole.mockResolvedValue({ user_id: ACTOR_ID, role_class: 'manager', role_name: 'Manager' });
    matrix.getEffectiveModuleAccessLevel.mockResolvedValue(3);
    await expect(reassignQuoteRams({
      quoteId: QUOTE_ID,
      actorUserId: ACTOR_ID,
      managerProfileId: OTHER_MANAGER_ID,
    }, defaults)).rejects.toMatchObject({ code: 'reassign_forbidden' });
    expect(matrix.getEffectiveModuleAccessLevel).toHaveBeenCalledWith('quotes');
    expect(state.actions[0].assignee_profile_id).toBe(REQUESTER_ID);

    matrix.getEffectiveRole.mockResolvedValue({ user_id: ACTOR_ID, role_class: 'employee', role_name: 'Employee' });
    matrix.getEffectiveModuleAccessLevel.mockResolvedValue(4);
    await reassignQuoteRams({
      quoteId: QUOTE_ID,
      actorUserId: ACTOR_ID,
      managerProfileId: OTHER_MANAGER_ID,
    }, defaults);
    expect(state.actions[0].assignee_profile_id).toBe(OTHER_MANAGER_ID);

    matrix.getEffectiveRole.mockResolvedValue({ user_id: ACTOR_ID, role_class: 'admin', role_name: 'Admin' });
    matrix.getEffectiveModuleAccessLevel.mockResolvedValue(4);
    await expect(completeQuoteRams({
      quoteId: QUOTE_ID,
      actorUserId: ACTOR_ID,
      ramsDocumentId: DOC_ID,
    }, defaults)).rejects.toMatchObject({ code: 'completion_forbidden' });
    expect(state.actions[0].status).toBe('open');

    matrix.getEffectiveModuleAccessLevel.mockClear();
    matrix.getEffectiveRole.mockResolvedValue({ user_id: ADMIN_ID, role_class: 'admin', role_name: 'Admin' });
    matrix.getEffectiveModuleAccessLevel.mockResolvedValue(5);
    await expect(reassignQuoteRams({
      quoteId: QUOTE_ID,
      actorUserId: ACTOR_ID,
      managerProfileId: REQUESTER_ID,
    }, defaults)).rejects.toMatchObject({ code: 'reassign_forbidden' });
    expect(matrix.getEffectiveModuleAccessLevel).not.toHaveBeenCalled();
    expect(state.actions[0].assignee_profile_id).toBe(OTHER_MANAGER_ID);

    matrix.getEffectiveRole.mockResolvedValue({ user_id: ACTOR_ID, role_class: 'employee', role_name: 'Employee' });
    matrix.getEffectiveModuleAccessLevel.mockResolvedValue(5);
    const completed = await completeQuoteRams({
      quoteId: QUOTE_ID,
      actorUserId: ACTOR_ID,
      ramsDocumentId: DOC_ID,
    }, defaults);
    expect(completed.action.status).toBe('completed');
    expect(completed.action.completed_by).toBe(ACTOR_ID);

    state.actions[0].status = 'open';
    matrix.getEffectiveModuleAccessLevel.mockRejectedValue(new Error('matrix lookup failed'));
    await expect(reassignQuoteRams({
      quoteId: QUOTE_ID,
      actorUserId: ACTOR_ID,
      managerProfileId: REQUESTER_ID,
    }, defaults)).rejects.toThrow('matrix lookup failed');
    expect(state.actions[0].status).toBe('open');
    expect(state.actions[0].assignee_profile_id).toBe(OTHER_MANAGER_ID);
    expect(sent).toEqual(['manager@example.test', 'manager@example.test']);
  });

  it('does not call Resend when NODE_ENV is test', async () => {
    expect(process.env.NODE_ENV).toBe('test');
    const result = await sendQuoteRamsAssigneeEmail({
      to: 'manager@example.test',
      quoteReference: '80001-RQ',
      subjectLine: '<script>',
      assigneeName: 'Requester',
    });
    expect(result.success).toBe(false);
    expect(sendResendEmail).not.toHaveBeenCalled();

    const { deps } = createDeps(state, { sendAssigneeEmail: undefined });
    const accepted = await acceptQuoteRams({ quoteId: QUOTE_ID, actorUserId: ACTOR_ID }, deps);
    expect(accepted.action.email_status).toBe('failed');
    expect(accepted.email_warning).toContain('NODE_ENV=test');
    expect(state.quote?.status).toBe('po_received');
    expect(sendResendEmail).not.toHaveBeenCalled();
  });

  it('escapes assignee email content and does not add a CC', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.mocked(sendResendEmail).mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
    try {
      const result = await sendQuoteRamsAssigneeEmail({
        to: 'manager@example.test',
        quoteReference: '80001-RQ',
        subjectLine: '<script>',
        assigneeName: 'A & B',
      });
      expect(result.success).toBe(true);
      expect(sendResendEmail).toHaveBeenCalledTimes(1);
      const payload = vi.mocked(sendResendEmail).mock.calls[0][0].payload;
      expect(payload.to).toEqual(['manager@example.test']);
      expect(payload).not.toHaveProperty('cc');
      expect(payload.html).toContain('&lt;script&gt;');
      expect(payload.html).toContain('A &amp; B');
      expect(payload.html).not.toContain('<script>');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('lists only the caller actions unless the caller is allowed to see every row', async () => {
    state.actions.push(
      {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        quote_id: QUOTE_ID,
        assignee_profile_id: REQUESTER_ID,
        assigned_by: ACTOR_ID,
        status: 'open',
        rams_document_id: null,
        requested_by: ACTOR_ID,
        requested_at: '2026-10-11T21:00:00.000Z',
        completed_by: null,
        completed_at: null,
        confirmation_note: null,
        email_status: 'sent',
        email_error: null,
        email_claim_token: null,
      },
      {
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        quote_id: OTHER_QUOTE_ID,
        assignee_profile_id: OTHER_MANAGER_ID,
        assigned_by: ACTOR_ID,
        status: 'open',
        rams_document_id: null,
        requested_by: ACTOR_ID,
        requested_at: '2026-10-11T21:01:00.000Z',
        completed_by: null,
        completed_at: null,
        confirmation_note: null,
        email_status: 'pending',
        email_error: null,
        email_claim_token: null,
      },
    );
    const { deps } = createDeps(state);
    const own = await listQuoteRamsActions({ userId: REQUESTER_ID, listAll: false, status: 'open' }, deps);
    const all = await listQuoteRamsActions({ userId: REQUESTER_ID, listAll: true, status: 'open' }, deps);

    expect(own.map((row) => row.id)).toEqual(['cccccccc-cccc-4ccc-8ccc-cccccccccccc']);
    expect(all).toHaveLength(2);
    expect(Object.keys(own[0]).sort()).toEqual([
      'assignee_name',
      'assignee_profile_id',
      'completed_at',
      'email_status',
      'id',
      'quote_id',
      'quote_reference',
      'rams_document_id',
      'requested_at',
      'status',
    ]);
  });

  it('defines a browser-read, server-write table with one row per quote', () => {
    const sql = readFileSync('supabase/migrations/20261011220000_quote_rams_actions.sql', 'utf8');
    const source = readFileSync('lib/server/quote-rams-actions.ts', 'utf8');
    expect(sql).toContain('quote_id UUID NOT NULL UNIQUE');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('REVOKE ALL ON TABLE public.quote_rams_actions FROM PUBLIC, anon, authenticated');
    expect(sql).not.toContain('FOR INSERT');
    expect(sql).not.toContain('FOR UPDATE');
    expect(sql).not.toContain('FOR DELETE');
    expect(sql).toContain("'uncertain'");
    expect(source).toContain('FOR UPDATE');
    expect(source).toContain("await client.query('BEGIN')");
    expect(source).toContain("await client.query('ROLLBACK')");
  });
});
