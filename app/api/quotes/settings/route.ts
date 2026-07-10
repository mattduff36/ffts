import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  QUOTE_INVOICE_NOTIFICATION_TYPES,
  type QuoteInvoiceNotificationType,
  getSelectedQuoteInvoiceNotificationRecipientIds,
  listQuoteUserNotificationRecipientOptions,
  loadQuoteModuleSettings,
  replaceQuoteNotificationRecipients,
  upsertQuoteModuleSettings,
} from '@/lib/server/quote-workflow';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';
import { isEffectiveRoleAdminOrSuper } from '@/lib/utils/rbac';

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

function normalizeNullableInteger(value: unknown): number | null {
  if (value === '' || value === null || typeof value === 'undefined') {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

function normalizeNotificationSelections(value: unknown) {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const rawSelections = value as Partial<Record<QuoteInvoiceNotificationType, unknown>>;
  return QUOTE_INVOICE_NOTIFICATION_TYPES.reduce<Partial<Record<QuoteInvoiceNotificationType, string[]>>>((acc, type) => {
    const rawIds = rawSelections[type];
    if (Array.isArray(rawIds)) {
      acc[type] = Array.from(new Set(rawIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0).map(id => id.trim())));
    }
    return acc;
  }, {});
}

function buildEmptyQuoteNotificationSelections(): Record<QuoteInvoiceNotificationType, string[]> {
  return QUOTE_INVOICE_NOTIFICATION_TYPES.reduce<Record<QuoteInvoiceNotificationType, string[]>>((acc, type) => {
    acc[type] = [];
    return acc;
  }, {} as Record<QuoteInvoiceNotificationType, string[]>);
}

async function applyDefaultsToEmptyOpenQuotes(
  admin: ReturnType<typeof createAdminClient>,
  settings: {
    default_start_alert_days: number | null;
    default_estimated_duration_days: number | null;
  },
  userId: string
) {
  if (settings.default_start_alert_days !== null) {
    const { error } = await admin
      .from('quotes')
      .update({
        start_alert_days: settings.default_start_alert_days,
        updated_by: userId,
      })
      .eq('is_latest_version', true)
      .eq('commercial_status', 'open')
      .is('start_alert_days', null);

    if (error) throw error;
  }

  if (settings.default_estimated_duration_days !== null) {
    const { error } = await admin
      .from('quotes')
      .update({
        estimated_duration_days: settings.default_estimated_duration_days,
        updated_by: userId,
      })
      .eq('is_latest_version', true)
      .eq('commercial_status', 'open')
      .is('estimated_duration_days', null);

    if (error) throw error;
  }
}

export async function GET() {
  try {
    const context = await requireQuoteSettingsContext();
    if (context.response) return context.response;

    const admin = createAdminClient();
    const [settings, quoteUsers, selectedNotifications] = await Promise.all([
      loadQuoteModuleSettings(admin),
      listQuoteUserNotificationRecipientOptions(admin),
      context.canManage
        ? getSelectedQuoteInvoiceNotificationRecipientIds(admin)
        : buildEmptyQuoteNotificationSelections(),
    ]);
    const quoteUserIds = new Set(quoteUsers.map(user => user.id));
    const selectedByType = selectedNotifications as Record<QuoteInvoiceNotificationType, string[]>;

    return NextResponse.json({
      can_manage: context.canManage,
      settings,
      quote_users: quoteUsers,
      selected_notifications: QUOTE_INVOICE_NOTIFICATION_TYPES.reduce<Record<QuoteInvoiceNotificationType, string[]>>((acc, type) => {
        acc[type] = (selectedByType[type] || []).filter(id => quoteUserIds.has(id));
        return acc;
      }, buildEmptyQuoteNotificationSelections()),
    });
  } catch (error) {
    console.error('Error fetching quote module settings:', error);
    return NextResponse.json({ error: 'Unable to load quote settings right now.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const context = await requireQuoteSettingsContext();
    if (context.response) return context.response;
    if (!context.canManage || !context.userId) {
      return NextResponse.json({ error: 'Only admins can manage quote settings.' }, { status: 403 });
    }

    const body = await request.json() as {
      settings?: {
        default_start_alert_days?: unknown;
        default_estimated_duration_days?: unknown;
      };
      selected_notifications?: unknown;
      apply_empty_defaults?: unknown;
    };
    const admin = createAdminClient();

    const currentSettings = await loadQuoteModuleSettings(admin);
    const nextSettings = {
      default_start_alert_days: Object.prototype.hasOwnProperty.call(body.settings || {}, 'default_start_alert_days')
        ? normalizeNullableInteger(body.settings?.default_start_alert_days)
        : currentSettings.default_start_alert_days,
      default_estimated_duration_days: Object.prototype.hasOwnProperty.call(body.settings || {}, 'default_estimated_duration_days')
        ? normalizeNullableInteger(body.settings?.default_estimated_duration_days)
        : currentSettings.default_estimated_duration_days,
    };

    if (
      Number.isNaN(nextSettings.default_start_alert_days)
      || Number.isNaN(nextSettings.default_estimated_duration_days)
      || (nextSettings.default_start_alert_days !== null && (nextSettings.default_start_alert_days < 0 || nextSettings.default_start_alert_days > 365))
      || (nextSettings.default_estimated_duration_days !== null && (nextSettings.default_estimated_duration_days < 0 || nextSettings.default_estimated_duration_days > 365))
    ) {
      return NextResponse.json({ error: 'Default days must be whole numbers from 0 to 365.' }, { status: 400 });
    }

    const selectedNotifications = normalizeNotificationSelections(body.selected_notifications);
    if (Object.keys(selectedNotifications).length > 0) {
      const quoteUsers = await listQuoteUserNotificationRecipientOptions(admin);
      const quoteUserIds = new Set(quoteUsers.map(user => user.id));
      const invalidIds = Object.values(selectedNotifications)
        .flat()
        .filter(id => !quoteUserIds.has(id));

      if (invalidIds.length > 0) {
        return NextResponse.json({ error: 'Selected recipients must be users with Quotes access.' }, { status: 400 });
      }

      await replaceQuoteNotificationRecipients(admin, selectedNotifications, context.userId);
    }

    const settings = await upsertQuoteModuleSettings(admin, nextSettings, context.userId);
    if (body.apply_empty_defaults === true) {
      await applyDefaultsToEmptyOpenQuotes(admin, settings, context.userId);
    }

    const [quoteUsers, selectedByType] = await Promise.all([
      listQuoteUserNotificationRecipientOptions(admin),
      getSelectedQuoteInvoiceNotificationRecipientIds(admin),
    ]);
    const quoteUserIds = new Set(quoteUsers.map(user => user.id));
    const selected = selectedByType as Record<QuoteInvoiceNotificationType, string[]>;

    return NextResponse.json({
      can_manage: true,
      settings,
      quote_users: quoteUsers,
      selected_notifications: QUOTE_INVOICE_NOTIFICATION_TYPES.reduce<Record<QuoteInvoiceNotificationType, string[]>>((acc, type) => {
        acc[type] = (selected[type] || []).filter(id => quoteUserIds.has(id));
        return acc;
      }, buildEmptyQuoteNotificationSelections()),
    });
  } catch (error) {
    console.error('Error saving quote module settings:', error);
    return NextResponse.json({ error: 'Unable to save quote settings right now.' }, { status: 500 });
  }
}
