import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';
import { getQuoteOverviewDetail } from '@/lib/server/quotes-overview';

interface RouteParams {
  params: Promise<{ reference: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { reference } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'You must be signed in to use quotes.' }, { status: 401 });
    }

    const sensitiveAccessResponse = await requireSensitiveModuleAccess('quotes');
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const admin = createAdminClient();
    const payload = await getQuoteOverviewDetail(admin, reference);
    if (!payload) {
      return NextResponse.json({ error: 'Quote or job number not found.' }, { status: 404 });
    }

    return NextResponse.json(payload);
  } catch (error) {
    console.error('Error fetching quote overview detail:', error);
    return NextResponse.json({ error: 'Unable to load quote overview detail right now.' }, { status: 500 });
  }
}
