import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';
import { hasEffectiveRoleFullAccess } from '@/lib/utils/role-access';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { logServerError } from '@/lib/utils/server-error-logger';

interface LegacyQuotePatchBody {
  id?: unknown;
  quote_reference?: unknown;
  customer_name?: unknown;
  title?: unknown;
  quote_date?: unknown;
  quote_manager_name?: unknown;
  quote_value_text?: unknown;
  comments?: unknown;
}

function normalizeEditableText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function normalizeOptionalEditableText(value: unknown): string | null {
  const normalized = normalizeEditableText(value);
  return normalized ? normalized : null;
}

function normalizeQuoteReference(value: unknown): string | null {
  const normalized = normalizeEditableText(value).toUpperCase();
  return normalized ? normalized : null;
}

function getNumberFromStandardCode(value: string | null): number | null {
  const match = value?.match(/^(\d{4,5})-[A-Z]{2}$/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function getInitialsFromStandardCode(value: string | null): string | null {
  const match = value?.match(/^\d{4,5}-([A-Z]{2})$/);
  return match?.[1] || null;
}

function getInitialsFromManagerName(value: string): string | null {
  const initials = value
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .join('')
    .toUpperCase();

  return initials || null;
}

function normalizeLegacyQuoteDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error('Enter the legacy quote date in YYYY-MM-DD format.');
  }

  const date = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    throw new Error('Enter a valid legacy quote date.');
  }

  return normalized;
}

function parseLegacyQuoteValueAmount(value: string | null): number | null {
  if (!value) return null;
  const cleaned = value.replace(/£|,/g, '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'You must be signed in to view legacy quotes.' }, { status: 401 });
    }

    const sensitiveAccessResponse = await requireSensitiveModuleAccess('quotes');
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') || '100', 10) || 100, 1), 250);
    const offset = Math.max(Number.parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    const { data, error } = await supabase
      .from('legacy_quotes')
      .select(`
        id,
        source_row,
        quote_reference,
        customer_name,
        title,
        quote_date,
        quote_date_raw,
        quote_manager_name,
        quote_manager_initials,
        quote_value_text,
        quote_value_amount,
        comments,
        created_at,
        updated_at
      `)
      .order('quote_date', { ascending: false, nullsFirst: false })
      .order('source_row', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const legacyQuotes = data || [];

    return NextResponse.json({
      legacy_quotes: legacyQuotes,
      pagination: {
        offset,
        limit,
        has_more: legacyQuotes.length === limit,
      },
    });
  } catch (error) {
    console.error('Error fetching legacy quotes:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/quotes/legacy',
      additionalData: { endpoint: 'GET /api/quotes/legacy' },
    });

    return NextResponse.json({ error: 'Unable to load legacy quotes right now.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'You must be signed in to edit legacy quotes.' }, { status: 401 });
    }

    const sensitiveAccessResponse = await requireSensitiveModuleAccess('quotes');
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const effectiveRole = await getEffectiveRole();
    if (!hasEffectiveRoleFullAccess(effectiveRole)) {
      return NextResponse.json({ error: 'Only admins can edit legacy quotes.' }, { status: 403 });
    }

    const body = await request.json() as LegacyQuotePatchBody;
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (!id) {
      return NextResponse.json({ error: 'Legacy quote id is required.' }, { status: 400 });
    }

    const quoteReference = normalizeQuoteReference(body.quote_reference);
    const customerName = normalizeEditableText(body.customer_name);
    const title = normalizeEditableText(body.title);
    const quoteManagerName = normalizeEditableText(body.quote_manager_name);
    const quoteValueText = normalizeOptionalEditableText(body.quote_value_text);

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('legacy_quotes')
      .update({
        quote_reference: quoteReference,
        quote_number: getNumberFromStandardCode(quoteReference),
        quote_suffix: getInitialsFromStandardCode(quoteReference),
        customer_name: customerName,
        title,
        quote_date: normalizeLegacyQuoteDate(body.quote_date),
        quote_manager_name: quoteManagerName,
        quote_manager_initials: getInitialsFromManagerName(quoteManagerName),
        quote_value_text: quoteValueText,
        quote_value_amount: parseLegacyQuoteValueAmount(quoteValueText),
        comments: normalizeOptionalEditableText(body.comments),
      })
      .eq('id', id)
      .select(`
        id,
        source_row,
        quote_reference,
        customer_name,
        title,
        quote_date,
        quote_date_raw,
        quote_manager_name,
        quote_manager_initials,
        quote_value_text,
        quote_value_amount,
        comments,
        created_at,
        updated_at
      `)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: 'Legacy quote not found.' }, { status: 404 });
    }

    return NextResponse.json({ legacy_quote: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update legacy quote right now.';
    const isValidationError = /legacy quote date|valid legacy quote date/i.test(message);

    if (!isValidationError) {
      console.error('Error updating legacy quote:', error);

      await logServerError({
        error: error as Error,
        request,
        componentName: '/api/quotes/legacy',
        additionalData: { endpoint: 'PATCH /api/quotes/legacy' },
      });
    }

    return NextResponse.json(
      { error: isValidationError ? message : 'Unable to update legacy quote right now.' },
      { status: isValidationError ? 400 : 500 }
    );
  }
}
