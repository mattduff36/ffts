import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { templateConfig } from '@/lib/config/template-config';
import { getTemplateEmailConfig } from '@/lib/config/template-server-config';
import {
  getQuestionOptionLabel,
  questionnaireSections,
  type QuestionnaireAnswerValue,
  type QuestionnaireAnswers,
  type QuestionnaireQuestion,
} from '@/lib/questionnaire/demo-personalisation';
import { sendResendEmail } from '@/lib/server/resend';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Database, Json } from '@/types/database';

export const dynamic = 'force-dynamic';

const ADMIN_RECIPIENT = 'admin@mpdee.co.uk';
const MAX_PAYLOAD_BYTES = 60_000;
const MAX_TEXT_LENGTH = 2_000;

const questionnaireSubmissionSchema = z.object({
  answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  honeypot: z.string().optional(),
});

interface SavedSubmission {
  id: string;
  submission_number: number;
  created_at: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getStringAnswer(answers: QuestionnaireAnswers, questionId: string): string {
  const value = answers[questionId];
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeText(value: string, maxLength = MAX_TEXT_LENGTH): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeLongText(value: string): string {
  return value.trim().slice(0, MAX_TEXT_LENGTH);
}

function validateAndNormalizeAnswers(rawAnswers: Record<string, QuestionnaireAnswerValue>): {
  answers?: QuestionnaireAnswers;
  error?: string;
} {
  const normalizedAnswers: QuestionnaireAnswers = {};

  for (const section of questionnaireSections) {
    for (const question of section.questions) {
      const rawValue = rawAnswers[question.id];

      if (question.type === 'multi_choice') {
        const selected = Array.isArray(rawValue) ? rawValue : [];
        const uniqueSelected = Array.from(new Set(selected.map((value) => normalizeText(value, 120)))).filter(Boolean);
        const validOptionIds = new Set(question.options?.map((option) => option.id) ?? []);
        const invalidOption = uniqueSelected.find((optionId) => !validOptionIds.has(optionId));

        if (question.required && uniqueSelected.length === 0) {
          return { error: `Please answer: ${question.label}` };
        }
        if (invalidOption) {
          return { error: `Invalid answer for: ${question.label}` };
        }
        if (question.maxSelections && uniqueSelected.length > question.maxSelections) {
          return { error: `Please select no more than ${question.maxSelections} options for: ${question.label}` };
        }

        normalizedAnswers[question.id] = uniqueSelected;
        continue;
      }

      if (Array.isArray(rawValue)) {
        return { error: `Invalid answer for: ${question.label}` };
      }

      const normalizedValue =
        question.type === 'long_text'
          ? normalizeLongText(rawValue ?? '')
          : normalizeText(rawValue ?? '', question.type === 'email' ? 320 : 500);

      if (question.required && normalizedValue.length === 0) {
        return { error: `Please answer: ${question.label}` };
      }

      if (question.type === 'email' && normalizedValue.length > 0) {
        const emailCheck = z.string().email().safeParse(normalizedValue);
        if (!emailCheck.success) {
          return { error: `Please enter a valid email address for: ${question.label}` };
        }
      }

      if (question.type === 'single_choice') {
        const validOptionIds = new Set(question.options?.map((option) => option.id) ?? []);
        if (normalizedValue.length > 0 && !validOptionIds.has(normalizedValue)) {
          return { error: `Invalid answer for: ${question.label}` };
        }
      }

      normalizedAnswers[question.id] = normalizedValue;
    }
  }

  return { answers: normalizedAnswers };
}

function formatAnswerValue(question: QuestionnaireQuestion, value: QuestionnaireAnswerValue | undefined): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return 'Not specified';
    return value.map((optionId) => getQuestionOptionLabel(question, optionId)).join(', ');
  }

  if (!value || value.trim().length === 0) return 'Not specified';

  if (question.type === 'single_choice') {
    return getQuestionOptionLabel(question, value);
  }

  return value;
}

