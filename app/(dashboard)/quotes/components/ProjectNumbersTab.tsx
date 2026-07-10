'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, CircleDollarSign, Clock3, Link2, Plus, ReceiptText } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useDirtyDialogGuard } from '@/lib/hooks/useDirtyDialogGuard';
import type {
  Quote,
  QuoteManagerOption,
  QuoteProjectCost,
  QuoteProjectCostCategory,
  QuoteProjectNumber,
} from '../types';

interface CustomerOption {
  id: string;
  company_name: string;
  contact_name: string | null;
  contact_email: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  county: string | null;
  postcode: string | null;
  default_validity_days: number;
}

interface ProjectNumbersTabProps {
  projectNumbers: QuoteProjectNumber[];
  managerOptions: QuoteManagerOption[];
  quotes: Quote[];
  customers: CustomerOption[];
  canViewCustomers: boolean;
  onRefresh: () => Promise<void>;
  onOpenQuote: (quoteId: string) => void;
}

interface ProjectFormState {
  manager_profile_id: string;
  title: string;
  description: string;
  notes: string;
}

interface CostFormState {
  project_number_id: string;
  cost_date: string;
  category: QuoteProjectCostCategory;
  supplier: string;
  description: string;
  amount: string;
  notes: string;
}

interface ConvertFormState {
  customer_id: string;
  quote_id: string;
  site_address: string;
  subject_line: string;
  project_description: string;
  scope: string;
}

const COST_CATEGORIES: QuoteProjectCostCategory[] = ['materials', 'subcontractor', 'plant', 'labour', 'other'];

const emptyProjectForm: ProjectFormState = {
  manager_profile_id: '',
  title: '',
  description: '',
  notes: '',
};

const emptyConvertForm: ConvertFormState = {
  customer_id: '',
  quote_id: '',
  site_address: '',
  subject_line: '',
  project_description: '',
  scope: '',
};

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function buildDialogSnapshot(value: unknown) {
  return JSON.stringify(value);
}

function buildEmptyCostForm(projectNumberId = ''): CostFormState {
  return {
    project_number_id: projectNumberId,
    cost_date: getToday(),
    category: 'materials',
    supplier: '',
    description: '',
    amount: '',
    notes: '',
  };
}

function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(Number(value || 0));
}

function formatHours(value: number | null | undefined) {
  return `${Number(value || 0).toFixed(2).replace(/\.00$/, '')} hrs`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'No date';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(value));
}

function getCustomerAddress(customer: CustomerOption | undefined) {
  if (!customer) return '';
  return [
    customer.address_line_1,
    customer.address_line_2,
    [customer.city, customer.county].filter(Boolean).join(', ') || null,
    customer.postcode,
  ].filter(Boolean).join('\n');
}

function getOpenCosts(project: QuoteProjectNumber) {
  return (project.costs || []).filter(cost => !cost.linked_quote_id);
}

function getSelectedCostIds(selectedCosts: Record<string, Set<string>>, projectId: string, openCosts: QuoteProjectCost[]) {
  const selected = selectedCosts[projectId];
  if (selected && selected.size > 0) return [...selected];
  return openCosts.map(cost => cost.id);
}

