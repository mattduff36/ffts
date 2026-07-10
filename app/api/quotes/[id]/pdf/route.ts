import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { renderToStream } from '@react-pdf/renderer';
import { QuotePDF } from '@/lib/pdf/quote-pdf';
import { loadTemplateLogoDataUrl } from '@/lib/pdf/template-logo';
import { logServerError } from '@/lib/utils/server-error-logger';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';
import { buildQuotePdfContentDisposition } from '@/lib/quotes/quote-display-name';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'You must be signed in to use quotes.' }, { status: 401 });
    }

    const sensitiveAccessResponse = await requireSensitiveModuleAccess('quotes');
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    // Fetch quote
    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .select(`
        *,
        customer:customers(company_name)
      `)
      .eq('id', id)
      .single();

    if (quoteError) {
      if (quoteError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Quote not found.' }, { status: 404 });
      }
      throw quoteError;
    }

    // Fetch line items
    const { data: lineItems } = await supabase
      .from('quote_line_items')
      .select('*')
      .eq('quote_id', id)
      .order('sort_order', { ascending: true });

    const logoSrc = await loadTemplateLogoDataUrl();

    const pdfDocument = QuotePDF({
      quoteReference: quote.quote_reference,
      baseQuoteReference: quote.base_quote_reference || quote.quote_reference,
      quoteDate: quote.quote_date,
      attentionName: quote.attention_name || '',
      attentionEmail: quote.attention_email || '',
      salutation: quote.salutation || '',
      projectDescription: quote.project_description || '',
      subjectLine: quote.subject_line || '',
      scope: quote.scope || '',
      siteAddress: quote.site_address || '',
      managerEmail: quote.manager_email || '',
      lineItems: (lineItems || []).map((li: { description: string; quantity: number; unit: string | null; unit_rate: number; line_total: number }) => ({
        description: li.description,
        quantity: Number(li.quantity),
        unit: li.unit,
        unit_rate: Number(li.unit_rate),
        line_total: Number(li.line_total),
      })),
      total: Number(quote.total),
      pricingMode: quote.pricing_mode || 'itemized',
      validityDays: quote.validity_days || 30,
      signoffName: quote.signoff_name || '',
      signoffTitle: quote.signoff_title || '',
      versionLabel: quote.version_label || undefined,
      customFooterText: quote.custom_footer_text || undefined,
      logoSrc,
    });

    const stream = await renderToStream(pdfDocument);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const pdfBytes = new Uint8Array(Buffer.concat(chunks));

    const contentDisposition = buildQuotePdfContentDisposition(quote);

    return new NextResponse(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': contentDisposition,
      },
    });
  } catch (error) {
    const { id } = await params;
    console.error('Error generating quote PDF:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/quotes/[id]/pdf',
      additionalData: { endpoint: `GET /api/quotes/${id}/pdf` },
    });

    return NextResponse.json({ error: 'Unable to generate the quote PDF right now.' }, { status: 500 });
  }
}
