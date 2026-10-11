import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getEffectiveModuleAccessLevel } from '@/lib/utils/rbac';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';
import { listQuoteRamsActions } from '@/lib/server/quote-rams-actions';
import type { QuoteRamsActionStatus } from '@/types/quote-rams';

function privateJson(body: unknown, init: ResponseInit = {}) {
  return NextResponse.json(body, { ...init, headers: { ...init.headers, 'Cache-Control': 'private, no-store' } });
}

export const runtime = 'nodejs';

const STATUSES = new Set<QuoteRamsActionStatus>(['open', 'completed', 'cancelled']);

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return privateJson({ error: 'You must be signed in to use quotes.' }, { status: 401 });
    }

    const statusParam = request.nextUrl.searchParams.get('status') || 'open';
    if (statusParam !== 'all' && !STATUSES.has(statusParam as QuoteRamsActionStatus)) {
      return privateJson({ error: 'Choose a valid RAMS action status.', code: 'invalid_status' }, { status: 400 });
    }

    const sensitiveAccessResponse = await requireSensitiveModuleAccess('actions');
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const actionsLevel = await getEffectiveModuleAccessLevel('actions');
    if (actionsLevel === 0) return privateJson({ error: 'Forbidden' }, { status: 403 });
    const actions = await listQuoteRamsActions({
      userId: user.id,
      listAll: actionsLevel >= 4,
      status: statusParam === 'all' ? null : statusParam as QuoteRamsActionStatus,
    });
    return privateJson({ actions });
  } catch {
    console.error('Error listing quote RAMS actions');
    return privateJson({ error: 'Unable to load RAMS actions right now.' }, { status: 500 });
  }
}
