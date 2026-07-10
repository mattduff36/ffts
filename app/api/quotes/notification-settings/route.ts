import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  type QuoteInvoiceNotificationType,
  getSelectedQuoteInvoiceNotificationRecipientIds,
  listQuoteAdditionalNotificationRecipientOptions,
  listQuoteAccountsNotificationRecipientOptions,
  replaceQuoteNotificationRecipients,
} from '@/lib/server/quote-workflow';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';
import { isEffectiveRoleAdminOrSuper } from '@/lib/utils/rbac';

const INVOICE_NOTIFICATION_TYPES: QuoteInvoiceNotificationType[] = ['invoice_request', 'invoice_added'];

async function requireQuoteSettingsContext() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      response: NextResponse.json({ error: 'You must be signed in to use quote settings.' }, { status: 401 }),
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
    const context = await requireQuoteSettingsContext();
    if (context.response) return context.response;

    const admin = createAdminClient();
    const [accountsRecipients, additionalRecipients, selectedNotifications] = await Promise.all([
      listQuoteAccountsNotificationRecipientOptions(admin),
      listQuoteAdditionalNotificationRecipientOptions(admin),
      context.canManage
        ? getSelectedQuoteInvoiceNotificationRecipientIds(admin)
        : {
          invoice_request: [],
          invoice_added: [],
        },
    ]);
    const accountsIds = new Set(accountsRecipients.map(recipient => recipient.id));
    const additionalIds = new Set(additionalRecipients.map(recipient => recipient.id));
    const selectedByType = selectedNotifications as Record<QuoteInvoiceNotificationType, string[]>;

    return NextResponse.json({
      can_manage: context.canManage,
      accounts_recipients: accountsRecipients,
      additional_recipients: additionalRecipients,
      eligible_recipients: accountsRecipients,
      selected_recipient_ids: selectedByType.invoice_request.filter(id => accountsIds.has(id)),
      selected_notifications: {
        invoice_request: selectedByType.invoice_request.filter(id => accountsIds.has(id) || additionalIds.has(id)),
        invoice_added: selectedByType.invoice_added.filter(id => additionalIds.has(id)),
      },
    });
  } catch (error) {
    console.error('Error fetching quote notification settings:', error);
    return NextResponse.json({ error: 'Unable to load quote notification settings right now.' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const context = await requireQuoteSettingsContext();
    if (context.response) return context.response;
    if (!context.canManage || !context.userId) {
      return NextResponse.json({ error: 'Only admins can manage quote notification settings.' }, { status: 403 });
    }

    const body = await request.json() as {
      recipient_ids?: unknown;
      selected_notifications?: Partial<Record<QuoteInvoiceNotificationType, unknown>>;
    };
    const legacyRecipientIds = Array.isArray(body.recipient_ids)
      ? Array.from(new Set(body.recipient_ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0).map(id => id.trim())))
      : [];
    const selectedNotifications = INVOICE_NOTIFICATION_TYPES.reduce<Partial<Record<QuoteInvoiceNotificationType, string[]>>>((acc, type) => {
      const rawIds = body.selected_notifications?.[type];
      if (Array.isArray(rawIds)) {
        acc[type] = Array.from(new Set(rawIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0).map(id => id.trim())));
      }
      return acc;
    }, {
      invoice_request: legacyRecipientIds,
      invoice_added: [],
    });

    const admin = createAdminClient();
    const [accountsRecipients, additionalRecipients] = await Promise.all([
      listQuoteAccountsNotificationRecipientOptions(admin),
      listQuoteAdditionalNotificationRecipientOptions(admin),
    ]);
    const accountsIds = new Set(accountsRecipients.map(recipient => recipient.id));
    const additionalIds = new Set(additionalRecipients.map(recipient => recipient.id));

    const selectedAccountsRecipientIds = (selectedNotifications.invoice_request || []).filter(id => accountsIds.has(id));
    if (selectedAccountsRecipientIds.length === 0) {
      return NextResponse.json({ error: 'Select at least one Accounts recipient.' }, { status: 400 });
    }

    const invoiceRequestEligibleIds = new Set([...accountsIds, ...additionalIds]);
    const invalidInvoiceRequestIds = (selectedNotifications.invoice_request || []).filter(id => !invoiceRequestEligibleIds.has(id));
    const invalidInvoiceAddedIds = (selectedNotifications.invoice_added || []).filter(id => !additionalIds.has(id));

    if (invalidInvoiceRequestIds.length > 0 || invalidInvoiceAddedIds.length > 0) {
      return NextResponse.json(
        { error: 'Selected recipients must be users with Quotes access in the correct notification section.' },
        { status: 400 }
      );
    }

    await replaceQuoteNotificationRecipients(admin, {
      invoice_request: selectedNotifications.invoice_request || [],
      invoice_added: selectedNotifications.invoice_added || [],
    }, context.userId);

    return NextResponse.json({
      can_manage: true,
      accounts_recipients: accountsRecipients,
      additional_recipients: additionalRecipients,
      eligible_recipients: accountsRecipients,
      selected_recipient_ids: selectedAccountsRecipientIds,
      selected_notifications: selectedNotifications,
    });
  } catch (error) {
    console.error('Error saving quote notification settings:', error);
    return NextResponse.json({ error: 'Unable to save quote notification settings right now.' }, { status: 500 });
  }
}
