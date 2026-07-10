import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';
import { isEffectiveRoleAdminOrSuper } from '@/lib/utils/rbac';
import {
  isQuoteEmailTemplateKey,
  loadQuoteEmailTemplates,
  resetQuoteEmailTemplate,
  saveQuoteEmailTemplate,
} from '@/lib/server/quote-email-templates';

async function requireQuoteTemplateSettingsContext() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      response: NextResponse.json({ error: 'You must be signed in to use quote email templates.' }, { status: 401 }),
      userId: null,
      canManage: false,
    };
  }

  const sensitiveAccessResponse = await requireSensitiveModuleAccess('quotes');
  if (sensitiveAccessResponse) {
    return { response: sensitiveAccessResponse, userId: user.id, canManage: false };
  }

  const canManage = await isEffectiveRoleAdminOrSuper();
  return { response: null, userId: user.id, canManage };
}

export async function GET() {
  try {
    const context = await requireQuoteTemplateSettingsContext();
    if (context.response) return context.response;

    const templates = await loadQuoteEmailTemplates(createAdminClient());
    return NextResponse.json({
      can_manage: context.canManage,
      templates,
    });
  } catch (error) {
    console.error('Error fetching quote email templates:', error);
    return NextResponse.json({ error: 'Unable to load quote email templates right now.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const context = await requireQuoteTemplateSettingsContext();
    if (context.response) return context.response;
    if (!context.canManage || !context.userId) {
      return NextResponse.json({ error: 'Only admins can manage quote email templates.' }, { status: 403 });
    }

    const body = await request.json() as {
      template_key?: unknown;
      subject_template?: unknown;
      body_template?: unknown;
      reset_to_default?: unknown;
    };

    if (!isQuoteEmailTemplateKey(body.template_key)) {
      return NextResponse.json({ error: 'Select a valid quote email template.' }, { status: 400 });
    }

    const admin = createAdminClient();
    const result = body.reset_to_default === true
      ? await resetQuoteEmailTemplate(admin, body.template_key, context.userId)
      : await saveQuoteEmailTemplate(
        admin,
        {
          template_key: body.template_key,
          subject_template: typeof body.subject_template === 'string' ? body.subject_template : '',
          body_template: typeof body.body_template === 'string' ? body.body_template : '',
        },
        context.userId
      );

    if (result.errors.length > 0) {
      return NextResponse.json({ error: result.errors.join(' '), field_errors: result.errors }, { status: 400 });
    }

    return NextResponse.json({
      can_manage: true,
      templates: await loadQuoteEmailTemplates(admin),
    });
  } catch (error) {
    console.error('Error saving quote email template:', error);
    return NextResponse.json({ error: 'Unable to save quote email template right now.' }, { status: 500 });
  }
}
