import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';
import {
  QuoteRamsActionError,
  acceptQuoteRams,
  completeQuoteRams,
  getQuoteRamsContext,
  reassignQuoteRams,
  retryQuoteRamsEmail,
} from '@/lib/server/quote-rams-actions';
import type { QuoteRamsErrorBody, QuoteRamsMutationName } from '@/types/quote-rams';

function privateJson(body: unknown, init: ResponseInit = {}) {
  return NextResponse.json(body, { ...init, headers: { ...init.headers, 'Cache-Control': 'private, no-store' } });
}

export const runtime = 'nodejs';

interface RouteParams {
  params: Promise<{ id: string }>;
}

const MUTATIONS = new Set<QuoteRamsMutationName>(['accept', 'reassign', 'complete', 'retry-email']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorResponse(error: QuoteRamsActionError) {
  const body: QuoteRamsErrorBody = { error: error.message, code: error.code };
  if (error.fieldErrors) body.field_errors = error.fieldErrors;
  if (error.eligibleManagers) body.eligible_managers = error.eligibleManagers;
  return privateJson(body, { status: error.status });
}

async function requireUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    if (!UUID.test(id)) return privateJson({ error: 'Invalid quote ID.' }, { status: 400 });
    const user = await requireUser();
    if (!user) {
      return privateJson({ error: 'You must be signed in to use quotes.' }, { status: 401 });
    }
    const sensitiveAccessResponse = await requireSensitiveModuleAccess('quotes');
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const context = await getQuoteRamsContext(id);
    return privateJson(context);
  } catch (error) {
    if (error instanceof QuoteRamsActionError) return errorResponse(error);
    console.error('Error loading quote RAMS action');
    return privateJson({ error: 'Unable to load the RAMS action right now.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    if (!UUID.test(id)) return privateJson({ error: 'Invalid quote ID.' }, { status: 400 });
    const user = await requireUser();
    if (!user) {
      return privateJson({ error: 'You must be signed in to use quotes.' }, { status: 401 });
    }

    const body = await request.json().catch(() => null) as {
      action?: unknown;
      manager_profile_id?: unknown;
      rams_document_id?: unknown;
      confirmation_note?: unknown;
    } | null;
    const action = body?.action;
    if (typeof action !== 'string' || !MUTATIONS.has(action as QuoteRamsMutationName)) {
      return privateJson({ error: 'Choose a RAMS action.', code: 'invalid_action' }, { status: 400 });
    }

    const managerProfileId = typeof body?.manager_profile_id === 'string' ? body.manager_profile_id : null;
    const ramsDocumentId = typeof body?.rams_document_id === 'string' ? body.rams_document_id : null;
    const confirmationNote = typeof body?.confirmation_note === 'string' ? body.confirmation_note : null;
    if ((managerProfileId && !UUID.test(managerProfileId)) || (ramsDocumentId && !UUID.test(ramsDocumentId))) {
      return privateJson({ error: 'Choose a valid manager or document.' }, { status: 400 });
    }
    if (confirmationNote && confirmationNote.length > 4000) return privateJson({ error: 'Confirmation notes must be 4,000 characters or fewer.' }, { status: 400 });

    const sensitiveAccessResponse = await requireSensitiveModuleAccess('quotes');
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    if (action === 'accept') {
      const result = await acceptQuoteRams({ quoteId: id, actorUserId: user.id, managerProfileId });
      return privateJson(result);
    }
    if (action === 'reassign') {
      const result = await reassignQuoteRams({ quoteId: id, actorUserId: user.id, managerProfileId });
      return privateJson(result);
    }
    if (action === 'complete') {
      const result = await completeQuoteRams({
        quoteId: id,
        actorUserId: user.id,
        ramsDocumentId,
        confirmationNote,
      });
      return privateJson(result);
    }

    const result = await retryQuoteRamsEmail({
      quoteId: id,
      actorUserId: user.id,
      hasQuotesAccess: true,
    });
    return privateJson(result);
  } catch (error) {
    if (error instanceof QuoteRamsActionError) return errorResponse(error);
    console.error('Error updating quote RAMS action');
    return privateJson({ error: 'Unable to update the RAMS action right now.' }, { status: 500 });
  }
}
