import { NextRequest, NextResponse } from 'next/server';
import { addDays, format, subDays } from 'date-fns';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadQuoteModuleSettings } from '@/lib/server/quote-workflow';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';

function normalizeDate(value: string | null, fallback: Date) {
  if (!value) return format(fallback, 'yyyy-MM-dd');
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return format(fallback, 'yyyy-MM-dd');
  return format(parsed, 'yyyy-MM-dd');
}

function normalizeDuration(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value || 1), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 1;
}

async function requireQuotesAccess() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { supabase, user: null, error: 'You must be signed in to use quotes.' };

  const canAccessQuotes = await canEffectiveRoleAccessModule('quotes');
  if (!canAccessQuotes) return { supabase, user: null, error: 'Quotes access required.' };

  const sensitiveAccessResponse = await requireSensitiveModuleAccess('quotes');
  if (sensitiveAccessResponse) {
    return { supabase, user: null, error: 'Sensitive access PIN required.', response: sensitiveAccessResponse };
  }

  return { supabase, user, error: null };
}

export async function GET(request: NextRequest) {
  try {
    const { supabase, error, response } = await requireQuotesAccess();
    if (response) return response;
    if (error) return NextResponse.json({ error }, { status: error.includes('signed in') ? 401 : 403 });

    const { searchParams } = new URL(request.url);
    const start = normalizeDate(searchParams.get('start'), subDays(new Date(), 30));
    const end = normalizeDate(searchParams.get('end'), addDays(new Date(), 60));
    const quoteStartFloor = format(subDays(new Date(start), 120), 'yyyy-MM-dd');

    const [quotesResult, manualResult] = await Promise.all([
      supabase
        .from('quotes')
        .select(`
          id,
          quote_reference,
          subject_line,
          project_description,
          start_date,
          estimated_duration_days,
          status,
          commercial_status,
          manager_name,
          customer:customers(company_name)
        `)
        .eq('is_latest_version', true)
        .neq('commercial_status', 'closed')
        .not('start_date', 'is', null)
        .gte('start_date', quoteStartFloor)
        .lte('start_date', end)
        .order('start_date', { ascending: true }),
      supabase
        .from('work_calendar_entries')
        .select(`
          *,
          quote:quotes(id, quote_reference, subject_line, customer:customers(company_name))
        `)
        .gte('start_date', quoteStartFloor)
        .lte('start_date', end)
        .order('start_date', { ascending: true }),
    ]);

    if (quotesResult.error) throw quotesResult.error;
    if (manualResult.error) throw manualResult.error;

    return NextResponse.json({
      quotes: quotesResult.data || [],
      manual_entries: manualResult.data || [],
      range: { start, end },
    });
  } catch (error) {
    console.error('Error loading quote work calendar:', error);
    return NextResponse.json({ error: 'Unable to load the work calendar right now.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, user, error, response } = await requireQuotesAccess();
    if (response) return response;
    if (error || !user) return NextResponse.json({ error }, { status: error?.includes('signed in') ? 401 : 403 });

    const body = await request.json();
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const startDate = normalizeDate(typeof body.start_date === 'string' ? body.start_date : null, new Date());
    const moduleSettings = await loadQuoteModuleSettings(createAdminClient());
    const estimatedDurationDays = typeof body.estimated_duration_days === 'undefined'
      ? moduleSettings.default_estimated_duration_days ?? 1
      : normalizeDuration(body.estimated_duration_days);

    if (!title) return NextResponse.json({ error: 'Enter a calendar entry title.' }, { status: 400 });

    const { data, error: insertError } = await supabase
      .from('work_calendar_entries')
      .insert({
        title,
        summary: typeof body.summary === 'string' && body.summary.trim() ? body.summary.trim() : null,
        quote_id: typeof body.quote_id === 'string' && body.quote_id.trim() ? body.quote_id.trim() : null,
        start_date: startDate,
        estimated_duration_days: estimatedDurationDays,
        created_by: user.id,
        updated_by: user.id,
      })
      .select()
      .single();

    if (insertError) throw insertError;
    return NextResponse.json({ entry: data }, { status: 201 });
  } catch (error) {
    console.error('Error creating quote work calendar entry:', error);
    return NextResponse.json({ error: 'Unable to create this calendar entry right now.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { supabase, user, error, response } = await requireQuotesAccess();
    if (response) return response;
    if (error || !user) return NextResponse.json({ error }, { status: error?.includes('signed in') ? 401 : 403 });

    const body = await request.json();
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (!id) return NextResponse.json({ error: 'Calendar entry id is required.' }, { status: 400 });

    const updates = {
      title: typeof body.title === 'string' ? body.title.trim() : undefined,
      summary: typeof body.summary === 'string' && body.summary.trim() ? body.summary.trim() : null,
      quote_id: typeof body.quote_id === 'string' && body.quote_id.trim() ? body.quote_id.trim() : null,
      start_date: typeof body.start_date === 'string' ? normalizeDate(body.start_date, new Date()) : undefined,
      estimated_duration_days: typeof body.estimated_duration_days === 'undefined' ? undefined : normalizeDuration(body.estimated_duration_days),
      updated_by: user.id,
    };

    const { data, error: updateError } = await supabase
      .from('work_calendar_entries')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (updateError) throw updateError;
    return NextResponse.json({ entry: data });
  } catch (error) {
    console.error('Error updating quote work calendar entry:', error);
    return NextResponse.json({ error: 'Unable to update this calendar entry right now.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { supabase, error, response } = await requireQuotesAccess();
    if (response) return response;
    if (error) return NextResponse.json({ error }, { status: error.includes('signed in') ? 401 : 403 });

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Calendar entry id is required.' }, { status: 400 });

    const { error: deleteError } = await supabase
      .from('work_calendar_entries')
      .delete()
      .eq('id', id);

    if (deleteError) throw deleteError;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting quote work calendar entry:', error);
    return NextResponse.json({ error: 'Unable to delete this calendar entry right now.' }, { status: 500 });
  }
}
