import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { isManagerOrAdmin } from '@/lib/utils/permissions';
import { callerIsQuoteAdmin, listQuoteRamsActions } from '@/lib/server/quote-rams-actions';
import type { QuoteRamsActionStatus } from '@/types/quote-rams';

function privateJson(body: unknown, init: ResponseInit = {}) {
  return NextResponse.json(body, { ...init, headers: { ...init.headers, 'Cache-Control': 'private, no-store' } });
}

export const runtime = 'nodejs';

const STATUSES = new Set<QuoteRamsActionStatus>(['open', 'completed', 'cancelled']);

async function canListAllQuoteRamsActions(userId: string): Promise<boolean> {
  const [actionsAccess, managerOrAdmin, quoteAdmin] = await Promise.all([
    canEffectiveRoleAccessModule('actions'),
    isManagerOrAdmin(userId),
    callerIsQuoteAdmin(userId),
  ]);
  return actionsAccess && (managerOrAdmin || quoteAdmin);
}

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

    const actions = await listQuoteRamsActions({
      userId: user.id,
      listAll: await canListAllQuoteRamsActions(user.id),
      status: statusParam === 'all' ? null : statusParam as QuoteRamsActionStatus,
    });
    return privateJson({ actions });
  } catch {
    console.error('Error listing quote RAMS actions');
    return privateJson({ error: 'Unable to load RAMS actions right now.' }, { status: 500 });
  }
}
