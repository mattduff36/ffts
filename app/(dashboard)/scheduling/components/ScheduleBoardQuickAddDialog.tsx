'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  quickAddScheduleProject,
  type QuickAddScheduleProjectResult,
} from '@/lib/client/scheduling';
import { useDirtyDialogGuard } from '@/lib/hooks/useDirtyDialogGuard';
import { toScheduleLondonDateTimeIso } from '@/lib/utils/scheduling';
import type { QuoteManagerOption } from '@/app/(dashboard)/quotes/types';
import { schedulingControlStyles } from './scheduling-control-styles';

interface CustomerOption {
  id: string;
  company_name: string;
  sites?: Array<{
    id: string;
    site_name: string;
    is_active: boolean;
    is_default: boolean;
  }>;
}

interface ScheduleBoardQuickAddDialogProps {
  open: boolean;
  defaultDate: string;
  managerOptions: QuoteManagerOption[];
  managerLoadError?: string | null;
  onClose: () => void;
  onCreated: (result: QuickAddScheduleProjectResult) => void | Promise<void>;
}

interface QuickAddForm {
  manager_profile_id: string;
  title: string;
  description: string;
  notes: string;
  customer_id: string;
  site_id: string;
  work_date: string;
  start_time: string;
  end_time: string;
}

const EMPTY_FORM: QuickAddForm = {
  manager_profile_id: '',
  title: '',
  description: '',
  notes: '',
  customer_id: '',
  site_id: '',
  work_date: '',
  start_time: '08:00',
  end_time: '12:00',
};