export function ProjectNumbersTab({
  projectNumbers,
  managerOptions,
  quotes,
  customers,
  canViewCustomers,
  onRefresh,
  onOpenQuote,
}: ProjectNumbersTabProps) {
  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [costFormOpen, setCostFormOpen] = useState(false);
  const [projectForm, setProjectForm] = useState<ProjectFormState>(emptyProjectForm);
  const [costForm, setCostForm] = useState<CostFormState>(buildEmptyCostForm());
  const [selectedCosts, setSelectedCosts] = useState<Record<string, Set<string>>>({});
  const [actionProjectId, setActionProjectId] = useState<string | null>(null);
  const [actionMode, setActionMode] = useState<'link' | 'convert' | null>(null);
  const [convertForm, setConvertForm] = useState<ConvertFormState>(emptyConvertForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [projectFormBaseline, setProjectFormBaseline] = useState(buildDialogSnapshot(emptyProjectForm));
  const [costFormBaseline, setCostFormBaseline] = useState(buildDialogSnapshot(buildEmptyCostForm()));
  const [convertFormBaseline, setConvertFormBaseline] = useState(buildDialogSnapshot(emptyConvertForm));

  const activeProjects = useMemo(
    () => projectNumbers.filter(project => project.status === 'open'),
    [projectNumbers]
  );
  const activeProject = projectNumbers.find(project => project.id === actionProjectId) || null;
  const openQuotes = useMemo(
    () => quotes.filter(quote => quote.is_latest_version && quote.commercial_status === 'open'),
    [quotes]
  );
  const isProjectFormDirty = projectFormOpen && buildDialogSnapshot(projectForm) !== projectFormBaseline;
  const isCostFormDirty = costFormOpen && buildDialogSnapshot(costForm) !== costFormBaseline;
  const isActionFormDirty = Boolean(actionProjectId && actionMode) && buildDialogSnapshot(convertForm) !== convertFormBaseline;
  const {
    contentRef: projectDialogContentRef,
    handleOpenChange: handleProjectDialogOpenChange,
    handleInteractOutside: handleProjectDialogInteractOutside,
    handleEscapeKeyDown: handleProjectDialogEscapeKeyDown,
    discard: discardProjectDialog,
  } = useDirtyDialogGuard({
    isDirty: isProjectFormDirty,
    disabled: isSubmitting,
    onOpenChange: (open) => {
      setProjectFormOpen(open);
      if (!open) {
        setProjectForm(emptyProjectForm);
        setProjectFormBaseline(buildDialogSnapshot(emptyProjectForm));
      }
    },
  });
  const {
    contentRef: costDialogContentRef,
    handleOpenChange: handleCostDialogOpenChange,
    handleInteractOutside: handleCostDialogInteractOutside,
    handleEscapeKeyDown: handleCostDialogEscapeKeyDown,
    discard: discardCostDialog,
  } = useDirtyDialogGuard({
    isDirty: isCostFormDirty,
    disabled: isSubmitting,
    onOpenChange: (open) => {
      setCostFormOpen(open);
      if (!open) {
        const nextForm = buildEmptyCostForm();
        setCostForm(nextForm);
        setCostFormBaseline(buildDialogSnapshot(nextForm));
      }
    },
  });
  const {
    contentRef: actionDialogContentRef,
    handleOpenChange: handleActionDialogOpenChange,
    handleInteractOutside: handleActionDialogInteractOutside,
    handleEscapeKeyDown: handleActionDialogEscapeKeyDown,
    discard: discardActionDialog,
  } = useDirtyDialogGuard({
    isDirty: isActionFormDirty,
    disabled: isSubmitting,
    onOpenChange: (open) => {
      if (open) return;
      setActionProjectId(null);
      setActionMode(null);
      setConvertForm(emptyConvertForm);
      setConvertFormBaseline(buildDialogSnapshot(emptyConvertForm));
    },
  });

  async function submitProjectForm() {
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/quotes/project-numbers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(projectForm),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || 'Unable to create project number.');

      toast.success('Project number created');
      setProjectForm(emptyProjectForm);
      setProjectFormOpen(false);
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to create project number.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitCostForm() {
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/quotes/project-numbers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...costForm,
          action: 'add_cost',
          amount: Number(costForm.amount || 0),
        }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || 'Unable to add cost.');

      toast.success('Cost added');
      setCostForm(buildEmptyCostForm());
      setCostFormOpen(false);
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to add cost.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitProjectAction() {
    if (!activeProject || !actionMode) return;

    const openCosts = getOpenCosts(activeProject);
    const costIds = getSelectedCostIds(selectedCosts, activeProject.id, openCosts);
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/quotes/project-numbers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: actionMode === 'link' ? 'link_existing_quote' : 'convert_to_quote',
          project_number_id: activeProject.id,
          cost_ids: costIds,
          ...convertForm,
        }),
      });
      const payload = await response.json().catch(() => null) as { error?: string; quote_id?: string } | null;
      if (!response.ok) throw new Error(payload?.error || 'Unable to update project number.');

      toast.success(actionMode === 'link' ? 'Costs added to quote' : 'Project number converted to quote');
      setActionProjectId(null);
      setActionMode(null);
      setConvertForm(emptyConvertForm);
      await onRefresh();
      if (payload?.quote_id) onOpenQuote(payload.quote_id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to update project number.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function toggleCost(projectId: string, costId: string) {
    setSelectedCosts((current) => {
      const next = new Set(current[projectId] || []);
      if (next.has(costId)) {
        next.delete(costId);
      } else {
        next.add(costId);
      }
      return { ...current, [projectId]: next };
    });
  }

  function openCostModal(projectId: string) {
    const nextForm = buildEmptyCostForm(projectId);
    setCostForm(nextForm);
    setCostFormBaseline(buildDialogSnapshot(nextForm));
    setCostFormOpen(true);
  }

  function openProjectAction(project: QuoteProjectNumber, mode: 'link' | 'convert') {
    const firstCustomer = customers[0];
    setActionProjectId(project.id);
    setActionMode(mode);
    const nextForm = {
      ...emptyConvertForm,
      subject_line: project.title,
      project_description: project.description || '',
      scope: getOpenCosts(project).map(cost => `- ${cost.description}`).join('\n'),
      customer_id: firstCustomer?.id || '',
      site_address: firstCustomer ? getCustomerAddress(firstCustomer) : '',
    };
    setConvertForm(nextForm);
    setConvertFormBaseline(buildDialogSnapshot(nextForm));
  }

  function handleCustomerChange(customerId: string) {
    const customer = customers.find(item => item.id === customerId);
    setConvertForm(current => ({
      ...current,
      customer_id: customerId,
      site_address: getCustomerAddress(customer) || current.site_address,
    }));
  }

  return (
    <div className="min-w-0 max-w-full space-y-4 overflow-hidden">
      <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-white p-4 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">Project Numbers</h2>
          <p className="max-w-full text-sm text-slate-400">
            Reserve real quote/job numbers before a customer quote exists, then review costs and timesheet hours here.
          </p>
        </div>
        <Button
          onClick={() => {
            setProjectForm(emptyProjectForm);
            setProjectFormBaseline(buildDialogSnapshot(emptyProjectForm));
            setProjectFormOpen(true);
          }}
          className="w-full bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90 sm:w-auto"
        >
          <Plus className="mr-2 h-4 w-4" />
          New Project Number
        </Button>
      </div>

      {projectNumbers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-white p-8 text-center text-sm text-slate-400 dark:bg-slate-900">
          No project numbers have been created yet.
        </div>
      ) : (
        <div className="grid min-w-0 gap-4">
          {projectNumbers.map((project) => {
            const openCosts = getOpenCosts(project);
            const selectedIds = selectedCosts[project.id] || new Set<string>();
            const actionQuoteId = project.converted_quote_id || project.linked_quote_id;

            return (
              <article key={project.id} className="min-w-0 overflow-hidden rounded-lg border border-border bg-white p-3 shadow-sm dark:bg-slate-900 sm:p-4">
                <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 break-all font-mono text-xl font-semibold text-amber-600 dark:text-amber-300">
                        {project.project_reference}
                      </span>
                      <Badge variant={project.status === 'open' ? 'default' : 'secondary'}>{project.status}</Badge>
                    </div>
                    <h3 className="mt-1 break-words text-lg font-semibold text-foreground">{project.title}</h3>
                    {project.description ? (
                      <p className="mt-1 break-words text-sm text-slate-400">{project.description}</p>
                    ) : null}
                    <p className="mt-2 break-words text-xs text-slate-400">
                      Manager: {project.manager?.full_name || project.requester_initials} · Created {formatDate(project.created_at)}
                    </p>
                    {actionQuoteId ? (
                      <Button variant="link" className="mt-1 h-auto p-0 text-sm" onClick={() => onOpenQuote(actionQuoteId)}>
                        Open linked quote
                      </Button>
                    ) : null}
                  </div>

                  <div className="grid min-w-0 grid-cols-2 gap-2 text-sm sm:grid-cols-4 lg:min-w-[520px]">
                    <div className="min-w-0 rounded-md border border-border p-3">
                      <CircleDollarSign className="mb-1 h-4 w-4 text-slate-400" />
                      <p className="text-xs text-slate-400">Manual costs</p>
                      <p className="truncate font-semibold">{formatCurrency(project.manual_cost_total)}</p>
                    </div>
                    <div className="min-w-0 rounded-md border border-border p-3">
                      <CheckCircle2 className="mb-1 h-4 w-4 text-slate-400" />
                      <p className="text-xs text-slate-400">Unlinked</p>
                      <p className="truncate font-semibold">{formatCurrency(project.unlinked_manual_cost_total)}</p>
                    </div>
                    <div className="min-w-0 rounded-md border border-border p-3">
                      <Clock3 className="mb-1 h-4 w-4 text-slate-400" />
                      <p className="text-xs text-slate-400">Labour hours</p>
                      <p className="truncate font-semibold">{formatHours(project.labour_summary?.total_hours)}</p>
                    </div>
                    <div className="min-w-0 rounded-md border border-border p-3">
                      <ReceiptText className="mb-1 h-4 w-4 text-slate-400" />
                      <p className="text-xs text-slate-400">Timesheets</p>
                      <p className="truncate font-semibold">{project.labour_summary?.timesheet_count || 0}</p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm font-medium text-foreground">Manual costs</p>
                    <Button
                      size="sm"
                      onClick={() => openCostModal(project.id)}
                      disabled={project.status !== 'open'}
                      className="w-full bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90 sm:w-auto"
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Add Cost
                    </Button>
                  </div>

                  {(project.costs || []).length === 0 ? (
                    <p className="rounded-md border border-dashed border-border p-4 text-sm text-slate-400">
                      No manual costs added yet. Timesheet labour still appears in the hours summary when employees use this job code.
                    </p>
                  ) : (
                    <>
                    <div className="space-y-2 sm:hidden">
                      {(project.costs || []).map((cost) => (
                        <div key={cost.id} className="min-w-0 rounded-md border border-border p-3">
                          <div className="flex min-w-0 items-start gap-3">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(cost.id)}
                              disabled={Boolean(cost.linked_quote_id) || project.status !== 'open'}
                              onChange={() => toggleCost(project.id, cost.id)}
                              aria-label={`Select ${cost.description}`}
                              className="mt-1 shrink-0"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="break-words text-sm font-medium text-foreground">{cost.description}</p>
                                  <p className="mt-1 text-xs capitalize text-slate-400">
                                    {formatDate(cost.cost_date)} · {cost.category}
                                  </p>
                                </div>
                                <p className="shrink-0 text-sm font-semibold">{formatCurrency(cost.amount)}</p>
                              </div>
                              {cost.supplier || cost.linked_quote_id ? (
                                <p className="mt-2 break-words text-xs text-slate-400">
                                  {cost.supplier || 'No supplier'}
                                  {cost.linked_quote_id ? ' · linked' : ''}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="hidden overflow-x-auto sm:block">
                      <table className="w-full min-w-[720px] text-sm">
                        <thead className="text-left text-xs uppercase text-slate-400">
                          <tr className="border-b border-border">
                            <th className="py-2 pr-3">Select</th>
                            <th className="py-2 pr-3">Date</th>
                            <th className="py-2 pr-3">Category</th>
                            <th className="py-2 pr-3">Supplier</th>
                            <th className="py-2 pr-3">Description</th>
                            <th className="py-2 text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(project.costs || []).map((cost) => (
                            <tr key={cost.id} className="border-b border-border/60">
                              <td className="py-2 pr-3">
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(cost.id)}
                                  disabled={Boolean(cost.linked_quote_id) || project.status !== 'open'}
                                  onChange={() => toggleCost(project.id, cost.id)}
                                  aria-label={`Select ${cost.description}`}
                                />
                              </td>
                              <td className="py-2 pr-3">{formatDate(cost.cost_date)}</td>
                              <td className="py-2 pr-3 capitalize">{cost.category}</td>
                              <td className="py-2 pr-3">{cost.supplier || '-'}</td>
                              <td className="py-2 pr-3">
                                {cost.description}
                                {cost.linked_quote_id ? (
                                  <span className="ml-2 text-xs text-slate-400">(linked)</span>
                                ) : null}
                              </td>
                              <td className="py-2 text-right font-medium">{formatCurrency(cost.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    </>
                  )}

                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:justify-end">
                    <Button
                      variant="outline"
                      onClick={() => openProjectAction(project, 'link')}
                      disabled={project.status !== 'open' || openCosts.length === 0}
                      className="w-full whitespace-normal sm:w-auto sm:whitespace-nowrap"
                    >
                      <Link2 className="mr-2 h-4 w-4" />
                      Add to Existing Quote
                    </Button>
                    <Button
                      onClick={() => openProjectAction(project, 'convert')}
                      disabled={project.status !== 'open' || openCosts.length === 0 || !canViewCustomers}
                      className="w-full whitespace-normal bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90 sm:w-auto sm:whitespace-nowrap"
                    >
                      <ReceiptText className="mr-2 h-4 w-4" />
                      Create Quote from Costs
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Dialog open={projectFormOpen} onOpenChange={handleProjectDialogOpenChange}>
        <DialogContent
          ref={projectDialogContentRef}
          className="max-w-2xl"
          onInteractOutside={handleProjectDialogInteractOutside}
          onEscapeKeyDown={handleProjectDialogEscapeKeyDown}
        >
          <DialogHeader>
            <DialogTitle>Create Project Number</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Manager *</Label>
              <Select
                value={projectForm.manager_profile_id}
                onValueChange={(value) => setProjectForm(current => ({ ...current, manager_profile_id: value }))}
              >
                <SelectTrigger className="data-[placeholder]:[&>span]:!text-slate-400">
                  <SelectValue placeholder="Select manager" />
                </SelectTrigger>
                <SelectContent>
                  {managerOptions.filter(option => option.is_active).map((option) => (
                    <SelectItem
                      key={option.profile_id}
                      value={option.profile_id}
                      textValue={option.profile?.full_name || option.signoff_name || option.initials}
                    >
                      <span className="flex flex-col text-left">
                        <span>{option.profile?.full_name || option.signoff_name || option.initials}</span>
                        <span className="text-xs text-slate-400">{option.initials}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-title">Title *</Label>
              <Input
                id="project-title"
                value={projectForm.title}
                onChange={(event) => setProjectForm(current => ({ ...current, title: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-description">Description</Label>
              <Textarea
                id="project-description"
                value={projectForm.description}
                onChange={(event) => setProjectForm(current => ({ ...current, description: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-notes">Notes</Label>
              <Textarea
                id="project-notes"
                value={projectForm.notes}
                onChange={(event) => setProjectForm(current => ({ ...current, notes: event.target.value }))}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={discardProjectDialog}>
                {isProjectFormDirty ? 'Discard Changes' : 'Cancel'}
              </Button>
              <Button
                onClick={submitProjectForm}
                disabled={isSubmitting}
                className="bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90"
              >
                Reserve Number
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={costFormOpen} onOpenChange={handleCostDialogOpenChange}>
        <DialogContent
          ref={costDialogContentRef}
          className="max-w-2xl"
          onInteractOutside={handleCostDialogInteractOutside}
          onEscapeKeyDown={handleCostDialogEscapeKeyDown}
        >
          <DialogHeader>
            <DialogTitle>Add Manual Cost</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Project Number</Label>
                <Select
                  value={costForm.project_number_id}
                  onValueChange={(value) => setCostForm(current => ({ ...current, project_number_id: value }))}
                >
                <SelectTrigger className="data-[placeholder]:[&>span]:!text-slate-400">
                    <SelectValue placeholder="Select project number" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeProjects.map((project) => (
                      <SelectItem
                        key={project.id}
                        value={project.id}
                        textValue={`${project.project_reference} ${project.title}`}
                      >
                        <span className="flex flex-col text-left">
                          <span>{project.project_reference}</span>
                          <span className="text-xs text-slate-400">{project.title}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cost-date">Cost Date</Label>
                <Input
                  id="cost-date"
                  type="date"
                  value={costForm.cost_date}
                  onChange={(event) => setCostForm(current => ({ ...current, cost_date: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={costForm.category}
                  onValueChange={(value: QuoteProjectCostCategory) => setCostForm(current => ({ ...current, category: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COST_CATEGORIES.map((category) => (
                      <SelectItem key={category} value={category} className="capitalize">
                        {category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cost-supplier">Supplier</Label>
                <Input
                  id="cost-supplier"
                  value={costForm.supplier}
                  onChange={(event) => setCostForm(current => ({ ...current, supplier: event.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cost-description">Description *</Label>
              <Textarea
                id="cost-description"
                value={costForm.description}
                onChange={(event) => setCostForm(current => ({ ...current, description: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cost-amount">Amount *</Label>
              <Input
                id="cost-amount"
                type="number"
                step="0.01"
                min="0"
                value={costForm.amount}
                onChange={(event) => setCostForm(current => ({ ...current, amount: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cost-notes">Notes</Label>
              <Textarea
                id="cost-notes"
                value={costForm.notes}
                onChange={(event) => setCostForm(current => ({ ...current, notes: event.target.value }))}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={discardCostDialog}>
                {isCostFormDirty ? 'Discard Changes' : 'Cancel'}
              </Button>
              <Button
                onClick={submitCostForm}
                disabled={isSubmitting}
                className="bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90"
              >
                Add Cost
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(actionProjectId && actionMode)} onOpenChange={handleActionDialogOpenChange}>
        <DialogContent
          ref={actionDialogContentRef}
          className="max-w-2xl"
          onInteractOutside={handleActionDialogInteractOutside}
          onEscapeKeyDown={handleActionDialogEscapeKeyDown}
        >
          <DialogHeader>
            <DialogTitle>
              {actionMode === 'link' ? 'Add Costs to Existing Quote' : 'Create Quote from Project Number'}
            </DialogTitle>
          </DialogHeader>
          {activeProject ? (
            <div className="space-y-4">
              <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                <p className="font-mono font-semibold text-amber-600 dark:text-amber-300">{activeProject.project_reference}</p>
                <p className="text-slate-400">{activeProject.title}</p>
              </div>

              {actionMode === 'link' ? (
                <div className="space-y-2">
                  <Label>Existing Quote *</Label>
                  <Select
                    value={convertForm.quote_id}
                    onValueChange={(value) => setConvertForm(current => ({ ...current, quote_id: value }))}
                  >
                    <SelectTrigger className="data-[placeholder]:[&>span]:!text-slate-400">
                      <SelectValue placeholder="Select quote" />
                    </SelectTrigger>
                    <SelectContent>
                      {openQuotes.map((quote) => (
                        <SelectItem
                          key={quote.id}
                          value={quote.id}
                          textValue={`${quote.quote_reference} ${quote.customer?.company_name || 'Customer'} ${quote.subject_line || 'Untitled'}`}
                        >
                          <span className="flex flex-col text-left">
                            <span>{quote.quote_reference}</span>
                            <span className="text-xs text-slate-400">
                              {quote.customer?.company_name || 'Customer'} · {quote.subject_line || 'Untitled'}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label>Customer *</Label>
                    <Select value={convertForm.customer_id} onValueChange={handleCustomerChange}>
                      <SelectTrigger className="data-[placeholder]:[&>span]:!text-slate-400">
                        <SelectValue placeholder="Select customer" />
                      </SelectTrigger>
                      <SelectContent>
                        {customers.map((customer) => (
                          <SelectItem
                            key={customer.id}
                            value={customer.id}
                            textValue={`${customer.company_name} ${customer.contact_name || ''} ${customer.contact_email || ''}`}
                          >
                            <span className="flex flex-col text-left">
                              <span>{customer.company_name}</span>
                              {customer.contact_name || customer.contact_email ? (
                                <span className="text-xs text-slate-400">
                                  {[customer.contact_name, customer.contact_email].filter(Boolean).join(' · ')}
                                </span>
                              ) : null}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="convert-site-address">Site Address *</Label>
                    <Textarea
                      id="convert-site-address"
                      value={convertForm.site_address}
                      onChange={(event) => setConvertForm(current => ({ ...current, site_address: event.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="convert-title">Title</Label>
                    <Input
                      id="convert-title"
                      value={convertForm.subject_line}
                      onChange={(event) => setConvertForm(current => ({ ...current, subject_line: event.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="convert-summary">Summary</Label>
                    <Textarea
                      id="convert-summary"
                      value={convertForm.project_description}
                      onChange={(event) => setConvertForm(current => ({ ...current, project_description: event.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="convert-scope">Scope</Label>
                    <Textarea
                      id="convert-scope"
                      value={convertForm.scope}
                      onChange={(event) => setConvertForm(current => ({ ...current, scope: event.target.value }))}
                    />
                  </div>
                </>
              )}

              <p className="text-xs text-slate-400">
                If no boxes were ticked, all currently unlinked manual costs on this project number will be used.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={discardActionDialog}>
                  {isActionFormDirty ? 'Discard Changes' : 'Cancel'}
                </Button>
                <Button
                  onClick={submitProjectAction}
                  disabled={isSubmitting}
                  className="bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90"
                >
                  {actionMode === 'link' ? 'Add to Quote' : 'Create Quote'}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
