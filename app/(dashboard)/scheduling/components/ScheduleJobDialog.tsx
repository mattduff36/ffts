'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import Link from 'next/link';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  createProjectScheduleJob,
  createScheduleJobTag,
  fetchScheduleProjectCandidates,
  saveScheduleJob,
} from '@/lib/client/scheduling';
import type {
  ScheduleJob,
  ScheduleJobStatus,
  ScheduleJobTag,
  ScheduleProjectCandidate,
} from '@/types/scheduling';

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

interface QuoteManagerOption {
  profile_id: string;
  initials: string;
  is_active: boolean;
  profile?: {
    full_name: string | null;
  } | null;
  signoff_name?: string | null;
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
  const [projectNotes, setProjectNotes] = useState('');
  const [projectMode, setProjectMode] = useState<'new' | 'existing'>('new');
  const [projectNumberId, setProjectNumberId] = useState('');
  const [managerProfileId, setManagerProfileId] = useState('');
  const [projectCandidates, setProjectCandidates] = useState<ScheduleProjectCandidate[]>([]);
  const [managerOptions, setManagerOptions] = useState<QuoteManagerOption[]>([]);
  const [projectOptionsError, setProjectOptionsError] = useState<string | null>(null);
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
  const isQuoteJob = job?.source_type === 'quote';
  const isProjectJob = job?.source_type === 'manual' && Boolean(job.quote_project_number_id);
  const isSampleJob = job?.source_type === 'sample';

