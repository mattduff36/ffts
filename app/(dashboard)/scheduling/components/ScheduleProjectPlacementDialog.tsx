'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createProjectScheduleJob } from '@/lib/client/scheduling';
import type { ScheduleProjectCandidate } from '@/types/scheduling';
import { schedulingControlStyles } from './scheduling-control-styles';

interface CustomerOption {
  id: string;
  company_name: string;
  sites?: Array<{ id: string; site_name: string; is_active: boolean; is_default: boolean }>;
}

interface ScheduleProjectPlacementDialogProps {
  project: ScheduleProjectCandidate | null;
  date: string;
  initialVisit?: { starts_at: string; ends_at: string };
  onClose: () => void;
  onSaved: () => void;
}

export function ScheduleProjectPlacementDialog({
  project,
  date,
  initialVisit,
  onClose,
  onSaved,
}: ScheduleProjectPlacementDialogProps) {
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!project) return;
    void fetch('/api/scheduling/jobs')
      .then((response) => response.json())
      .then((payload) => setCustomers(payload.customers || []))
      .catch(() => toast.error('Unable to load customers.'));
  }, [project]);

  const sites = customers.find((customer) => customer.id === customerId)?.sites || [];

  async function handleSave() {
    if (!project || !customerId || saving) return;
    setSaving(true);
    try {
      await createProjectScheduleJob({
        project_number_id: project.id,
        customer_id: customerId,
        customer_site_id: siteId || null,
        status: 'scheduled',
        start_date: date,
        end_date: date,
        estimated_duration_minutes: null,
        is_drop_on_ready: false,
        tag_ids: [],
        ...(initialVisit ? { initial_visit: initialVisit } : {}),
      });
      toast.success(`${project.project_reference} scheduled`);
      onSaved();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to schedule Project.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={Boolean(project)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Schedule Project</DialogTitle>
          <DialogDescription>{project?.project_reference} · {project?.title} · {date}</DialogDescription>
        </DialogHeader>
        <Select value={customerId} onValueChange={(value) => {
          setCustomerId(value);
          const customer = customers.find((item) => item.id === value);
          setSiteId(customer?.sites?.find((site) => site.is_active && site.is_default)?.id || '');
        }}>
          <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
          <SelectContent>{customers.map((customer) => <SelectItem key={customer.id} value={customer.id}>{customer.company_name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={siteId || 'none'} onValueChange={(value) => setSiteId(value === 'none' ? '' : value)} disabled={!customerId}>
          <SelectTrigger><SelectValue placeholder="Select site" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No saved site</SelectItem>
            {sites.filter((site) => site.is_active).map((site) => <SelectItem key={site.id} value={site.id}>{site.site_name}</SelectItem>)}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button className={schedulingControlStyles.outline} onClick={onClose}>Cancel</Button>
          <Button className={schedulingControlStyles.primary} disabled={!customerId || saving} onClick={() => void handleSave()}>
            {saving ? 'Scheduling…' : 'Schedule Project'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
