import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';
import { getQuotesOverview } from '@/lib/server/quotes-overview';

function normalizeDateParam(value: string | null): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'You must be signed in to use quotes.' }, { status: 401 });
    }

    const sensitiveAccessResponse = await requireSensitiveModuleAccess('quotes');
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const { searchParams } = new URL(request.url);
    const admin = createAdminClient();
    const payload = await getQuotesOverview(admin, {
      search: searchParams.get('search'),
      dateFrom: normalizeDateParam(searchParams.get('date_from')),
      dateTo: normalizeDateParam(searchParams.get('date_to')),
    });

    return NextResponse.json(payload);
  } catch (error) {
    console.error('Error fetching quotes overview:', error);
    return NextResponse.json({ error: 'Unable to load quotes overview right now.' }, { status: 500 });
  }
}
