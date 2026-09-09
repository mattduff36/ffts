import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  claimQuoteCreate,
  completeQuoteCreateRequest,
  isQuoteCreateRequestReuseError,
  quoteCreateInputHash,
} from '@/lib/server/quote-create-idempotency';

describe('quote create idempotency', () => {
  it('quote-create-idempotent hashes the same payload regardless of request id', () => {
    const first = quoteCreateInputHash({
      request_id: '11111111-1111-4111-8111-111111111111',
      subject_line: 'Fence works',
      required_staff_count: 3,
    });
    const second = quoteCreateInputHash({
      request_id: '22222222-2222-4222-8222-222222222222',
      subject_line: 'Fence works',
      required_staff_count: 3,
      attachment_files: [],
    });
    const changed = quoteCreateInputHash({
      request_id: '11111111-1111-4111-8111-111111111111',
      subject_line: 'Different title',
      required_staff_count: 3,
    });
    expect(first).toBe(second);
    expect(first).not.toBe(changed);
  });

  it('detects reused request ids with a different body', () => {
    expect(isQuoteCreateRequestReuseError(new Error('REQUEST_ID_REUSED'))).toBe(true);
    expect(isQuoteCreateRequestReuseError(new Error('REQUEST_ID_ACTOR_MISMATCH'))).toBe(true);
    expect(isQuoteCreateRequestReuseError(new Error('other'))).toBe(false);
  });

  it('maps a completed claim to replay and a reserved id to create', async () => {
    const replayAdmin = {
      rpc: vi.fn().mockResolvedValue({
        data: [{
          quote_id: 'quote-1',
          reserved_quote_id: 'quote-1',
          replayed: true,
        }],
        error: null,
      }),
    };
    await expect(claimQuoteCreate(replayAdmin as never, {
      requestId: '11111111-1111-4111-8111-111111111111',
      inputHash: 'abc',
      actorUserId: 'user-1',
    })).resolves.toEqual({ kind: 'replay', quoteId: 'quote-1' });

    const reserveAdmin = {
      rpc: vi.fn().mockResolvedValue({
        data: [{
          quote_id: null,
          reserved_quote_id: 'quote-2',
          replayed: false,
        }],
        error: null,
      }),
    };
    await expect(claimQuoteCreate(reserveAdmin as never, {
      requestId: '11111111-1111-4111-8111-111111111111',
      inputHash: 'abc',
      actorUserId: 'user-1',
    })).resolves.toEqual({ kind: 'reserved', quoteId: 'quote-2' });
  });

  it('completes a reserved request with the reserved quote id', async () => {
    const admin = {
      rpc: vi.fn().mockResolvedValue({ error: null }),
    };
    await completeQuoteCreateRequest(admin as never, {
      requestId: '11111111-1111-4111-8111-111111111111',
      quoteId: 'quote-2',
      actorUserId: 'user-1',
    });
    expect(admin.rpc).toHaveBeenCalledWith('quote_create_request_complete_v1', {
      p_request_id: '11111111-1111-4111-8111-111111111111',
      p_quote_id: 'quote-2',
      p_actor_user_id: 'user-1',
    });
  });
});