export function ScheduleBoardQuickAddDialog({
  open,
  defaultDate,
  managerOptions,
  managerLoadError = null,
  onClose,
  onCreated,
}: ScheduleBoardQuickAddDialogProps) {
  const [form, setForm] = useState<QuickAddForm>({
    ...EMPTY_FORM,
    work_date: defaultDate,
  });
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const activeManagerOptions = managerOptions.filter((option) => option.is_active);
  const sites = useMemo(
    () => customers.find((customer) => customer.id === form.customer_id)?.sites || [],
    [customers, form.customer_id]
  );

  const isDirty = Object.entries(form).some(([key, value]) => {
    if (key === 'work_date') return value !== defaultDate;
    if (key === 'start_time') return value !== '08:00';
    if (key === 'end_time') return value !== '12:00';
    return Boolean(value);
  });

  const guard = useDirtyDialogGuard({
    isDirty,
    disabled: saving,
    onOpenChange: (nextOpen) => {
      if (!nextOpen) {
        setForm({ ...EMPTY_FORM, work_date: defaultDate });
        setRequestId(crypto.randomUUID());
        onClose();
      }
    },
  });

  useEffect(() => {
    if (!open) return;
    setForm((current) => ({
      ...current,
      work_date: current.work_date || defaultDate,
    }));
    void fetch('/api/scheduling/jobs')
      .then((response) => response.json())
      .then((payload) =>
        setCustomers(
          (payload.customers || []).filter(
            (customer: CustomerOption & { status?: string }) =>
              !customer.status || customer.status === 'active'
          )
        )
      )
      .catch(() => toast.error('Unable to load customers.'));
  }, [defaultDate, open]);

  async function handleSubmit() {
    if (
      !form.manager_profile_id
      || !form.title.trim()
      || !form.customer_id
      || !form.work_date
      || !form.start_time
      || !form.end_time
      || saving
    ) {
      return;
    }

    setSaving(true);
    try {
      const result = await quickAddScheduleProject({
        request_id: requestId,
        manager_profile_id: form.manager_profile_id,
        project_title: form.title.trim(),
        project_description: form.description.trim() || null,
        project_notes: form.notes.trim() || null,
        customer_id: form.customer_id,
        customer_site_id: form.site_id || null,
        start_date: form.work_date,
        end_date: form.work_date,
        initial_visit: {
          starts_at: toScheduleLondonDateTimeIso(form.work_date, form.start_time),
          ends_at: toScheduleLondonDateTimeIso(form.work_date, form.end_time),
        },
      });
      toast.success(`${result.project_reference} added to the schedule`);
      setForm({ ...EMPTY_FORM, work_date: defaultDate });
      setRequestId(crypto.randomUUID());
      onClose();
      await onCreated(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to quick add this job.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={guard.handleOpenChange}>
      <DialogContent
        ref={guard.contentRef}
        className="max-w-lg border-border"
        onInteractOutside={guard.handleInteractOutside}
        onEscapeKeyDown={guard.handleEscapeKeyDown}
      >
        <DialogHeader>
          <DialogTitle>Quick add job</DialogTitle>
          <DialogDescription>
            Create a Project Number, schedule it, and open the first visit ready for
            crew assignment. No quote or document upload is required.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Manager *</Label>
            <Select
              value={form.manager_profile_id}
              onValueChange={(value) =>
                setForm((current) => ({ ...current, manager_profile_id: value }))
              }
              disabled={activeManagerOptions.length === 0}
            >
              <SelectTrigger className="min-h-11">
                <SelectValue placeholder="Select manager" />
              </SelectTrigger>
              <SelectContent>
                {activeManagerOptions.map((option) => (
                  <SelectItem key={option.profile_id} value={option.profile_id}>
                    {option.profile?.full_name || option.signoff_name || option.initials}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {managerLoadError ? (
              <p role="alert" className="text-sm text-amber-300">{managerLoadError}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="quick-add-title">Title *</Label>
            <Input
              id="quick-add-title"
              className="min-h-11"
              value={form.title}
              onChange={(event) =>
                setForm((current) => ({ ...current, title: event.target.value }))
              }
              placeholder="Emergency call-out"
            />
          </div>
          <div className="space-y-2">
            <Label>Customer *</Label>
            <Select
              value={form.customer_id}
              onValueChange={(value) => {
                const customer = customers.find((item) => item.id === value);
                setForm((current) => ({
                  ...current,
                  customer_id: value,
                  site_id:
                    customer?.sites?.find((site) => site.is_active && site.is_default)?.id
                    || '',
                }));
              }}
            >
              <SelectTrigger className="min-h-11">
                <SelectValue placeholder="Select customer" />
              </SelectTrigger>
              <SelectContent>
                {customers.map((customer) => (
                  <SelectItem key={customer.id} value={customer.id}>
                    {customer.company_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Site</Label>
            <Select
              value={form.site_id || 'none'}
              onValueChange={(value) =>
                setForm((current) => ({
                  ...current,
                  site_id: value === 'none' ? '' : value,
                }))
              }
              disabled={!form.customer_id}
            >
              <SelectTrigger className="min-h-11">
                <SelectValue placeholder="Select site" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No saved site</SelectItem>
                {sites
                  .filter((site) => site.is_active)
                  .map((site) => (
                    <SelectItem key={site.id} value={site.id}>
                      {site.site_name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2 sm:col-span-1">
              <Label htmlFor="quick-add-date">Date *</Label>
              <Input
                id="quick-add-date"
                type="date"
                className="min-h-11"
                value={form.work_date}
                onChange={(event) =>
                  setForm((current) => ({ ...current, work_date: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quick-add-start">Start *</Label>
              <Input
                id="quick-add-start"
                type="time"
                className="min-h-11"
                value={form.start_time}
                onChange={(event) =>
                  setForm((current) => ({ ...current, start_time: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quick-add-end">End *</Label>
              <Input
                id="quick-add-end"
                type="time"
                className="min-h-11"
                value={form.end_time}
                onChange={(event) =>
                  setForm((current) => ({ ...current, end_time: event.target.value }))
                }
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="quick-add-description">Description</Label>
            <Textarea
              id="quick-add-description"
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="quick-add-notes">Notes</Label>
            <Textarea
              id="quick-add-notes"
              value={form.notes}
              onChange={(event) =>
                setForm((current) => ({ ...current, notes: event.target.value }))
              }
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button className={schedulingControlStyles.outline} onClick={guard.discard}>
            Cancel
          </Button>
          <Button
            className={schedulingControlStyles.primary}
            disabled={
              saving
              || !form.manager_profile_id
              || !form.title.trim()
              || !form.customer_id
              || !form.work_date
            }
            onClick={() => void handleSubmit()}
          >
            {saving ? 'Adding…' : 'Quick add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