function buildSubmissionEmailHtml(submission: SavedSubmission, answers: QuestionnaireAnswers): string {
  const companyName = getStringAnswer(answers, 'company_name') || 'Unknown company';
  const contactName = getStringAnswer(answers, 'contact_name') || 'Unknown contact';
  const contactEmail = getStringAnswer(answers, 'contact_email') || 'Unknown email';
  const contactPhone = getStringAnswer(answers, 'contact_phone') || 'Not specified';
  const submittedAt = new Date(submission.created_at).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const sectionsHtml = questionnaireSections
    .map((section) => {
      const questionsHtml = section.questions
        .map((question) => {
          const answer = formatAnswerValue(question, answers[question.id]);
          return `
            <tr>
              <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; vertical-align: top; width: 38%;">
                <strong>${escapeHtml(question.label)}</strong>
              </td>
              <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; vertical-align: top; white-space: pre-wrap;">
                ${escapeHtml(answer)}
              </td>
            </tr>
          `;
        })
        .join('');

      return `
        <h2 style="margin: 28px 0 10px; color: #111827; font-size: 18px;">${escapeHtml(section.title)}</h2>
        <table style="width: 100%; border-collapse: collapse; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
          ${questionsHtml}
        </table>
      `;
    })
    .join('');

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; background: #f8fafc; color: #111827; font-family: Arial, sans-serif; line-height: 1.5;">
        <div style="max-width: 860px; margin: 0 auto; padding: 24px;">
          <div style="background: ${templateConfig.branding.brandColor}; color: #111827; padding: 24px; border-radius: 14px 14px 0 0;">
            <p style="margin: 0 0 6px; font-size: 12px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase;">Demo questionnaire</p>
            <h1 style="margin: 0; font-size: 26px;">Submission #${submission.submission_number}</h1>
          </div>

          <div style="background: #ffffff; padding: 24px; border: 1px solid #e5e7eb; border-top: 0; border-radius: 0 0 14px 14px;">
            <p style="margin: 0 0 18px; color: #4b5563;">
              A new buyer demo questionnaire has been submitted and saved in Supabase.
            </p>

            <table style="width: 100%; border-collapse: collapse; background: #f9fafb; border: 1px solid #e5e7eb;">
              <tr>
                <td style="padding: 10px 12px; width: 170px;"><strong>Reference ID</strong></td>
                <td style="padding: 10px 12px;">${submission.submission_number}</td>
              </tr>
              <tr>
                <td style="padding: 10px 12px;"><strong>UUID</strong></td>
                <td style="padding: 10px 12px;">${escapeHtml(submission.id)}</td>
              </tr>
              <tr>
                <td style="padding: 10px 12px;"><strong>Company</strong></td>
                <td style="padding: 10px 12px;">${escapeHtml(companyName)}</td>
              </tr>
              <tr>
                <td style="padding: 10px 12px;"><strong>Contact</strong></td>
                <td style="padding: 10px 12px;">${escapeHtml(contactName)}</td>
              </tr>
              <tr>
                <td style="padding: 10px 12px;"><strong>Email</strong></td>
                <td style="padding: 10px 12px;">${escapeHtml(contactEmail)}</td>
              </tr>
              <tr>
                <td style="padding: 10px 12px;"><strong>Phone</strong></td>
                <td style="padding: 10px 12px;">${escapeHtml(contactPhone)}</td>
              </tr>
              <tr>
                <td style="padding: 10px 12px;"><strong>Submitted</strong></td>
                <td style="padding: 10px 12px;">${escapeHtml(submittedAt)}</td>
              </tr>
            </table>

            ${sectionsHtml}
          </div>
        </div>
      </body>
    </html>
  `;
}

async function updateEmailStatus(
  admin: SupabaseClient<Database>,
  submissionId: string,
  values: {
    email_status: 'sent' | 'failed';
    email_sent_at?: string | null;
    email_error?: string | null;
  }
) {
  const { error } = await admin
    .from('questionnaire_submissions')
    .update(values)
    .eq('id', submissionId);

  if (error) {
    console.error('Failed to update questionnaire submission email status:', error);
  }
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get('content-length') || '0');
  if (contentLength > MAX_PAYLOAD_BYTES) {
    return NextResponse.json({ error: 'Questionnaire submission is too large' }, { status: 413 });
  }

  try {
    const body = questionnaireSubmissionSchema.parse(await request.json());

    if (body.honeypot && body.honeypot.trim().length > 0) {
      return NextResponse.json({ success: true, skipped: true });
    }

    const rawPayload = JSON.stringify(body.answers);
    if (rawPayload.length > MAX_PAYLOAD_BYTES) {
      return NextResponse.json({ error: 'Questionnaire submission is too large' }, { status: 413 });
    }

    const { answers, error: validationError } = validateAndNormalizeAnswers(body.answers);
    if (!answers) {
      return NextResponse.json({ error: validationError || 'Invalid questionnaire submission' }, { status: 400 });
    }

    const admin = createAdminClient() as SupabaseClient<Database>;
    const metadata: Record<string, Json> = {
      questionnaire_version: '2026-06-12',
      user_agent: request.headers.get('user-agent') || null,
      forwarded_for: request.headers.get('x-forwarded-for') || null,
      referer: request.headers.get('referer') || null,
    };

    const { data: savedSubmission, error: insertError } = await admin
      .from('questionnaire_submissions')
      .insert({
        company_name: getStringAnswer(answers, 'company_name'),
        contact_name: getStringAnswer(answers, 'contact_name'),
        contact_email: getStringAnswer(answers, 'contact_email'),
        contact_phone: getStringAnswer(answers, 'contact_phone') || null,
        answers: answers as Json,
        metadata,
        email_status: 'pending',
      })
      .select('id, submission_number, created_at')
      .single();

    if (insertError || !savedSubmission) {
      console.error('Failed to save questionnaire submission:', insertError);
      return NextResponse.json({ error: 'Failed to save questionnaire submission' }, { status: 500 });
    }

    const emailConfig = getTemplateEmailConfig();
    const apiKey = emailConfig.primaryApiKey;

    if (!apiKey) {
      await updateEmailStatus(admin, savedSubmission.id, {
        email_status: 'failed',
        email_error: 'RESEND_API_KEY is not configured',
      });

      return NextResponse.json(
        {
          success: false,
          id: savedSubmission.id,
          submissionNumber: savedSubmission.submission_number,
          error: 'Questionnaire saved, but email service is not configured',
        },
        { status: 500 }
      );
    }

    const companyName = getStringAnswer(answers, 'company_name') || 'Unknown company';
    const emailResponse = await sendResendEmail({
      apiKey,
      payload: {
        from: emailConfig.primaryFromEmail,
        to: [ADMIN_RECIPIENT],
        subject: `New demo questionnaire submission #${savedSubmission.submission_number} - ${companyName}`,
        html: buildSubmissionEmailHtml(savedSubmission, answers),
      },
    });

    if (!emailResponse.ok) {
      const errorText = await emailResponse.text();
      await updateEmailStatus(admin, savedSubmission.id, {
        email_status: 'failed',
        email_error: errorText.slice(0, 2_000),
      });

      return NextResponse.json(
        {
          success: false,
          id: savedSubmission.id,
          submissionNumber: savedSubmission.submission_number,
          error: 'Questionnaire saved, but the email could not be sent',
        },
        { status: 502 }
      );
    }

    await updateEmailStatus(admin, savedSubmission.id, {
      email_status: 'sent',
      email_sent_at: new Date().toISOString(),
      email_error: null,
    });

    return NextResponse.json({
      success: true,
      id: savedSubmission.id,
      submissionNumber: savedSubmission.submission_number,
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid questionnaire submission' }, { status: 400 });
    }

    console.error('Questionnaire submission failed:', error);
    return NextResponse.json({ error: 'Failed to submit questionnaire' }, { status: 500 });
  }
}
