/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQuoteWithAttachments } from '@/app/(dashboard)/quotes/quote-creation-client';

const mockUpload = vi.hoisted(() => vi.fn());

vi.mock('@/app/(dashboard)/quotes/quote-attachment-client', () => ({
  uploadQuoteAttachment: mockUpload,
}));

describe('createQuoteWithAttachments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ quote: { id: 'quote-1', quote_reference: 'Q-1' } }),
    })));
    mockUpload.mockResolvedValue({});
  });

  it('creates the Quote before uploading every selected client attachment', async () => {
    const files = [
      new File(['one'], 'one.pdf', { type: 'application/pdf' }),
      new File(['two'], 'two.pdf', { type: 'application/pdf' }),
    ];
    await createQuoteWithAttachments({
      attachment_files: files,
    } as never);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mockUpload).toHaveBeenCalledTimes(2);
    expect(mockUpload).toHaveBeenCalledWith(expect.objectContaining({
      quoteId: 'quote-1',
      isClientVisible: true,
      attachmentPurpose: 'client_pricing',
    }));
  });
});
