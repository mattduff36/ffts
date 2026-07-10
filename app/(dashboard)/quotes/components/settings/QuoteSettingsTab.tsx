'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Bell, CalendarClock, Loader2, Mail, Plus, Save, Send, Trash2, UserCog, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PanelLoader } from '@/components/ui/panel-loader';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Quote, QuoteManagerOption } from '../../types';

export type QuoteSettingsSubTab = 'notifications' | 'managers' | 'sending' | 'schedule' | 'templates' | 'admin-tools';

type QuoteNotificationType =
  | 'invoice_request'
  | 'invoice_added'
  | 'quote_sent_copy'
  | 'start_alert_copy'
  | 'quote_customer_email_copy'
  | 'quote_po_request_copy'
  | 'quote_rams_request_copy'
  | 'quote_start_alert_copy'
  | 'quote_invoice_request_copy'
  | 'quote_invoice_added_copy';

interface QuoteUserOption {
  id: string;
  full_name: string | null;
  employee_id: string | null;
  team_id: string | null;
  team_name: string | null;
}

interface ApproverOption {
  id: string;
  full_name: string | null;
  email: string | null;
}

interface QuoteModuleSettings {
  default_start_alert_days: number | null;
  default_estimated_duration_days: number | null;
}

interface QuoteSettingsPayload {
  can_manage: boolean;
  settings: QuoteModuleSettings;
  quote_users: QuoteUserOption[];
  selected_notifications: Record<QuoteNotificationType, string[]>;
}

interface QuoteManagerSettingsPayload {
  can_manage: boolean;
  manager_options: QuoteManagerOption[];
  quote_users: QuoteUserOption[];
  approvers: ApproverOption[];
}

interface QuoteEmailTemplate {
  template_key: string;
  label: string;
  description: string;
  placeholders: string[];
  sample_context: Record<string, string>;
  default_subject_template: string;
  default_body_template: string;
  subject_template: string;
  body_template: string;
  updated_by: string | null;
  updated_at: string | null;
}

interface QuoteEmailTemplatesPayload {
  can_manage: boolean;
  templates: QuoteEmailTemplate[];
}

interface QuoteSettingsTabProps {
  activeTab: QuoteSettingsSubTab;
  onTabChange: (tab: QuoteSettingsSubTab) => void;
  quotes: Quote[];
  onDeleteQuote: (quote: Quote) => Promise<void>;
  onRefresh: () => Promise<void>;
}

const SETTINGS_TABS: Array<{ value: QuoteSettingsSubTab; label: string; icon: typeof Bell }> = [
  { value: 'notifications', label: 'Notifications', icon: Bell },
  { value: 'managers', label: 'Managers', icon: UserCog },
  { value: 'sending', label: 'Emails', icon: Send },
  { value: 'schedule', label: 'Schedule', icon: CalendarClock },
  { value: 'templates', label: 'Templates', icon: Mail },
  { value: 'admin-tools', label: 'Admin Tools', icon: Wrench },
];

const EMPTY_SELECTED_NOTIFICATIONS: Record<QuoteNotificationType, string[]> = {
  invoice_request: [],
  invoice_added: [],
  quote_sent_copy: [],
  start_alert_copy: [],
  quote_customer_email_copy: [],
  quote_po_request_copy: [],
  quote_rams_request_copy: [],
  quote_start_alert_copy: [],
  quote_invoice_request_copy: [],
  quote_invoice_added_copy: [],
};

const EMAIL_CC_COLUMNS: Array<{ value: QuoteNotificationType; label: string; description: string }> = [
  {
    value: 'quote_customer_email_copy',
    label: 'Customer Quote',
    description: 'Quote emails sent to customers.',
  },
  {
    value: 'quote_po_request_copy',
    label: 'PO Request',
    description: 'Purchase order request emails.',
  },
  {
    value: 'quote_rams_request_copy',
    label: 'RAMS Request',
    description: 'RAMS request emails.',
  },
  {
    value: 'quote_start_alert_copy',
    label: 'Start Alert',
    description: 'Job start reminder emails.',
  },
  {
    value: 'quote_invoice_request_copy',
    label: 'Invoice Request',
    description: 'Ready-to-invoice request emails.',
  },
  {
    value: 'quote_invoice_added_copy',
    label: 'Invoice Added',
    description: 'Invoice details added emails.',
  },
];

async function buildResponseError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  return new Error(payload?.error || fallback);
}

