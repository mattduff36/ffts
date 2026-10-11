import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const harness = vi.hoisted(() => {
  class QuoteRamsActionError extends Error {
    readonly status: number;
    readonly code: string;
    readonly fieldErrors?: Record<string, string>;
    readonly eligibleManagers?: unknown;

    constructor(input: { message: string; status: number; code: string }) {
      super(input.message);
      this.name = 'QuoteRamsActionError';
      this.status = input.status;
      this.code = input.code;
    }
  }

  return {
    QuoteRamsActionError,
    getUser: vi.fn(),
    requireSensitiveModuleAccess: vi.fn(),
    acceptQuoteRams: vi.fn(),
    reassignQuoteRams: vi.fn(),
    completeQuoteRams: vi.fn(),
    retryQuoteRamsEmail: vi.fn(),
    getQuoteRamsContext: vi.fn(),
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: harness.getUser } }),
}));

vi.mock('@/lib/server/sensitive-module-access', () => ({
  requireSensitiveModuleAccess: harness.requireSensitiveModuleAccess,
}));

vi.mock('@/lib/server/quote-rams-actions', () => ({
  QuoteRamsActionError: harness.QuoteRamsActionError,
  acceptQuoteRams: harness.acceptQuoteRams,
  reassignQuoteRams: harness.reassignQuoteRams,
  completeQuoteRams: harness.completeQuoteRams,
  retryQuoteRamsEmail: harness.retryQuoteRamsEmail,
  getQuoteRamsContext: harness.getQuoteRamsContext,
}));

const QUOTE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