  useEffect(() => {
    if (!open) return;
    setReference(job?.job_reference || '');
    setTitle(job?.title || '');
    setDescription(job?.description || '');
    setProjectNotes('');
    setProjectMode('new');
    setProjectNumberId('');
    setManagerProfileId('');
    setProjectOptionsError(null);
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

  useEffect(() => {
    if (!open || job) return;
    let isCancelled = false;

    void Promise.all([
      fetch('/api/quotes/metadata').then(async (response) => {
        const payload = await response.json().catch(() => ({})) as {
          managerOptions?: QuoteManagerOption[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error || 'Quotes access is required to create a Project Number.');
        }
        return payload.managerOptions || [];
      }),
      fetchScheduleProjectCandidates(),
    ])
      .then(([nextManagerOptions, projects]) => {
        if (isCancelled) return;
        setManagerOptions(nextManagerOptions.filter((option) => option.is_active));
        setProjectCandidates(projects);
        setManagerProfileId(
          nextManagerOptions.find((option) => option.is_active)?.profile_id || ''
        );
      })
      .catch((error) => {
        if (isCancelled) return;
        const message = error instanceof Error
          ? error.message
          : 'Quotes access and an unlocked sensitive PIN are required.';
        setProjectOptionsError(message);
        toast.error(message);
      });

    return () => {
      isCancelled = true;
    };
  }, [job, open]);

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
      if (!job) {
        await createProjectScheduleJob({
          project_number_id: projectMode === 'existing' ? projectNumberId : null,
          manager_profile_id: projectMode === 'new' ? managerProfileId : null,
          project_title: projectMode === 'new' ? title : null,
          project_description: projectMode === 'new' ? description || null : null,
          project_notes: projectMode === 'new' ? projectNotes || null : null,
          customer_id: customerId,
          customer_site_id: customerSiteId || null,
          site_address: siteAddress || null,
          status,
          start_date: startDate,
          end_date: endDate,
          estimated_duration_minutes: estimatedMinutes ? Number(estimatedMinutes) : null,
          is_drop_on_ready: isDropOnReady,
          tag_ids: selectedTagIds,
        });
      } else {
        await saveScheduleJob(
          isQuoteJob
            ? {
                is_drop_on_ready: isDropOnReady,
                tag_ids: selectedTagIds,
              }
            : {
                ...(isSampleJob
                  ? {
                    job_reference: reference,
                    title,
                    description: description || null,
                  }
                  : {}),
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
          job.id
        );
      }
      toast.success(
        isQuoteJob
          ? 'Job metadata updated'
          : job
            ? 'Job updated'
            : projectMode === 'new'
              ? 'Project Number and schedule created'
              : 'Project scheduled'
      );
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save job');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-2xl overflow-y-auto border-border">
          <DialogHeader>
            <DialogTitle>{job ? 'Edit scheduled job' : 'Add Project job'}</DialogTitle>
            <DialogDescription>
              {isQuoteJob
                ? 'Quote details are read-only here. Use Reschedule on the board to change its planning dates.'
                : job
                  ? 'Project identity is managed in Quotes. Scheduling owns the operational planning details.'
                  : 'Create a Quote Project Number or reschedule an open Project, then set its operational planning details.'}
            </DialogDescription>
          </DialogHeader>

          {!job ? (
            <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
              <div className="space-y-2">
                <Label htmlFor="schedule-project-source">Project source</Label>
                <Select
                  value={projectMode}
                  onValueChange={(value) => {
                    setProjectMode(value as 'new' | 'existing');
                    setProjectNumberId('');
                  }}
                >
                  <SelectTrigger id="schedule-project-source">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">Create new Project Number</SelectItem>
                    <SelectItem value="existing">Schedule existing open Project</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {projectOptionsError ? (
                <p role="alert" className="text-sm text-red-300">
                  {projectOptionsError} Open Quotes and unlock its sensitive PIN before trying again.
                </p>
              ) : null}

              {projectMode === 'new' ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="schedule-project-manager">Manager *</Label>
                    <Select value={managerProfileId} onValueChange={setManagerProfileId}>
                      <SelectTrigger id="schedule-project-manager">
                        <SelectValue placeholder="Select manager" />
                      </SelectTrigger>
                      <SelectContent>
                        {managerOptions.map((option) => (
                          <SelectItem key={option.profile_id} value={option.profile_id}>
                            {option.profile?.full_name || option.signoff_name || option.initials}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="schedule-project-title">Project title *</Label>
                    <Input
                      id="schedule-project-title"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="schedule-project-description">Project description</Label>
                    <Textarea
                      id="schedule-project-description"
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="schedule-project-notes">Project notes</Label>
                    <Textarea
                      id="schedule-project-notes"
                      value={projectNotes}
                      onChange={(event) => setProjectNotes(event.target.value)}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    The Project Number is allocated from the selected manager&apos;s Quote series.
                  </p>
                </>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="schedule-existing-project">Open Project Number *</Label>
                  <Select value={projectNumberId} onValueChange={setProjectNumberId}>
                    <SelectTrigger id="schedule-existing-project">
                      <SelectValue placeholder="Select Project Number" />
                    </SelectTrigger>
                    <SelectContent>
                      {projectCandidates.map((project) => (
                        <SelectItem
                          key={project.id}
                          value={project.id}
                          textValue={`${project.project_reference} ${project.title}`}
                        >
                          {project.project_reference} · {project.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {projectCandidates.length === 0 && !projectOptionsError ? (
                    <p className="text-xs text-muted-foreground">
                      No unscheduled open Project Numbers are available.
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          ) : !isSampleJob ? (
            <div className="rounded-lg border border-border bg-muted/20 p-4">
              <p className="font-mono text-sm font-semibold text-foreground">{reference}</p>
              <p className="mt-1 font-medium text-foreground">{title}</p>
              {description ? (
                <p className="mt-1 text-sm text-muted-foreground">{description}</p>
              ) : null}
            </div>
          ) : null}

          <fieldset disabled={isQuoteJob} className="grid gap-4 py-2 disabled:opacity-70">
            <div className="grid gap-4 sm:grid-cols-2">
              {isSampleJob ? (
                <div className="space-y-2">
                  <Label htmlFor="schedule-job-reference">Job reference</Label>
                  <Input
                    id="schedule-job-reference"
                    value={reference}
                    onChange={(event) => setReference(event.target.value)}
                  />
                </div>
              ) : null}
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
            {isSampleJob ? (
              <div className="space-y-2">
                <Label htmlFor="schedule-job-title">Title</Label>
                <Input id="schedule-job-title" value={title} onChange={(event) => setTitle(event.target.value)} />
              </div>
            ) : null}
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
            {isSampleJob ? (
              <div className="space-y-2">
                <Label htmlFor="schedule-job-description">Description</Label>
                <Textarea
                  id="schedule-job-description"
                  rows={3}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </div>
            ) : null}
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
                Tags and drop-on readiness can be updated here for both Project and Quote jobs.
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

          <DialogFooter className="gap-2">
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
              {isProjectJob ? (
                <Button asChild variant="outline">
                  <Link href="/quotes?tab=projects">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open Projects
                  </Link>
                </Button>
              ) : null}
              <Button
                type="button"
                onClick={() => void handleSave()}
                disabled={
                  saving
                  || (!isQuoteJob && !customerId)
                  || (!job && Boolean(projectOptionsError))
                  || (!job && projectMode === 'new' && (!managerProfileId || !title.trim()))
                  || (!job && projectMode === 'existing' && !projectNumberId)
                }
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {isQuoteJob
                  ? 'Save metadata'
                  : job
                    ? 'Save job'
                    : projectMode === 'new'
                      ? 'Create Project job'
                      : 'Schedule Project'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
    </Dialog>
  );
}
