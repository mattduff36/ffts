import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockFetchQuoteBundle,
  mockAppendQuoteTimelineEvent,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockFetchQuoteBundle: vi.fn(),
  mockAppendQuoteTimelineEvent: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock('@/lib/server/sensitive-module-access', () => ({
  requireSensitiveModuleAccess: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/server/quote-workflow', () => ({
  appendQuoteTimelineEvent: mockAppendQuoteTimelineEvent,
  fetchQuoteBundle: mockFetchQuoteBundle,
}));

describe('/api/quotes/[id]/attachments/[attachmentId]', () => {
  const attachment = {
    id: 'attachment-1',
    quote_id: 'quote-1',
    file_name: 'pricing sheet.pdf',
    file_path: 'quote-1/pricing-sheet.pdf',
    content_type: 'text/plain',
    file_size: 11,
    uploaded_by: 'user-1',
    created_at: '2026-05-02T08:00:00.000Z',
    is_client_visible: true,
    attachment_purpose: 'client_pricing',
  };

  const userClientAuth = {
    getUser: vi.fn().mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchQuoteBundle.mockResolvedValue({
      quote: {
        id: 'quote-1',
        is_latest_version: true,
        quote_thread_id: 'thread-1',
        quote_reference: 'Q-001',
      },
    });
    mockAppendQuoteTimelineEvent.mockResolvedValue(undefined);
  });

  it('opens an authenticated attachment inline', async () => {
    const { GET } = await import('@/app/api/quotes/[id]/attachments/[attachmentId]/route');
    const single = vi.fn().mockResolvedValue({ data: attachment, error: null });
    const secondEq = vi.fn(() => ({ single }));
    const firstEq = vi.fn(() => ({ eq: secondEq }));
    const download = vi.fn().mockResolvedValue({
      data: new Blob(['hello world'], { type: 'text/plain' }),
      error: null,
    });

    mockCreateClient.mockResolvedValue({
      auth: userClientAuth,
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq: firstEq })),
      })),
    });
    mockCreateAdminClient.mockReturnValue({
      storage: {
        from: vi.fn(() => ({ download })),
      },
    });

    const request = new NextRequest('http://localhost/api/quotes/quote-1/attachments/attachment-1');
    const response = await GET(request, {
      params: Promise.resolve({ id: 'quote-1', attachmentId: 'attachment-1' }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/plain');
    expect(response.headers.get('Content-Disposition')).toBe('inline; filename="pricing sheet.pdf"');
    expect(await response.text()).toBe('hello world');
    expect(download).toHaveBeenCalledWith('quote-1/pricing-sheet.pdf');
  });

  it('removes attachments from storage and timeline when deleting', async () => {
    const { DELETE } = await import('@/app/api/quotes/[id]/attachments/[attachmentId]/route');
    const single = vi.fn().mockResolvedValue({ data: attachment, error: null });
    const selectSecondEq = vi.fn(() => ({ single }));
    const selectFirstEq = vi.fn(() => ({ eq: selectSecondEq }));
    const deleteSecondEq = vi.fn().mockResolvedValue({ error: null });
    const deleteFirstEq = vi.fn(() => ({ eq: deleteSecondEq }));
    const remove = vi.fn().mockResolvedValue({ data: null, error: null });

    mockCreateClient.mockResolvedValue({
      auth: userClientAuth,
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq: selectFirstEq })),
        delete: vi.fn(() => ({ eq: deleteFirstEq })),
      })),
      storage: {
        from: vi.fn(() => ({ remove })),
      },
    });
    mockCreateAdminClient.mockReturnValue({});

    const request = new NextRequest('http://localhost/api/quotes/quote-1/attachments/attachment-1');
    const response = await DELETE(request, {
      params: Promise.resolve({ id: 'quote-1', attachmentId: 'attachment-1' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(remove).toHaveBeenCalledWith(['quote-1/pricing-sheet.pdf']);
    expect(mockAppendQuoteTimelineEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: 'attachment_removed',
      description: 'pricing sheet.pdf',
    }));
  });
});
