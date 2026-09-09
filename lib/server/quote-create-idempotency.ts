import 'server-only';

import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export function quoteCreateInputHash(payload: Record<string, unknown>): string {
  const normalized = JSON.stringify(stableValue(payload));
  return createHash('sha256').update(normalized).digest('hex');
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== 'request_id' && key !== 'attachment_files')
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)])
    );
  }
  return value;
}

export function isQuoteCreateRequestReuseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return (
    message.includes('REQUEST_ID_REUSED')
    || message.includes('REQUEST_ID_ACTOR_MISMATCH')
    || message.includes('REQUEST_ID_MISSING')
  );
}

export type QuoteCreateClaim =
  | { kind: 'replay'; quoteId: string }
  | { kind: 'reserved'; quoteId: string };

export async function claimQuoteCreate(
  admin: SupabaseClient,
  input: {
    requestId: string;
    inputHash: string;
    actorUserId: string;
  }
): Promise<QuoteCreateClaim> {
  const { data, error } = await admin.rpc('quote_create_request_claim_v1', {
    p_request_id: input.requestId,
    p_input_hash: input.inputHash,
    p_actor_user_id: input.actorUserId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  const reserved = typeof row?.reserved_quote_id === 'string' ? row.reserved_quote_id : null;
  const completed = typeof row?.quote_id === 'string' ? row.quote_id : null;
  if (row?.replayed === true && completed) {
    return { kind: 'replay', quoteId: completed };
  }
  if (!reserved) {
    throw new Error('Quote create claim did not reserve an id.');
  }
  return { kind: 'reserved', quoteId: reserved };
}

export async function completeQuoteCreateRequest(
  admin: SupabaseClient,
  input: {
    requestId: string;
    quoteId: string;
    actorUserId: string;
  }
): Promise<void> {
  const { error } = await admin.rpc('quote_create_request_complete_v1', {
    p_request_id: input.requestId,
    p_quote_id: input.quoteId,
    p_actor_user_id: input.actorUserId,
  });
  if (error) throw error;
}