function getInitialsFromLabel(label: string) {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map(part => part[0]?.toUpperCase() || '')
    .join('');
}

function formatUserMetaValue(value: string | null | undefined) {
  const normalized = value?.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;

  return normalized
    .split(' ')
    .map(word => word ? `${word[0].toUpperCase()}${word.slice(1)}` : '')
    .join(' ');
}

function getUserTeamLabel(user: QuoteUserOption) {
  return user.team_name || formatUserMetaValue(user.team_id) || 'Unassigned';
}

function normalizeManagerRows(rows: QuoteManagerOption[]) {
  return rows.map(row => ({
    ...row,
    initials: row.initials || '',
    number_start: Number(row.number_start || 0),
    next_number: Number(row.next_number || 0),
    signoff_name: row.signoff_name || '',
    signoff_title: row.signoff_title || '',
    manager_email: row.manager_email || '',
    approver_profile_id: row.approver_profile_id || '',
    is_active: row.is_active !== false,
  }));
}

export function QuoteSettingsTab({
  activeTab,
  onTabChange,
  quotes,
  onDeleteQuote,
  onRefresh,
}: QuoteSettingsTabProps) {
  const [settingsPayload, setSettingsPayload] = useState<QuoteSettingsPayload | null>(null);
  const [managerPayload, setManagerPayload] = useState<QuoteManagerSettingsPayload | null>(null);
  const [templatesPayload, setTemplatesPayload] = useState<QuoteEmailTemplatesPayload | null>(null);
  const [selectedNotifications, setSelectedNotifications] = useState<Record<QuoteNotificationType, string[]>>(EMPTY_SELECTED_NOTIFICATIONS);
  const [moduleSettings, setModuleSettings] = useState<QuoteModuleSettings>({
    default_start_alert_days: null,
    default_estimated_duration_days: null,
  });
  const [managerRows, setManagerRows] = useState<ReturnType<typeof normalizeManagerRows>>([]);
  const [templateRows, setTemplateRows] = useState<QuoteEmailTemplate[]>([]);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState('');
  const [newManagerProfileId, setNewManagerProfileId] = useState('');
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [loadingManagers, setLoadingManagers] = useState(true);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [deleteQuoteId, setDeleteQuoteId] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const deletableQuotes = useMemo(
    () => [...quotes]
      .filter(quote => quote.is_latest_version && quote.status === 'draft')
      .sort((a, b) => a.quote_reference.localeCompare(b.quote_reference)),
    [quotes]
  );
  const selectedDeleteQuote = deletableQuotes.find(quote => quote.id === deleteQuoteId) || null;
  const quoteUsers = useMemo(() => settingsPayload?.quote_users || [], [settingsPayload]);
  const accountsUsers = quoteUsers.filter(user => user.team_id === 'accounts');
  const additionalUsers = quoteUsers.filter(user => user.team_id !== 'accounts');
  const managerProfileIds = new Set(managerRows.map(row => row.profile_id));
  const availableManagerUsers = (managerPayload?.quote_users || []).filter(user => !managerProfileIds.has(user.id));
  const selectedTemplate = templateRows.find(template => template.template_key === selectedTemplateKey) || templateRows[0] || null;
  const emailMatrixUsers = useMemo(
    () => [...quoteUsers].sort((a, b) => {
      const teamA = a.team_id ? getUserTeamLabel(a) : 'ZZZ Unassigned';
      const teamB = b.team_id ? getUserTeamLabel(b) : 'ZZZ Unassigned';
      const byTeam = teamA.localeCompare(teamB);
      if (byTeam !== 0) return byTeam;

      return (a.full_name || '').localeCompare(b.full_name || '');
    }),
    [quoteUsers]
  );

  useEffect(() => {
    void loadQuoteSettings();
    void loadManagerSettings();
    void loadEmailTemplates();
  }, []);

  async function loadQuoteSettings() {
    setLoadingSettings(true);
    try {
      const res = await fetch('/api/quotes/settings', { cache: 'no-store' });
      if (!res.ok) throw await buildResponseError(res, 'Unable to load quote settings.');
      const payload = await res.json() as QuoteSettingsPayload;
      setSettingsPayload(payload);
      setModuleSettings(payload.settings);
      setSelectedNotifications({
        ...EMPTY_SELECTED_NOTIFICATIONS,
        ...payload.selected_notifications,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to load quote settings.');
    } finally {
      setLoadingSettings(false);
    }
  }

  async function loadManagerSettings() {
    setLoadingManagers(true);
    try {
      const res = await fetch('/api/quotes/settings/manager-series', { cache: 'no-store' });
      if (!res.ok) throw await buildResponseError(res, 'Unable to load quote manager settings.');
      const payload = await res.json() as QuoteManagerSettingsPayload;
      setManagerPayload(payload);
      setManagerRows(normalizeManagerRows(payload.manager_options));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to load quote manager settings.');
    } finally {
      setLoadingManagers(false);
    }
  }

  async function loadEmailTemplates() {
    setLoadingTemplates(true);
    try {
      const res = await fetch('/api/quotes/settings/email-templates', { cache: 'no-store' });
      if (!res.ok) throw await buildResponseError(res, 'Unable to load quote email templates.');
      const payload = await res.json() as QuoteEmailTemplatesPayload;
      setTemplatesPayload(payload);
      setTemplateRows(payload.templates || []);
      setSelectedTemplateKey(current => current || payload.templates?.[0]?.template_key || '');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to load quote email templates.');
    } finally {
      setLoadingTemplates(false);
    }
  }

  function toggleNotification(notificationType: QuoteNotificationType, profileId: string, checked: boolean) {
    setSelectedNotifications(current => {
      const currentIds = current[notificationType] || [];
      return {
        ...current,
        [notificationType]: checked
          ? currentIds.includes(profileId) ? currentIds : [...currentIds, profileId]
          : currentIds.filter(id => id !== profileId),
      };
    });
  }

  async function saveInvoiceNotifications() {
    setSaving('notifications');
    try {
      const res = await fetch('/api/quotes/notification-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selected_notifications: {
            invoice_request: selectedNotifications.invoice_request,
            invoice_added: selectedNotifications.invoice_added,
          },
        }),
      });
      if (!res.ok) throw await buildResponseError(res, 'Unable to save notification details.');
      await loadQuoteSettings();
      toast.success('Notification details saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save notification details.');
    } finally {
      setSaving(null);
    }
  }

  async function saveModuleSettings(options: {
    settings?: Partial<QuoteModuleSettings>;
    selected_notifications?: Partial<Record<QuoteNotificationType, string[]>>;
    apply_empty_defaults?: boolean;
    successMessage: string;
    savingKey: string;
  }) {
    setSaving(options.savingKey);
    try {
      const res = await fetch('/api/quotes/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: options.settings,
          selected_notifications: options.selected_notifications,
          apply_empty_defaults: options.apply_empty_defaults,
        }),
      });
      if (!res.ok) throw await buildResponseError(res, 'Unable to save quote settings.');
      const payload = await res.json() as QuoteSettingsPayload;
      setSettingsPayload(payload);
      setModuleSettings(payload.settings);
      setSelectedNotifications({
        ...EMPTY_SELECTED_NOTIFICATIONS,
        ...payload.selected_notifications,
      });
      toast.success(options.successMessage);
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save quote settings.');
    } finally {
      setSaving(null);
    }
  }

  function updateManagerRow(profileId: string, patch: Partial<(typeof managerRows)[number]>) {
    setManagerRows(current => current.map(row => row.profile_id === profileId ? { ...row, ...patch } : row));
  }

  async function saveManagerRow(row: (typeof managerRows)[number]) {
    setSaving(`manager-${row.profile_id}`);
    try {
      const res = await fetch('/api/quotes/settings/manager-series', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(row),
      });
      if (!res.ok) throw await buildResponseError(res, 'Unable to save manager defaults.');
      const payload = await res.json() as QuoteManagerSettingsPayload;
      setManagerPayload(payload);
      setManagerRows(normalizeManagerRows(payload.manager_options));
      toast.success('Manager defaults saved');
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save manager defaults.');
    } finally {
      setSaving(null);
    }
  }

  async function addManagerRow() {
    const user = availableManagerUsers.find(item => item.id === newManagerProfileId);
    if (!user) return;
    const name = user.full_name || 'New Manager';
    const row = {
      profile_id: user.id,
      initials: getInitialsFromLabel(name),
      next_number: 1,
      number_start: 1,
      signoff_name: name,
      signoff_title: '',
      manager_email: '',
      approver_profile_id: '',
      is_active: true,
      profile: { id: user.id, full_name: user.full_name, email: null },
      approver: null,
    };
    setManagerRows(current => [...current, row]);
    setNewManagerProfileId('');
  }

  async function deleteManagerRow(profileId: string) {
    setSaving(`manager-delete-${profileId}`);
    try {
      const res = await fetch(`/api/quotes/settings/manager-series?profile_id=${encodeURIComponent(profileId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw await buildResponseError(res, 'Unable to remove manager defaults.');
      const payload = await res.json() as QuoteManagerSettingsPayload;
      setManagerPayload(payload);
      setManagerRows(normalizeManagerRows(payload.manager_options));
      toast.success('Manager defaults removed');
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to remove manager defaults.');
    } finally {
      setSaving(null);
    }
  }

  async function confirmDeleteQuote() {
    if (!selectedDeleteQuote) return;
    setSaving('delete-quote');
    try {
      await onDeleteQuote(selectedDeleteQuote);
      setDeleteDialogOpen(false);
      setDeleteQuoteId('');
    } finally {
      setSaving(null);
    }
  }

  function updateTemplateRow(templateKey: string, patch: Partial<QuoteEmailTemplate>) {
    setTemplateRows(current => current.map(template => (
      template.template_key === templateKey ? { ...template, ...patch } : template
    )));
  }

  async function saveTemplateRow(template: QuoteEmailTemplate) {
    setSaving(`template-${template.template_key}`);
    try {
      const res = await fetch('/api/quotes/settings/email-templates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_key: template.template_key,
          subject_template: template.subject_template,
          body_template: template.body_template,
        }),
      });
      if (!res.ok) throw await buildResponseError(res, 'Unable to save quote email template.');
      const payload = await res.json() as QuoteEmailTemplatesPayload;
      setTemplatesPayload(payload);
      setTemplateRows(payload.templates || []);
      toast.success('Quote email template saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save quote email template.');
    } finally {
      setSaving(null);
    }
  }

  async function resetTemplateRow(template: QuoteEmailTemplate) {
    setSaving(`template-reset-${template.template_key}`);
    try {
      const res = await fetch('/api/quotes/settings/email-templates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_key: template.template_key,
          reset_to_default: true,
        }),
      });
      if (!res.ok) throw await buildResponseError(res, 'Unable to reset quote email template.');
      const payload = await res.json() as QuoteEmailTemplatesPayload;
      setTemplatesPayload(payload);
      setTemplateRows(payload.templates || []);
      toast.success('Quote email template reset');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to reset quote email template.');
    } finally {
      setSaving(null);
    }
  }

  function renderTemplatePreview(value: string, context: Record<string, string>) {
    return value.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key: string) => context[key] || '');
  }

  function renderUserCheckboxGrid(notificationType: QuoteNotificationType, users: QuoteUserOption[], emptyText: string) {
    if (users.length === 0) {
      return <p className="text-sm text-muted-foreground">{emptyText}</p>;
    }

    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {users.map(user => (
          <label
            key={user.id}
            className="flex items-start gap-3 rounded-md border border-slate-700 bg-slate-800/40 p-3 text-sm"
          >
            <input
              type="checkbox"
              className="mt-1"
              checked={selectedNotifications[notificationType].includes(user.id)}
              disabled={!settingsPayload?.can_manage || Boolean(saving)}
              onChange={event => toggleNotification(notificationType, user.id, event.target.checked)}
            />
            <span>
              <span className="block font-medium text-slate-100">{user.full_name || 'Unnamed user'}</span>
            </span>
          </label>
        ))}
      </div>
    );
  }

  function renderNotificationsPanel() {
    if (loadingSettings) {
      return <LoadingPanel label="Loading notification settings..." />;
    }

    return (
      <Card className="border-slate-700 bg-slate-900/70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <Bell className="h-5 w-5 text-brand-yellow" />
            Notification Details
          </CardTitle>
          <CardDescription>
            Choose who receives quote invoice notifications. The quote manager is still notified automatically when Accounts add invoice details.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!settingsPayload?.can_manage ? (
            <div className="rounded-md border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-muted-foreground">
              Only admins can manage quote notification details.
            </div>
          ) : null}

          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Accounts</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Accounts users receive ready-to-invoice notifications so they can create the invoice and add the details.
              </p>
            </div>
            {renderUserCheckboxGrid('invoice_request', accountsUsers, 'No Accounts team users with Quotes access are available.')}
          </section>

          <section className="space-y-3 border-t border-slate-700/70 pt-4">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Additional users</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Other users with Quotes access can be copied into selected quote invoice notifications.
              </p>
            </div>

            {additionalUsers.length > 0 ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {additionalUsers.map(user => (
                  <div key={user.id} className="rounded-md border border-slate-700 bg-slate-800/40 p-3 text-sm">
                    <div className="font-medium text-slate-100">{user.full_name || 'Unnamed user'}</div>
                    <div className="mt-3 flex flex-wrap gap-3">
                      {([
                        ['invoice_request', 'Ready to invoice'],
                        ['invoice_added', 'Invoice details added'],
                      ] as const).map(([type, label]) => (
                        <label key={type} className="inline-flex items-center gap-2 text-xs text-slate-300">
                          <input
                            type="checkbox"
                            checked={selectedNotifications[type].includes(user.id)}
                            disabled={!settingsPayload?.can_manage || Boolean(saving)}
                            onChange={event => toggleNotification(type, user.id, event.target.checked)}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No additional users with Quotes access are available.</p>
            )}
          </section>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Quote email audit copies are sent to the address configured for this deployment.
            </p>

            <div className="flex justify-end">
              <Button
                onClick={() => void saveInvoiceNotifications()}
                disabled={!settingsPayload?.can_manage || Boolean(saving) || accountsUsers.length === 0}
                className="bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90"
              >
                {saving === 'notifications' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save notification details
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  function renderManagersPanel() {
    if (loadingManagers) {
      return <LoadingPanel label="Loading manager defaults..." />;
    }

    return (
      <Card className="border-slate-700 bg-slate-900/70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <UserCog className="h-5 w-5 text-brand-yellow" />
            Manager Defaults
          </CardTitle>
          <CardDescription>
            Configure quote numbering, approvers, and sign-off defaults for each quote manager.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 rounded-lg border border-border p-4 md:flex-row md:items-end">
            <div className="flex-1 space-y-2">
              <Label>Add manager</Label>
              <Select value={newManagerProfileId} onValueChange={setNewManagerProfileId} disabled={!managerPayload?.can_manage}>
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                  <SelectValue placeholder={availableManagerUsers.length ? 'Select a Quotes user' : 'No available Quotes users'} />
                </SelectTrigger>
                <SelectContent>
                  {availableManagerUsers.map(user => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.full_name || 'Unnamed user'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="button" variant="outline" disabled={!newManagerProfileId} onClick={() => void addManagerRow()}>
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </div>

          {managerRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No manager defaults are configured yet.</p>
          ) : (
            <div className="space-y-3">
              {managerRows.map(row => (
                <div key={row.profile_id} className="rounded-lg border border-slate-700 bg-slate-800/40 p-4">
                  <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h3 className="font-semibold text-white">{row.profile?.full_name || row.signoff_name || 'Unnamed manager'}</h3>
                      <p className="text-xs text-muted-foreground">Profile ID: {row.profile_id}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Label className="text-xs text-muted-foreground">Active</Label>
                      <Switch
                        checked={row.is_active}
                        disabled={!managerPayload?.can_manage || Boolean(saving)}
                        onCheckedChange={checked => updateManagerRow(row.profile_id, { is_active: checked })}
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                    <Field label="Initials">
                      <Input value={row.initials} onChange={event => updateManagerRow(row.profile_id, { initials: event.target.value.toUpperCase() })} />
                    </Field>
                    <Field label="Number start">
                      <Input type="number" value={row.number_start} onChange={event => updateManagerRow(row.profile_id, { number_start: Number(event.target.value) })} />
                    </Field>
                    <Field label="Next number">
                      <Input type="number" value={row.next_number} onChange={event => updateManagerRow(row.profile_id, { next_number: Number(event.target.value) })} />
                    </Field>
                    <Field label="Manager email (from user account)">
                      <Input value={row.manager_email || ''} readOnly className="bg-slate-900/60 text-muted-foreground" />
                    </Field>
                    <Field label="Sign-off name">
                      <Input value={row.signoff_name || ''} onChange={event => updateManagerRow(row.profile_id, { signoff_name: event.target.value })} />
                    </Field>
                    <Field label="Sign-off title">
                      <Input value={row.signoff_title || ''} onChange={event => updateManagerRow(row.profile_id, { signoff_title: event.target.value })} />
                    </Field>
                    <div className="space-y-2 md:col-span-2">
                      <Label>Default approver</Label>
                      <Select
                        value={row.approver_profile_id || 'none'}
                        onValueChange={value => updateManagerRow(row.profile_id, { approver_profile_id: value === 'none' ? '' : value })}
                      >
                        <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                          <SelectValue placeholder="Select approver" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No default approver</SelectItem>
                          {(managerPayload?.approvers || []).map(approver => (
                            <SelectItem key={approver.id} value={approver.id}>
                              {approver.full_name || 'Unnamed user'}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={Boolean(saving)}
                      onClick={() => void deleteManagerRow(row.profile_id)}
                      className="text-red-300 hover:bg-red-500/10 hover:text-red-200"
                    >
                      <Trash2 className="h-4 w-4" />
                      Remove
                    </Button>
                    <Button
                      type="button"
                      disabled={!managerPayload?.can_manage || Boolean(saving)}
                      onClick={() => void saveManagerRow(row)}
                      className="bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90"
                    >
                      {saving === `manager-${row.profile_id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Save manager
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  function renderSendingPanel() {
    if (loadingSettings) return <LoadingPanel label="Loading email settings..." />;
    const emailCcSelections = EMAIL_CC_COLUMNS.reduce<Partial<Record<QuoteNotificationType, string[]>>>((acc, column) => {
      acc[column.value] = selectedNotifications[column.value] || [];
      return acc;
    }, {});

    return (
      <Card className="border-slate-700 bg-slate-900/70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <Send className="h-5 w-5 text-brand-yellow" />
            Email CC Recipients
          </CardTitle>
          <CardDescription>
            Choose exactly which quote-module emails each user is CC&apos;d into.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {quoteUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No users with Quotes access are available.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-700">
              <table className="min-w-[900px] w-full border-collapse text-sm">
                <thead className="bg-slate-950/70">
                  <tr>
                    <th className="sticky left-0 z-10 min-w-56 border-b border-slate-700 bg-slate-950/95 px-4 py-3 text-left font-semibold text-white">
                      User
                    </th>
                    {EMAIL_CC_COLUMNS.map(column => (
                      <th key={column.value} className="min-w-32 border-b border-slate-700 px-3 py-3 text-center align-top">
                        <span className="block font-semibold text-white">{column.label}</span>
                        <span className="mt-1 block text-xs font-normal leading-snug text-muted-foreground">
                          {column.description}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {emailMatrixUsers.map((user, index) => {
                    const currentTeamKey = user.team_id || 'unassigned';
                    const previousTeamKey = index > 0 ? (emailMatrixUsers[index - 1]?.team_id || 'unassigned') : null;
                    const startsNewTeam = index === 0 || currentTeamKey !== previousTeamKey;
                    const teamLabel = getUserTeamLabel(user);

                    return (
                      <Fragment key={user.id}>
                        {startsNewTeam ? (
                          <tr className="border-t border-slate-600 bg-slate-950/40">
                            <td colSpan={EMAIL_CC_COLUMNS.length + 1} className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                              {teamLabel}
                            </td>
                          </tr>
                        ) : null}
                        <tr className="border-t border-slate-800 odd:bg-slate-900/30 even:bg-slate-900/10">
                          <th className="sticky left-0 z-10 border-r border-slate-800 bg-slate-900/95 px-4 py-3 text-left font-medium text-white">
                            {user.full_name || 'Unnamed user'}
                          </th>
                          {EMAIL_CC_COLUMNS.map(column => {
                            const isChecked = (selectedNotifications[column.value] || []).includes(user.id);
                            const label = `${user.full_name || 'Unnamed user'}: ${column.label}`;

                            return (
                              <td key={`${user.id}-${column.value}`} className="px-3 py-3 text-center">
                                <input
                                  type="checkbox"
                                  aria-label={label}
                                  checked={isChecked}
                                  disabled={!settingsPayload?.can_manage || Boolean(saving)}
                                  onChange={event => toggleNotification(column.value, user.id, event.target.checked)}
                                  className="h-4 w-4 rounded border-slate-500 bg-slate-950 text-brand-yellow accent-brand-yellow"
                                />
                              </td>
                            );
                          })}
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex justify-end">
            <Button
              disabled={!settingsPayload?.can_manage || Boolean(saving)}
              onClick={() => void saveModuleSettings({
                selected_notifications: emailCcSelections,
                successMessage: 'Quote email settings saved',
                savingKey: 'sending',
              })}
              className="bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90"
            >
              {saving === 'sending' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save email settings
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  function renderSchedulePanel() {
    if (loadingSettings) return <LoadingPanel label="Loading schedule settings..." />;

    return (
      <Card className="border-slate-700 bg-slate-900/70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <CalendarClock className="h-5 w-5 text-brand-yellow" />
            Schedule & Calendar Defaults
          </CardTitle>
          <CardDescription>
            Defaults apply to new quotes and existing open latest quotes where the matching field is blank.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Default start alert days">
              <Input
                type="number"
                min={0}
                max={365}
                value={moduleSettings.default_start_alert_days ?? ''}
                onChange={event => setModuleSettings(current => ({
                  ...current,
                  default_start_alert_days: event.target.value === '' ? null : Number(event.target.value),
                }))}
                placeholder="No default"
              />
            </Field>
            <Field label="Default estimated duration days">
              <Input
                type="number"
                min={0}
                max={365}
                value={moduleSettings.default_estimated_duration_days ?? ''}
                onChange={event => setModuleSettings(current => ({
                  ...current,
                  default_estimated_duration_days: event.target.value === '' ? null : Number(event.target.value),
                }))}
                placeholder="No default"
              />
            </Field>
          </div>

          <section className="space-y-3 border-t border-slate-700/70 pt-4">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Start alert copy recipients</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                These users receive a copy when the scheduled job start alert runs.
              </p>
            </div>
            {renderUserCheckboxGrid('start_alert_copy', quoteUsers, 'No users with Quotes access are available.')}
          </section>

          <div className="flex justify-end">
            <Button
              disabled={!settingsPayload?.can_manage || Boolean(saving)}
              onClick={() => void saveModuleSettings({
                settings: moduleSettings,
                selected_notifications: { start_alert_copy: selectedNotifications.start_alert_copy },
                apply_empty_defaults: true,
                successMessage: 'Schedule settings saved',
                savingKey: 'schedule',
              })}
              className="bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90"
            >
              {saving === 'schedule' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save schedule settings
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  function renderTemplatesPanel() {
    if (loadingTemplates) return <LoadingPanel label="Loading email templates..." />;

    return (
      <Card className="border-slate-700 bg-slate-900/70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <Mail className="h-5 w-5 text-brand-yellow" />
            Email Templates
          </CardTitle>
          <CardDescription>
            Edit quote email and notification wording. Layout, recipients, attachments, and workflow rules are controlled by the app.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!templatesPayload?.can_manage ? (
            <div className="rounded-md border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-muted-foreground">
              Only admins can manage quote email templates.
            </div>
          ) : null}

          {templateRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No quote email templates are configured.</p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
              <div className="space-y-2">
                <Label>Template</Label>
                <div className="space-y-2">
                  {templateRows.map(template => (
                    <button
                      key={template.template_key}
                      type="button"
                      onClick={() => setSelectedTemplateKey(template.template_key)}
                      className={[
                        'w-full rounded-md border px-3 py-2 text-left text-sm transition-colors',
                        selectedTemplate?.template_key === template.template_key
                          ? 'border-brand-yellow bg-brand-yellow/10 text-white'
                          : 'border-slate-700 bg-slate-800/40 text-slate-300 hover:bg-slate-800',
                      ].join(' ')}
                    >
                      <span className="block font-medium">{template.label}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">{template.description}</span>
                    </button>
                  ))}
                </div>
              </div>

              {selectedTemplate ? (
                <div className="space-y-4 rounded-lg border border-slate-700 bg-slate-800/40 p-4">
                  <div>
                    <h3 className="font-semibold text-white">{selectedTemplate.label}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{selectedTemplate.description}</p>
                  </div>

                  <div className="space-y-2">
                    <Label>Subject wording</Label>
                    <Input
                      value={selectedTemplate.subject_template}
                      disabled={!templatesPayload?.can_manage || Boolean(saving)}
                      onChange={event => updateTemplateRow(selectedTemplate.template_key, { subject_template: event.target.value })}
                      className="bg-slate-800 border-slate-600 text-white"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Body wording</Label>
                    <Textarea
                      value={selectedTemplate.body_template}
                      disabled={!templatesPayload?.can_manage || Boolean(saving)}
                      onChange={event => updateTemplateRow(selectedTemplate.template_key, { body_template: event.target.value })}
                      rows={10}
                      className="bg-slate-800 border-slate-600 text-white"
                    />
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Available placeholders</p>
                    <div className="flex flex-wrap gap-2">
                      {selectedTemplate.placeholders.map(placeholder => (
                        <code key={placeholder} className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1 text-xs text-slate-200">
                          {`{${placeholder}}`}
                        </code>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-md border border-slate-700 bg-slate-950/40 p-3 text-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Sample preview</p>
                    <p className="mt-2 font-medium text-white">
                      {renderTemplatePreview(selectedTemplate.subject_template, selectedTemplate.sample_context)}
                    </p>
                    <p className="mt-3 whitespace-pre-wrap text-slate-300">
                      {renderTemplatePreview(selectedTemplate.body_template, selectedTemplate.sample_context)}
                    </p>
                  </div>

                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!templatesPayload?.can_manage || Boolean(saving)}
                      onClick={() => void resetTemplateRow(selectedTemplate)}
                      className="border-slate-600 text-muted-foreground"
                    >
                      Reset to default
                    </Button>
                    <Button
                      type="button"
                      disabled={!templatesPayload?.can_manage || Boolean(saving)}
                      onClick={() => void saveTemplateRow(selectedTemplate)}
                      className="bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90"
                    >
                      {saving === `template-${selectedTemplate.template_key}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Save template
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  function renderAdminToolsPanel() {
    return (
      <Card className="border-slate-700 bg-slate-900/70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <Trash2 className="h-5 w-5 text-red-300" />
            Delete Draft Quote
          </CardTitle>
          <CardDescription>
            Select a latest draft quote to permanently delete it. Confirmed, invoiced, archived, or older quote versions are protected.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div className="space-y-2">
              <Label htmlFor="delete-quote-select">Quote reference</Label>
              <Select
                value={deleteQuoteId}
                onValueChange={setDeleteQuoteId}
                disabled={deletableQuotes.length === 0 || saving === 'delete-quote'}
              >
                <SelectTrigger id="delete-quote-select" className="bg-slate-800 border-slate-600 text-white">
                  <SelectValue placeholder={deletableQuotes.length > 0 ? 'Select a draft quote' : 'No draft quotes available'} />
                </SelectTrigger>
                <SelectContent>
                  {deletableQuotes.map((quote) => (
                    <SelectItem key={quote.id} value={quote.id}>
                      {quote.quote_reference}{quote.customer?.company_name ? ` - ${quote.customer.company_name}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              variant="destructive"
              onClick={() => setDeleteDialogOpen(true)}
              disabled={!selectedDeleteQuote || saving === 'delete-quote'}
            >
              <Trash2 className="h-4 w-4" />
              Delete Quote
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="mt-3 flex justify-end">
        <Tabs value={activeTab} onValueChange={(value) => onTabChange(value as QuoteSettingsSubTab)}>
          <TabsList className="h-auto flex-wrap">
            {SETTINGS_TABS.map(tab => {
              const Icon = tab.icon;
              return (
                <TabsTrigger key={tab.value} value={tab.value} className="gap-2">
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => onTabChange(value as QuoteSettingsSubTab)}>
        <TabsContent value="notifications" className="mt-0 space-y-6">
          {renderNotificationsPanel()}
        </TabsContent>
        <TabsContent value="managers" className="mt-0 space-y-6">
          {renderManagersPanel()}
        </TabsContent>
        <TabsContent value="sending" className="mt-0 space-y-6">
          {renderSendingPanel()}
        </TabsContent>
        <TabsContent value="schedule" className="mt-0 space-y-6">
          {renderSchedulePanel()}
        </TabsContent>
        <TabsContent value="templates" className="mt-0 space-y-6">
          {renderTemplatesPanel()}
        </TabsContent>
        <TabsContent value="admin-tools" className="mt-0 space-y-6">
          {renderAdminToolsPanel()}
        </TabsContent>
      </Tabs>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="border-border text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete draft quote?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              {selectedDeleteQuote ? (
                <>
                  This will permanently delete quote{' '}
                  <span className="font-semibold text-white">{selectedDeleteQuote.quote_reference}</span>.
                  {selectedDeleteQuote.previous_versions?.length
                    ? ' The previous quote version will become the latest version again. This action cannot be undone.'
                    : ' This action cannot be undone.'}
                </>
              ) : (
                'Select a draft quote before deleting.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving === 'delete-quote'}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void confirmDeleteQuote();
              }}
              disabled={!selectedDeleteQuote || saving === 'delete-quote'}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {saving === 'delete-quote' ? 'Deleting...' : 'Delete Quote'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function LoadingPanel({ label }: { label: string }) {
  return <PanelLoader message={label} className="py-12" />;
}
