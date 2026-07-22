'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, Loader2, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  createScheduleJobTag,
  deleteScheduleJob,
  saveScheduleJob,
} from '@/lib/client/scheduling';
import type { ScheduleJob, ScheduleJobStatus, ScheduleJobTag } from '@/types/scheduling';

interface ScheduleJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: ScheduleJob | null;
  defaultDate: string;
  onSaved: () => void;
}

interface CustomerSiteOption {
  id: string;
  site_name: string;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  county: string | null;
  postcode: string | null;
  is_active: boolean;
  is_default: boolean;
}

interface CustomerOption {
  id: string;
  company_name: string;
  status: 'active' | 'inactive' | null;
  sites: CustomerSiteOption[];
}

function formatSiteAddress(site: CustomerSiteOption): string {
  return [
    site.address_line_1,
    site.address_line_2,
    [site.city, site.county].filter(Boolean).join(', ') || null,
    site.postcode,
  ].filter(Boolean).join('\n');
}

export function ScheduleJobDialog({
  open,
  onOpenChange,
  job,
  defaultDate,
  onSaved,
}: ScheduleJobDialogProps) {
  const [reference, setReference] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [customerSiteId, setCustomerSiteId] = useState('');
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [availableTags, setAvailableTags] = useState<ScheduleJobTag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [isDropOnReady, setIsDropOnReady] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [isCreatingTag, setIsCreatingTag] = useState(false);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [siteAddress, setSiteAddress] = useState('');
  const [status, setStatus] = useState<ScheduleJobStatus>('draft');
  const [startDate, setStartDate] = useState(defaultDate);
  const [endDate, setEndDate] = useState(defaultDate);
  const [estimatedMinutes, setEstimatedMinutes] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const isQuoteJob = job?.source_type === 'quote';

  useEffect(() => {
    if (!open) return;
    setReference(job?.job_reference || '');
    setTitle(job?.title || '');
    setDescription(job?.description || '');
    setCustomerId(job?.customer_id || '');
    setCustomerSiteId(job?.customer_site_id || '');
    setSiteAddress(job?.site_address || '');
    setStatus(job?.status || 'draft');
    setStartDate(job?.start_date || defaultDate);
    setEndDate(job?.end_date || defaultDate);
    setEstimatedMinutes(job?.estimated_duration_minutes?.toString() || '');
    setSelectedTagIds((job?.tags || []).map((tag) => tag.id));
    setIsDropOnReady(job?.is_drop_on_ready === true);
    setNewTagName('');
  }, [defaultDate, job, open]);

  useEffect(() => {
    if (!open) return;
    let isCancelled = false;
    setCustomersLoading(true);

    void fetch('/api/scheduling/jobs')
      .then(async response => {
        const payload = await response.json().catch(() => ({})) as {
          customers?: CustomerOption[];
          tags?: ScheduleJobTag[];
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error || 'Unable to load customers.');
        if (!isCancelled) {
          setCustomers(payload.customers || []);
          setAvailableTags(payload.tags || []);
        }
      })
      .catch(error => {
        if (!isCancelled) {
          toast.error(error instanceof Error ? error.message : 'Unable to load customers.');
        }
      })
      .finally(() => {
        if (!isCancelled) setCustomersLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [open]);

  const selectedCustomer = customers.find(customer => customer.id === customerId);
  const selectableCustomers = customers.filter(customer => (
    customer.status !== 'inactive' || customer.id === customerId
  ));
  const selectableSites = (selectedCustomer?.sites || []).filter(site => (
    site.is_active || site.id === customerSiteId
  ));

  function handleCustomerChange(nextCustomerId: string) {
    const customer = customers.find(item => item.id === nextCustomerId);
    const site = customer?.sites.find(item => item.is_active && item.is_default)
      || customer?.sites.find(item => item.is_active);
    setCustomerId(nextCustomerId);
    setCustomerSiteId(site?.id || '');
    setSiteAddress(site ? formatSiteAddress(site) : '');
  }

  function handleSiteChange(nextSiteId: string) {
    const site = selectedCustomer?.sites.find(item => item.id === nextSiteId);
    setCustomerSiteId(site?.id || '');
    if (site) setSiteAddress(formatSiteAddress(site));
  }

  async function handleCreateTag() {
    const name = newTagName.trim();
    if (!name || isCreatingTag) return;
    setIsCreatingTag(true);
    try {
      const tag = await createScheduleJobTag({ name });
      setAvailableTags((current) => [...current, tag].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedTagIds((current) => [...new Set([...current, tag.id])]);
      setNewTagName('');
      toast.success(`Created ${tag.name} tag`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to create job tag');
    } finally {
      setIsCreatingTag(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await saveScheduleJob(
        isQuoteJob
          ? {
              is_drop_on_ready: isDropOnReady,
              tag_ids: selectedTagIds,
            }
          : {
              job_reference: reference,
              title,
              description: description || null,
              customer_id: customerId,
              customer_site_id: customerSiteId || null,
              site_address: siteAddress || null,
              status,
              start_date: startDate,
              end_date: endDate,
              estimated_duration_minutes: estimatedMinutes ? Number(estimatedMinutes) : null,
              is_drop_on_ready: isDropOnReady,
              tag_ids: selectedTagIds,
            },
        job?.id
      );
      toast.success(isQuoteJob ? 'Job metadata updated' : job ? 'Job updated' : 'Job created');
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save job');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!job) return;
    setSaving(true);
    try {
      await deleteScheduleJob(job.id);
      toast.success('Job deleted');
      setDeleteOpen(false);
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to delete job');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-2xl overflow-y-auto border-border">
          <DialogHeader>
            <DialogTitle>{job ? 'Edit scheduled job' : 'Add scheduled job'}</DialogTitle>
            <DialogDescription>
              {isQuoteJob
                ? 'Quote details are read-only here. Edit planning dates and duration from the Quotes module.'
                : 'Set the planning dates, then add timed visits for employees and plant.'}
            </DialogDescription>
          </DialogHeader>

          <fieldset disabled={isQuoteJob} className="grid gap-4 py-2 disabled:opacity-70">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="schedule-job-reference">Job reference</Label>
                <Input
                  id="schedule-job-reference"
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  placeholder="e.g. 12345-MD"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="schedule-job-status">Status</Label>
                <Select value={status} onValueChange={(value) => setStatus(value as ScheduleJobStatus)}>
                  <SelectTrigger id="schedule-job-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="in_progress">In progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="schedule-job-title">Title</Label>
              <Input id="schedule-job-title" value={title} onChange={(event) => setTitle(event.target.value)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="schedule-job-customer">Customer</Label>
                <Select
                  value={customerId}
                  onValueChange={handleCustomerChange}
                  disabled={customersLoading}
                >
                  <SelectTrigger id="schedule-job-customer">
                    <SelectValue placeholder={customersLoading ? 'Loading customers...' : 'Select customer'} />
                  </SelectTrigger>
                  <SelectContent>
                    {selectableCustomers.map(customer => (
                      <SelectItem key={customer.id} value={customer.id}>
                        {customer.company_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="schedule-job-customer-site">Saved site</Label>
                <Select
                  value={customerSiteId || 'custom'}
                  onValueChange={value => handleSiteChange(value === 'custom' ? '' : value)}
                  disabled={!customerId || customersLoading}
                >
                  <SelectTrigger id="schedule-job-customer-site">
                    <SelectValue placeholder="Select site" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="custom">Custom / snapshot only</SelectItem>
                    {selectableSites.map(site => (
                      <SelectItem key={site.id} value={site.id}>
                        {site.site_name}{site.is_default ? ' (Default)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="schedule-job-site">Site address snapshot</Label>
              <Textarea
                id="schedule-job-site"
                rows={3}
                value={siteAddress}
                onChange={(event) => setSiteAddress(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                This snapshot is retained if the saved customer site changes later.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="schedule-job-description">Description</Label>
              <Textarea
                id="schedule-job-description"
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="schedule-job-start">Start date</Label>
                <Input id="schedule-job-start" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="schedule-job-end">End date</Label>
                <Input id="schedule-job-end" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="schedule-job-duration">Estimated minutes</Label>
              <Input
                id="schedule-job-duration"
                type="number"
                min="15"
                step="15"
                value={estimatedMinutes}
                onChange={(event) => setEstimatedMinutes(event.target.value)}
                placeholder="e.g. 240"
              />
            </div>
          </fieldset>

          <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Operational classification</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Tags and drop-on readiness can be updated here for both manual and Quote jobs.
              </p>
            </div>
            <label
              htmlFor="schedule-job-drop-on-ready"
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2"
            >
              <Checkbox
                id="schedule-job-drop-on-ready"
                checked={isDropOnReady}
                onCheckedChange={(checked) => setIsDropOnReady(checked === true)}
              />
              <span>
                <span className="block text-sm font-medium text-foreground">Ready for drop-on</span>
                <span className="block text-xs text-muted-foreground">
                  Crews finishing early can be offered this job.
                </span>
              </span>
            </label>
            <div className="space-y-2">
              <Label>Job tags</Label>
              {availableTags.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {availableTags.map((tag) => {
                    const isChecked = selectedTagIds.includes(tag.id);
                    return (
                      <label
                        key={tag.id}
                        htmlFor={`schedule-job-tag-${tag.id}`}
                        className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2"
                      >
                        <Checkbox
                          id={`schedule-job-tag-${tag.id}`}
                          checked={isChecked}
                          onCheckedChange={(checked) =>
                            setSelectedTagIds((current) =>
                              checked === true
                                ? [...new Set([...current, tag.id])]
                                : current.filter((id) => id !== tag.id)
                            )
                          }
                        />
                        <span className="text-sm text-foreground">{tag.name}</span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No reusable tags have been created yet.</p>
              )}
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={newTagName}
                  onChange={(event) => setNewTagName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    void handleCreateTag();
                  }}
                  placeholder="Create a tag, e.g. Hospital"
                  maxLength={80}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleCreateTag()}
                  disabled={!newTagName.trim() || isCreatingTag}
                >
                  {isCreatingTag ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Add tag
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            {job && !isQuoteJob ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeleteOpen(true)}
                className="border-red-500/40 text-red-300 hover:bg-red-500/10"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </Button>
            ) : <span />}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              {isQuoteJob && job ? (
                <Button asChild variant="outline">
                  <Link href={`/quotes/overview/${encodeURIComponent(job.job_reference)}`}>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open Quote
                  </Link>
                </Button>
              ) : null}
              <Button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || (!isQuoteJob && !customerId)}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {isQuoteJob ? 'Save metadata' : 'Save job'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this job?</AlertDialogTitle>
            <AlertDialogDescription>
              All employee and plant assignments for {job?.job_reference} will also be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              className="bg-red-600 text-white hover:bg-red-500"
            >
              Delete job
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