function post(body: unknown) {
  return new NextRequest(`http://localhost/api/quotes/${QUOTE_ID}/rams-action`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST/GET /api/quotes/[id]/rams-action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    harness.requireSensitiveModuleAccess.mockResolvedValue(null);
  });

  it('denies anonymous and quotes-module failures before acceptance', async () => {
    const { GET, POST } = await import('@/app/api/quotes/[id]/rams-action/route');
    harness.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const anonymous = await POST(post({ action: 'accept' }), { params: Promise.resolve({ id: QUOTE_ID }) });
    expect(anonymous.status).toBe(401);
    expect(harness.acceptQuoteRams).not.toHaveBeenCalled();

    harness.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    harness.requireSensitiveModuleAccess.mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    );
    const forbidden = await POST(post({ action: 'accept' }), { params: Promise.resolve({ id: QUOTE_ID }) });
    expect(forbidden.status).toBe(403);
    expect(harness.acceptQuoteRams).not.toHaveBeenCalled();

    const context = await GET(new NextRequest('http://localhost/api/quotes/x/rams-action'), {
      params: Promise.resolve({ id: QUOTE_ID }),
    });
    expect(context.status).toBe(403);
    expect(harness.getQuoteRamsContext).not.toHaveBeenCalled();
  });

  it('returns the acceptance contract and maps completion denial', async () => {
    const { POST } = await import('@/app/api/quotes/[id]/rams-action/route');
    harness.acceptQuoteRams.mockResolvedValue({
      action: {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        quote_id: QUOTE_ID,
        quote_reference: '80001-RQ',
        status: 'open',
        assignee_profile_id: USER_ID,
        assignee_name: 'Requester',
        assigned_by: USER_ID,
        rams_document_id: null,
        requested_by: USER_ID,
        requested_at: '2026-10-11T21:00:00.000Z',
        completed_by: null,
        completed_at: null,
        confirmation_note: null,
        email_status: 'failed',
        email_error: 'mailbox unavailable',
      },
      created: true,
      email_warning: 'mailbox unavailable',
    });

    const accepted = await POST(post({ action: 'accept' }), { params: Promise.resolve({ id: QUOTE_ID }) });
    expect(accepted.status).toBe(200);
    const body = await accepted.json();
    expect(body.created).toBe(true);
    expect(body.email_warning).toBe('mailbox unavailable');
    expect(body.action.quote_reference).toBe('80001-RQ');
    expect(body.action).not.toHaveProperty('subject_line');
    expect(harness.acceptQuoteRams).toHaveBeenCalledWith({
      quoteId: QUOTE_ID,
      actorUserId: USER_ID,
      managerProfileId: null,
    });

    harness.completeQuoteRams.mockRejectedValue(new harness.QuoteRamsActionError({
      message: 'Only the assigned manager or an admin can complete this RAMS action.',
      status: 403,
      code: 'completion_forbidden',
    }));
    const sensitiveCalls = harness.requireSensitiveModuleAccess.mock.calls.length;
    const denied = await POST(post({ action: 'complete', rams_document_id: '66666666-6666-4666-8666-666666666666' }), {
      params: Promise.resolve({ id: QUOTE_ID }),
    });
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({ code: 'completion_forbidden' });
    expect(harness.requireSensitiveModuleAccess).toHaveBeenCalledTimes(sensitiveCalls + 1);
    expect(harness.requireSensitiveModuleAccess).toHaveBeenCalledWith('quotes');
  });

  it('blocks complete and retry before service effects when quotes access or the PIN fails', async () => {
    const { POST } = await import('@/app/api/quotes/[id]/rams-action/route');
    const documentId = '66666666-6666-4666-8666-666666666666';

    harness.requireSensitiveModuleAccess.mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    );
    const deniedComplete = await POST(post({ action: 'complete', rams_document_id: documentId }), {
      params: Promise.resolve({ id: QUOTE_ID }),
    });
    expect(deniedComplete.status).toBe(403);
    expect(harness.completeQuoteRams).not.toHaveBeenCalled();

    const deniedRetry = await POST(post({ action: 'retry-email' }), { params: Promise.resolve({ id: QUOTE_ID }) });
    expect(deniedRetry.status).toBe(403);
    expect(harness.retryQuoteRamsEmail).not.toHaveBeenCalled();

    harness.requireSensitiveModuleAccess.mockResolvedValue(
      NextResponse.json({ error: 'Sensitive access PIN required for protected modules.', code: 'SENSITIVE_PIN_REQUIRED' }, { status: 428 })
    );
    const pinComplete = await POST(post({ action: 'complete', rams_document_id: documentId }), {
      params: Promise.resolve({ id: QUOTE_ID }),
    });
    expect(pinComplete.status).toBe(428);
    await expect(pinComplete.json()).resolves.toMatchObject({ code: 'SENSITIVE_PIN_REQUIRED' });
    const pinRetry = await POST(post({ action: 'retry-email' }), { params: Promise.resolve({ id: QUOTE_ID }) });
    expect(pinRetry.status).toBe(428);
    expect(harness.completeQuoteRams).not.toHaveBeenCalled();
    expect(harness.retryQuoteRamsEmail).not.toHaveBeenCalled();
  });

  it('retries only after the quotes guard succeeds and fails closed when the matrix lookup throws', async () => {
    const { POST } = await import('@/app/api/quotes/[id]/rams-action/route');
    harness.retryQuoteRamsEmail.mockResolvedValue({
      action: { id: 'action', email_status: 'sent' },
      created: false,
      email_warning: null,
    });

    const response = await POST(post({ action: 'retry-email' }), { params: Promise.resolve({ id: QUOTE_ID }) });
    expect(response.status).toBe(200);
    expect(harness.requireSensitiveModuleAccess).toHaveBeenCalledWith('quotes');
    expect(harness.retryQuoteRamsEmail).toHaveBeenCalledWith({
      quoteId: QUOTE_ID,
      actorUserId: USER_ID,
      hasQuotesAccess: true,
    });

    harness.requireSensitiveModuleAccess.mockRejectedValue(new Error('matrix lookup failed'));
    const failed = await POST(post({ action: 'complete', rams_document_id: '66666666-6666-4666-8666-666666666666' }), {
      params: Promise.resolve({ id: QUOTE_ID }),
    });
    expect(failed.status).toBe(500);
    expect(harness.completeQuoteRams).not.toHaveBeenCalled();
    expect(harness.retryQuoteRamsEmail).toHaveBeenCalledTimes(1);
  });
});
