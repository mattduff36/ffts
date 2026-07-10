import { NextRequest, NextResponse } from 'next/server';
import { generateText, Output } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';

const MAX_EMAIL_LENGTH = 8000;

const quoteAssistRequestSchema = z.object({
  customerEmail: z.string()
    .trim()
    .min(20, 'Paste the customer email before generating a draft.')
    .max(MAX_EMAIL_LENGTH, 'The customer email is too long. Please trim it to the key quote details.'),
  customerName: z.string().trim().max(160).optional(),
  siteAddress: z.string().trim().max(1000).optional(),
  existingTitle: z.string().trim().max(240).optional(),
  existingSummary: z.string().trim().max(2000).optional(),
  existingScope: z.string().trim().max(4000).optional(),
});

const quoteAssistOutputSchema = z.object({
  subject_line: z.string()
    .trim()
    .min(1)
    .max(160)
    .describe('A concise customer-facing quote title.'),
  project_description: z.string()
    .trim()
    .min(1)
    .max(1200)
    .describe('A short customer-facing quote summary.'),
  scope: z.string()
    .trim()
    .min(1)
    .max(2500)
    .describe('Scope of works as plain text bullets, one bullet per line.'),
  caveats: z.array(z.string().trim().min(1).max(220))
    .max(6)
    .describe('Assumptions or details the user should check before sending.'),
});

function getOptionalContext(label: string, value?: string) {
  const trimmed = value?.trim();
  return trimmed ? `${label}: ${trimmed}` : null;
}

function buildPrompt(input: z.infer<typeof quoteAssistRequestSchema>) {
  return [
    'Create draft quote content from the customer email below.',
    '',
    'Context:',
    getOptionalContext('Customer', input.customerName),
    getOptionalContext('Site address', input.siteAddress),
    getOptionalContext('Existing title', input.existingTitle),
    getOptionalContext('Existing summary', input.existingSummary),
    getOptionalContext('Existing scope', input.existingScope),
    '',
    'Customer email:',
    input.customerEmail,
  ].filter(Boolean).join('\n');
}

function getConfig() {
  return {
    provider: process.env.QUOTE_AI_PROVIDER?.trim().toLowerCase() || 'openai',
    model: process.env.QUOTE_AI_MODEL?.trim() || 'gpt-4.1-nano',
    apiKey: (process.env.QUOTE_OPENAI_API_KEY || process.env.OPENAI_API_KEY)?.trim(),
  };
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'You must be signed in to use quote assist.' }, { status: 401 });
    }

    const sensitiveAccessResponse = await requireSensitiveModuleAccess('quotes');
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const body = await request.json().catch(() => null);
    const parsed = quoteAssistRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({
        error: parsed.error.issues[0]?.message || 'Enter the customer email before generating a draft.',
      }, { status: 400 });
    }

    const config = getConfig();
    if (config.provider !== 'openai') {
      return NextResponse.json({ error: 'Quote AI assist is not configured for the selected provider.' }, { status: 503 });
    }

    if (!config.apiKey) {
      return NextResponse.json({ error: 'Quote AI assist is not configured yet.' }, { status: 503 });
    }

    const quoteOpenAI = createOpenAI({
      apiKey: config.apiKey,
      baseURL: 'https://api.openai.com/v1',
    });

    const result = await generateText({
      model: quoteOpenAI(config.model),
      system: [
        'You help UK contractors draft quote wording from customer emails.',
        'Return professional, concise, customer-facing wording.',
        'Do not invent prices, exact dates, permits, guarantees, approvals, or confirmations that are not in the email.',
        'Keep uncertainty explicit, such as "locations to be confirmed" where the email is not final.',
        'The scope must be practical plain-text bullet lines starting with "- ".',
        'If the email is unclear, still provide a useful draft and put points to check in caveats.',
      ].join(' '),
      prompt: buildPrompt(parsed.data),
      output: Output.object({
        schema: quoteAssistOutputSchema,
      }),
    });

    return NextResponse.json(result.output);
  } catch (error) {
    console.error('Quote assist failed', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Unable to generate quote draft right now.' }, { status: 500 });
  }
}
