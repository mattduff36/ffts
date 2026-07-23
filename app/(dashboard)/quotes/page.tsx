'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { AppPageShell } from '@/components/layout/AppPageShell';
import { Archive, BriefcaseBusiness, CalendarClock, LayoutDashboard, Plus, Receipt, Settings } from 'lucide-react';
import { toast } from 'sonner';
import { fetchAllPaginatedItems } from '@/lib/client/paginated-fetch';
import { createStatusError, getErrorStatus, isNetworkFetchError } from '@/lib/utils/http-error';
import { PageLoader } from '@/components/ui/page-loader';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SensitiveModuleGate, SensitiveModuleSessionManager, useSensitiveModuleAccess } from '@/components/security/SensitiveModuleGate';
import { QuotesTable } from './components/QuotesTable';
import type { QuoteSettingsSubTab } from './components/settings/QuoteSettingsTab';
import { buildQuoteCreatePayload, uploadClientQuoteAttachments } from './quote-creation-client';
import { getQuoteManagerNameFilterValue, normalizeQuoteManagerName } from './types';
import type { LegacyQuote, Quote, QuoteFormData, QuoteManagerOption, QuoteProjectNumber } from './types';
import type { LegacyQuoteEditForm } from './components/LegacyQuotesTable';
import type { CustomerFormData } from '../customers/types';

interface CustomerOption {
  id: string;
  company_name: string;
  short_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  county: string | null;
  postcode: string | null;
  default_validity_days: number;
  secondary_contacts?: Array<{
    id: string;
    customer_id: string;
    name: string | null;
    job_title: string | null;
    email: string | null;
    phone: string | null;
  }>;
  sites?: Array<{
    id: string;
    customer_id: string;
    site_name: string;
    address_line_1: string | null;
    address_line_2: string | null;
    city: string | null;
    county: string | null;
    postcode: string | null;
    is_active: boolean;
    is_default: boolean;
    notes: string | null;
  }>;
}

interface ApproverOption {
  id: string;
  full_name: string | null;
  email: string | null;
}

interface QuoteManagerFilterOption {
  value: string;
  label: string;
}

type QuotePageTab = 'overview' | 'current' | 'projects' | 'archived' | 'legacy' | 'settings';

function QuoteTabLoader() {
  return <PageLoader message="Loading quotes section..." />;
}

const LegacyQuotesTable = dynamic(
  () => import('./components/LegacyQuotesTable').then((mod) => mod.LegacyQuotesTable),
  { loading: QuoteTabLoader }
);
const QuoteDetailsModal = dynamic(
  () => import('./components/QuoteDetailsModal').then((mod) => mod.QuoteDetailsModal)
);
const QuoteFormDialog = dynamic(
  () => import('./components/QuoteFormDialog').then((mod) => mod.QuoteFormDialog)
);
const ProjectNumbersTab = dynamic(
  () => import('./components/ProjectNumbersTab').then((mod) => mod.ProjectNumbersTab),
  { loading: QuoteTabLoader }
);
const QuotesOverviewTab = dynamic(
  () => import('./components/QuotesOverviewTab').then((mod) => mod.QuotesOverviewTab),
  { loading: QuoteTabLoader }
);
const QuoteSettingsTab = dynamic(
  () => import('./components/settings/QuoteSettingsTab').then((mod) => mod.QuoteSettingsTab),
  { loading: QuoteTabLoader }
);
const CustomerFormDialog = dynamic(
  () => import('../customers/components/CustomerFormDialog').then((mod) => mod.CustomerFormDialog)
);

function isQuotePageTab(value: string): value is QuotePageTab {
  return value === 'overview'
    || value === 'current'
    || value === 'projects'
    || value === 'archived'
    || value === 'legacy'
    || value === 'settings';
}

function getQuotePageTab(value: string | null): QuotePageTab {
  return value && isQuotePageTab(value) ? value : 'overview';
}

function isQuoteSettingsSubTab(value: string): value is QuoteSettingsSubTab {
  return ['notifications', 'managers', 'sending', 'schedule', 'templates', 'admin-tools'].includes(value);
}

function buildFormRequestError(payload: { error?: string; field_errors?: Record<string, string> }, fallback: string) {
  const error = new Error(payload.error || fallback) as Error & { fieldErrors?: Record<string, string> };
  error.fieldErrors = payload.field_errors || {};
  return error;
}

async function buildResponseError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  return createStatusError(payload?.error || fallback, response.status, payload);
}

function getCompactManagerLabel(label: string) {
  return label.trim().split(/\s+/)[0] || label;
}

function normalizeLegacyQuoteManagerName(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function getLegacyQuoteManagerFilterValue(value: string | null | undefined): string {
  const normalized = normalizeLegacyQuoteManagerName(value);
  return normalized ? `legacy-manager:${normalized.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}` : 'unknown';
}

function getQuoteManagerLabel(option: QuoteManagerOption | undefined, quote: Quote) {
  return normalizeQuoteManagerName(
    option?.profile?.full_name ||
    quote.manager_name ||
    option?.signoff_name ||
    quote.requester_initials ||
    option?.initials
  );
}

function isArchivedQuote(quote: Pick<Quote, 'commercial_status' | 'status'>) {
  return quote.commercial_status === 'closed' || quote.status === 'closed';
}

function buildQuoteManagerFilterOptions(quotes: Quote[], managerOptions: QuoteManagerOption[]) {
  const managerOptionById = new Map(managerOptions.map((option) => [option.profile_id, option]));
  const quoteManagers = new Map<string, QuoteManagerFilterOption>();

  quotes.forEach((quote) => {
    if (quote.requester_id) {
      const label = getQuoteManagerLabel(managerOptionById.get(quote.requester_id), quote);
      if (!label) return;

      quoteManagers.set(quote.requester_id, {
        value: quote.requester_id,
        label,
      });
      return;
    }

    const label = normalizeQuoteManagerName(quote.manager_name);
    const value = getQuoteManagerNameFilterValue(label);
    if (!label || !value) return;

    quoteManagers.set(value, { value, label });
  });

  return [...quoteManagers.values()].sort((a, b) => a.label.localeCompare(b.label));
}

interface ManagerFilterTabsProps {
  managerFilter: string;
  managerOptions: QuoteManagerFilterOption[];
  onManagerFilterChange: (nextManagerId: string) => void;
}

function ManagerFilterTabs({
  managerFilter,
  managerOptions,
  onManagerFilterChange,
}: ManagerFilterTabsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measurementRef = useRef<HTMLDivElement>(null);
  const [useCompactLabels, setUseCompactLabels] = useState(false);

  const updateCompactMode = useCallback(() => {
    const container = containerRef.current;
    const measurement = measurementRef.current;

    if (!container || !measurement) return;

    const availableWidth = Math.floor(container.clientWidth);
    const fullLabelWidth = Math.ceil(measurement.scrollWidth);

    setUseCompactLabels(fullLabelWidth > availableWidth);
  }, []);

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(updateCompactMode);
    const container = containerRef.current;
    const measurement = measurementRef.current;

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateCompactMode);
      return () => {
        window.cancelAnimationFrame(animationFrame);
        window.removeEventListener('resize', updateCompactMode);
      };
    }

    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(updateCompactMode);
    });

    if (container) resizeObserver.observe(container);
    if (measurement) resizeObserver.observe(measurement);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
    };
  }, [managerOptions, updateCompactMode]);

  return (
    <div ref={containerRef} className="relative mt-3 flex w-full justify-end overflow-hidden">
      <div
        ref={measurementRef}
        aria-hidden="true"
        className="pointer-events-none invisible absolute right-0 top-0 inline-flex min-h-9 w-max max-w-none flex-nowrap items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground"
      >
        <span className="inline-flex min-h-8 items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-center text-sm font-medium leading-tight">
          All Quotes
        </span>
        {managerOptions.map(option => (
          <span
            key={option.value}
            className="inline-flex min-h-8 items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-center text-sm font-medium leading-tight"
          >
            {option.label}
          </span>
        ))}
      </div>

      <Tabs value={managerFilter} onValueChange={onManagerFilterChange} className="max-w-full">
        <TabsList className="h-auto max-w-full flex-nowrap justify-end overflow-x-auto">
          <TabsTrigger value="all" className="gap-2 whitespace-nowrap">
            {useCompactLabels ? 'All' : 'All Quotes'}
          </TabsTrigger>
          {managerOptions.map(option => {
            const managerLabel = option.label;
            const compactManagerLabel = getCompactManagerLabel(managerLabel);

            return (
              <TabsTrigger
                key={option.value}
                value={option.value}
                className="gap-2 whitespace-nowrap"
                title={managerLabel}
              >
                {useCompactLabels ? compactManagerLabel : managerLabel}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>
    </div>
  );
}

export default function QuotesPage() {
  const { hasPermission: canViewQuotes, loading: permissionLoading } = usePermissionCheck('quotes', false);
  const { hasPermission: canViewCustomers, loading: customerPermissionLoading } = usePermissionCheck('customers', false);
  const { isAdmin, isSuperAdmin, isActualSuperAdmin } = useAuth();
  const sensitiveAccess = useSensitiveModuleAccess('quotes');
  const refreshSensitiveAccess = sensitiveAccess.refresh;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const syncQuoteQuery = useCallback((nextQuoteId: string | null) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    if (nextQuoteId) {
      nextParams.set('quote_id', nextQuoteId);
    } else {
      nextParams.delete('quote_id');
    }

    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);


  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [legacyQuotes, setLegacyQuotes] = useState<LegacyQuote[]>([]);
  const [projectNumbers, setProjectNumbers] = useState<QuoteProjectNumber[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [managerOptions, setManagerOptions] = useState<QuoteManagerOption[]>([]);
  const [approvers, setApprovers] = useState<ApproverOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [legacyLoading, setLegacyLoading] = useState(false);
  const [projectNumbersLoading, setProjectNumbersLoading] = useState(false);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [hasLoadedLegacyQuotes, setHasLoadedLegacyQuotes] = useState(false);
  const [hasLoadedProjectNumbers, setHasLoadedProjectNumbers] = useState(false);
  const [hasLoadedCustomers, setHasLoadedCustomers] = useState(false);

  // Modals
  const [detailQuoteId, setDetailQuoteId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingQuote, setEditingQuote] = useState<Quote | null>(null);
  const [customerFormOpen, setCustomerFormOpen] = useState(false);
  const [createdQuoteCustomerId, setCreatedQuoteCustomerId] = useState<string | null>(null);

  const customerId = searchParams.get('customer_id');
  const quoteIdFromQuery = searchParams.get('quote_id');
  const pageTab = getQuotePageTab(searchParams.get('tab'));
  const settingsParam = searchParams.get('settings') || 'notifications';
  const settingsTab: QuoteSettingsSubTab = isQuoteSettingsSubTab(settingsParam) ? settingsParam : 'notifications';
  const managerParam = searchParams.get('manager') || 'all';
  const currentQuotes = useMemo(() => quotes.filter((quote) => !isArchivedQuote(quote)), [quotes]);
  const archivedQuotes = useMemo(() => quotes.filter(isArchivedQuote), [quotes]);
  const currentManagerOptions = useMemo(
    () => buildQuoteManagerFilterOptions(currentQuotes, managerOptions),
    [currentQuotes, managerOptions]
  );
  const currentManagerIds = useMemo(
    () => new Set(currentManagerOptions.map(option => option.value)),
    [currentManagerOptions]
  );
  const archivedManagerOptions = useMemo(
    () => buildQuoteManagerFilterOptions(archivedQuotes, managerOptions),
    [archivedQuotes, managerOptions]
  );
  const archivedManagerIds = useMemo(
    () => new Set(archivedManagerOptions.map(option => option.value)),
    [archivedManagerOptions]
  );
  const legacyManagerOptions = useMemo<QuoteManagerFilterOption[]>(() => {
    const managers = new Map<string, string>();

    legacyQuotes.forEach((quote) => {
      const label = normalizeLegacyQuoteManagerName(quote.quote_manager_name);
      if (!label) return;
      managers.set(getLegacyQuoteManagerFilterValue(label), label);
    });

    return [...managers.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [legacyQuotes]);
  const legacyManagerIds = useMemo(
    () => new Set(legacyManagerOptions.map(option => option.value)),
    [legacyManagerOptions]
  );
  const currentManagerFilter = managerParam === 'all' || currentManagerIds.has(managerParam) ? managerParam : 'all';
  const archivedManagerFilter = managerParam === 'all' || archivedManagerIds.has(managerParam) ? managerParam : 'all';
  const legacyManagerFilter = managerParam === 'all' || legacyManagerIds.has(managerParam) ? managerParam : 'all';
  const canEditLegacyQuotes = isAdmin || isSuperAdmin || isActualSuperAdmin;

  const handleQuotesSensitiveAccessRequired = useCallback(async (toastId: string) => {
    await refreshSensitiveAccess();
    toast.info('Quotes locked. Enter your sensitive PIN to continue.', { id: toastId });
  }, [refreshSensitiveAccess]);

  const fetchData = useCallback(async () => {
    try {
      const url = customerId ? `/api/quotes?customer_id=${customerId}` : '/api/quotes';
      const [quotesResult, metadataRes] = await Promise.all([
        fetchAllPaginatedItems<Quote>(url, 'quotes', {
          limit: 250,
          errorMessage: 'Failed to load quotes',
        }),
        fetch('/api/quotes/metadata'),
      ]);

      setQuotes(quotesResult.items);
      if (!metadataRes.ok) {
        throw await buildResponseError(metadataRes, 'Failed to load quote metadata');
      }
      if (metadataRes.ok) {
        const data = await metadataRes.json();
        if (data.customers) {
          setCustomers(canViewCustomers ? data.customers || [] : []);
          setHasLoadedCustomers(canViewCustomers);
        }
        setManagerOptions(data.managerOptions || []);
        setApprovers(data.approvers || []);
      }
    } catch (error) {
      const errorContextId = 'quotes-fetch-data-error';
      if (getErrorStatus(error) === 428) {
        setQuotes([]);
        await handleQuotesSensitiveAccessRequired(errorContextId);
        return;
      }

      console.error('Error fetching data:', error, { errorContextId });
      toast.error('Unable to load quotes right now.', { id: errorContextId });
    } finally {
      setLoading(false);
    }
  }, [canViewCustomers, customerId, handleQuotesSensitiveAccessRequired]);

  const fetchLegacyQuotes = useCallback(async () => {
    setLegacyLoading(true);
    try {
      const legacyQuotesResult = await fetchAllPaginatedItems<LegacyQuote>('/api/quotes/legacy', 'legacy_quotes', {
        limit: 250,
        errorMessage: 'Failed to load legacy quotes',
      });
      setLegacyQuotes(legacyQuotesResult.items);
      setHasLoadedLegacyQuotes(true);
    } catch (error) {
      const errorContextId = 'quotes-fetch-legacy-error';
      if (getErrorStatus(error) === 428) {
        setLegacyQuotes([]);
        setHasLoadedLegacyQuotes(false);
        await handleQuotesSensitiveAccessRequired(errorContextId);
        return;
      }

      console.error('Error fetching legacy quotes:', error, { errorContextId });
      toast.error('Unable to load legacy quotes right now.', { id: errorContextId });
    } finally {
      setLegacyLoading(false);
    }
  }, [handleQuotesSensitiveAccessRequired]);

  const fetchProjectNumbers = useCallback(async () => {
    setProjectNumbersLoading(true);
    try {
      const projectNumbersRes = await fetch('/api/quotes/project-numbers');
      if (!projectNumbersRes.ok) {
        throw await buildResponseError(projectNumbersRes, 'Failed to load project numbers');
      }

      const projectNumbersPayload = await projectNumbersRes.json() as { project_numbers?: QuoteProjectNumber[] };
      setProjectNumbers(projectNumbersPayload.project_numbers || []);
      setHasLoadedProjectNumbers(true);
    } catch (error) {
      const errorContextId = 'quotes-fetch-project-numbers-error';
      if (getErrorStatus(error) === 428) {
        setProjectNumbers([]);
        setHasLoadedProjectNumbers(false);
        await handleQuotesSensitiveAccessRequired(errorContextId);
        return;
      }

      console.error('Error fetching quote project numbers:', error, { errorContextId });
      toast.error('Unable to load quote projects right now.', { id: errorContextId });
    } finally {
      setProjectNumbersLoading(false);
    }
  }, [handleQuotesSensitiveAccessRequired]);

  const fetchCustomers = useCallback(async () => {
    if (!canViewCustomers) return false;

    setCustomersLoading(true);
    try {
      const metadataRes = await fetch('/api/quotes/metadata?include_customers=true');
      if (!metadataRes.ok) {
        throw await buildResponseError(metadataRes, 'Failed to load customers');
      }

      const data = await metadataRes.json() as { customers?: CustomerOption[]; managerOptions?: QuoteManagerOption[]; approvers?: ApproverOption[] };
      setCustomers(data.customers || []);
      setManagerOptions(data.managerOptions || []);
      setApprovers(data.approvers || []);
      setHasLoadedCustomers(true);
      return true;
    } catch (error) {
      const errorContextId = 'quotes-fetch-customers-error';
      if (getErrorStatus(error) === 428) {
        setCustomers([]);
        setHasLoadedCustomers(false);
        await handleQuotesSensitiveAccessRequired(errorContextId);
        return false;
      }

      if (!isNetworkFetchError(error)) {
        console.error('Error fetching quote customers:', error, { errorContextId });
      }
      toast.error('Unable to load customers right now.', { id: errorContextId });
      return false;
    } finally {
      setCustomersLoading(false);
    }
  }, [canViewCustomers, handleQuotesSensitiveAccessRequired]);

  const refreshProjectNumbersTab = useCallback(async () => {
    await Promise.all([
      fetchData(),
      fetchProjectNumbers(),
    ]);
  }, [fetchData, fetchProjectNumbers]);

  useEffect(() => {
    if (permissionLoading || customerPermissionLoading || sensitiveAccess.loading) return;
    if (!canViewQuotes) {
      toast.error('You do not have access to quotes.', { id: 'quotes-access-denied' });
      router.push('/dashboard');
      return;
    }
    if (!sensitiveAccess.canAccess) return;
    fetchData();
  }, [permissionLoading, customerPermissionLoading, sensitiveAccess.loading, sensitiveAccess.canAccess, canViewQuotes, router, fetchData]);

  useEffect(() => {
    if (!sensitiveAccess.canAccess) return;
    if (pageTab === 'legacy' && !hasLoadedLegacyQuotes && !legacyLoading) {
      fetchLegacyQuotes();
    }
    if (pageTab === 'projects' && !hasLoadedProjectNumbers && !projectNumbersLoading) {
      fetchProjectNumbers();
    }
    if (pageTab === 'projects' && canViewCustomers && !hasLoadedCustomers && !customersLoading) {
      fetchCustomers();
    }
  }, [
    canViewCustomers,
    customersLoading,
    fetchLegacyQuotes,
    fetchCustomers,
    fetchProjectNumbers,
    hasLoadedCustomers,
    hasLoadedLegacyQuotes,
    hasLoadedProjectNumbers,
    legacyLoading,
    pageTab,
    projectNumbersLoading,
    sensitiveAccess.canAccess,
  ]);

  useEffect(() => {
    setDetailQuoteId(quoteIdFromQuery);
  }, [quoteIdFromQuery]);

  async function handleCreate(data: QuoteFormData) {
    const res = await fetch('/api/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildQuoteCreatePayload(data)),
    });
    if (!res.ok) {
      const err = await res.json();
      throw buildFormRequestError(err, 'Failed to create quote');
    }
    const payload = await res.json();
    await uploadClientQuoteAttachments(payload.quote.id, data.attachment_files);
    toast.success('Quote created');
    await fetchData();
  }

  async function handleUpdate(data: QuoteFormData) {
    if (!editingQuote) return;
    const res = await fetch(`/api/quotes/${editingQuote.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildQuoteCreatePayload(data)),
    });
    if (!res.ok) {
      const err = await res.json();
      throw buildFormRequestError(err, 'Failed to update quote');
    }
    await uploadClientQuoteAttachments(editingQuote.id, data.attachment_files);
    toast.success('Quote updated');
    setEditingQuote(null);
    await fetchData();
  }

  async function handleLegacyQuoteUpdate(quoteId: string, updates: LegacyQuoteEditForm) {
    const res = await fetch('/api/quotes/legacy', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: quoteId, ...updates }),
    });
    const payload = await res.json().catch(() => null) as { legacy_quote?: LegacyQuote; error?: string } | null;

    if (!res.ok) {
      throw new Error(payload?.error || 'Unable to update this legacy quote.');
    }
    if (!payload?.legacy_quote) {
      throw new Error('Legacy quote update returned no data.');
    }

    setLegacyQuotes((current) => current.map((quote) => (
      quote.id === payload.legacy_quote?.id ? payload.legacy_quote : quote
    )));
    toast.success('Legacy quote updated');
    return payload.legacy_quote;
  }

  async function handleCreateCustomerFromQuote(data: CustomerFormData) {
    const res = await fetch('/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => null) as { error?: string } | null;
      throw new Error(err?.error || 'Failed to create customer');
    }

    const payload = await res.json() as { customer?: { id?: string } };
    toast.success('Customer added');
    if (payload.customer?.id) setCreatedQuoteCustomerId(payload.customer.id);
    await fetchCustomers();
    await fetchData();
  }

  async function handleEditingQuoteAttachmentsChange(quoteId: string) {
    const res = await fetch(`/api/quotes/${quoteId}`);
    if (!res.ok) {
      const err = await res.json().catch(() => null) as { error?: string } | null;
      throw new Error(err?.error || 'Unable to refresh quote attachments.');
    }

    const payload = await res.json() as { quote: Quote };
    setEditingQuote(current => current?.id === quoteId ? payload.quote : current);
    await fetchData();
    return payload.quote;
  }

  async function handleSubmit(data: QuoteFormData, isEdit: boolean) {
    if (isEdit) {
      await handleUpdate(data);
    } else {
      await handleCreate(data);
    }
  }

  function handleOpenQuoteDetails(nextQuoteId: string) {
    setDetailQuoteId(nextQuoteId);
    syncQuoteQuery(nextQuoteId);
  }

  function handleCloseQuoteDetails() {
    setDetailQuoteId(null);
    syncQuoteQuery(null);
  }

  function handleRowClick(quote: Quote) {
    handleOpenQuoteDetails(quote.id);
  }

  async function handleEditFromModal(quote: Quote) {
    if (!hasLoadedCustomers) {
      const loaded = await fetchCustomers();
      if (!loaded) return;
    }
    setEditingQuote(quote);
    setFormOpen(true);
  }

  function handlePageTabChange(nextTab: QuotePageTab) {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('tab', nextTab);
    if (nextTab === 'settings') {
      nextParams.set('settings', settingsTab);
    } else {
      nextParams.delete('settings');
    }
    router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false });
  }

  function handleManagerFilterChange(nextManagerId: string, nextTab: Extract<QuotePageTab, 'current' | 'archived' | 'legacy'>) {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('tab', nextTab);
    nextParams.delete('settings');
    if (nextManagerId === 'all') {
      nextParams.delete('manager');
    } else {
      nextParams.set('manager', nextManagerId);
    }
    router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false });
  }

  function handleSettingsTabChange(nextTab: QuoteSettingsSubTab) {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('tab', 'settings');
    nextParams.set('settings', nextTab);
    router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false });
  }

  async function handleDeleteQuote(quote: Quote) {
    try {
      const res = await fetch(`/api/quotes/${quote.id}`, { method: 'DELETE' });
      if (!res.ok) {
        throw await buildResponseError(res, 'Unable to delete this quote right now.');
      }

      toast.success(`Quote ${quote.quote_reference} deleted`);
      if (detailQuoteId === quote.id) {
        handleCloseQuoteDetails();
      }
      await fetchData();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to delete this quote right now.';
      toast.error(message);
    }
  }

  if (permissionLoading || customerPermissionLoading || sensitiveAccess.loading || (sensitiveAccess.canAccess && loading)) {
    return <PageLoader message="Loading quotes..." />;
  }

  if (!canViewQuotes) {
    return <PageLoader message="Redirecting..." />;
  }

  if (!sensitiveAccess.canAccess) {
    return (
      <AppPageShell>
        <SensitiveModuleGate moduleLabel="Quotes" access={sensitiveAccess} />
      </AppPageShell>
    );
  }

  return (
    <AppPageShell>
      <SensitiveModuleSessionManager moduleLabel="Quotes" access={sensitiveAccess} />
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-border p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-yellow/10">
              <Receipt className="h-5 w-5 text-brand-yellow" />
            </div>
            <div className="min-w-0">
              <h1 className="text-3xl font-bold text-foreground">Quotes</h1>
              <p className="text-muted-foreground">
                {customerId ? 'Track and manage quotes for this customer.' : 'Create, review, and manage customer quotations.'}
              </p>
            </div>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              <Link href="/quotes/work-calendar" className="w-full sm:w-auto">
                <Button variant="outline" className="w-full border-border text-muted-foreground sm:w-auto">
                  <CalendarClock className="h-4 w-4 mr-2" />
                  Work Calendar
                </Button>
              </Link>
              <Button
                onClick={async () => {
                  if (!canViewCustomers) return;
                  if (!hasLoadedCustomers) {
                    const loaded = await fetchCustomers();
                    if (!loaded) return;
                  }
                  setEditingQuote(null);
                  setFormOpen(true);
                }}
                disabled={!canViewCustomers || customersLoading}
                aria-describedby={!canViewCustomers ? 'quotes-customer-access-note' : undefined}
                className="w-full bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90 font-semibold disabled:bg-slate-300 disabled:text-slate-600 dark:disabled:bg-slate-700 dark:disabled:text-slate-400 sm:w-auto"
              >
                <Plus className="h-4 w-4 mr-2" />
                {customersLoading ? 'Loading Customers...' : 'New Quote'}
              </Button>
            </div>
            {!canViewCustomers ? (
              <p id="quotes-customer-access-note" className="text-xs text-muted-foreground">
                Customer access is required to create quotes.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <Tabs
        value={pageTab}
        onValueChange={(value) => {
          if (isQuotePageTab(value)) handlePageTabChange(value);
        }}
      >
        <TabsList>
          <TabsTrigger value="overview" className="gap-2">
            <LayoutDashboard className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="current" className="gap-2">
            <Receipt className="h-4 w-4" />
            Current
          </TabsTrigger>
          <TabsTrigger value="projects" className="gap-2">
            <BriefcaseBusiness className="h-4 w-4" />
            Projects
          </TabsTrigger>
          <TabsTrigger value="archived" className="gap-2">
            <Archive className="h-4 w-4" />
            Archived
          </TabsTrigger>
          <TabsTrigger value="legacy" className="gap-2">
            <Receipt className="h-4 w-4" />
            Legacy
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2">
            <Settings className="h-4 w-4" />
            Settings
          </TabsTrigger>
        </TabsList>

        {pageTab === 'current' ? (
          <ManagerFilterTabs
            managerFilter={currentManagerFilter}
            managerOptions={currentManagerOptions}
            onManagerFilterChange={(nextManagerId) => handleManagerFilterChange(nextManagerId, 'current')}
          />
        ) : null}

        {pageTab === 'archived' ? (
          <ManagerFilterTabs
            managerFilter={archivedManagerFilter}
            managerOptions={archivedManagerOptions}
            onManagerFilterChange={(nextManagerId) => handleManagerFilterChange(nextManagerId, 'archived')}
          />
        ) : null}

        {pageTab === 'legacy' ? (
          <ManagerFilterTabs
            managerFilter={legacyManagerFilter}
            managerOptions={legacyManagerOptions}
            onManagerFilterChange={(nextManagerId) => handleManagerFilterChange(nextManagerId, 'legacy')}
          />
        ) : null}

        <TabsContent value="current" className="space-y-6 mt-0">
          <QuotesTable
            quotes={currentQuotes}
            onRowClick={handleRowClick}
            managerFilter={currentManagerFilter}
            emptyMessage="No current quotes yet. Create your first quote to get started."
          />
        </TabsContent>

        <TabsContent value="overview" className="space-y-6 mt-0">
          <QuotesOverviewTab />
        </TabsContent>

        <TabsContent value="archived" className="space-y-6 mt-0">
          <QuotesTable
            quotes={archivedQuotes}
            onRowClick={handleRowClick}
            managerFilter={archivedManagerFilter}
            emptyMessage="No archived quotes yet."
          />
        </TabsContent>

        <TabsContent value="legacy" className="space-y-6 mt-0">
          {legacyLoading && !hasLoadedLegacyQuotes ? (
            <QuoteTabLoader />
          ) : (
            <LegacyQuotesTable
              legacyQuotes={legacyQuotes}
              managerFilter={legacyManagerFilter}
              canEditLegacyQuotes={canEditLegacyQuotes}
              onLegacyQuoteUpdate={handleLegacyQuoteUpdate}
            />
          )}
        </TabsContent>

        <TabsContent value="projects" className="space-y-6 mt-0">
          {projectNumbersLoading && !hasLoadedProjectNumbers ? (
            <QuoteTabLoader />
          ) : (
            <ProjectNumbersTab
              projectNumbers={projectNumbers}
              managerOptions={managerOptions}
              quotes={quotes}
              customers={customers}
              canViewCustomers={canViewCustomers}
              onRefresh={refreshProjectNumbersTab}
              onOpenQuote={handleOpenQuoteDetails}
            />
          )}
        </TabsContent>

        <TabsContent value="settings" className="space-y-6 mt-0">
          <QuoteSettingsTab
            activeTab={settingsTab}
            onTabChange={handleSettingsTabChange}
            quotes={quotes}
            onDeleteQuote={handleDeleteQuote}
            onRefresh={fetchData}
          />
        </TabsContent>
      </Tabs>

      {detailQuoteId ? (
        <QuoteDetailsModal
          open
          onClose={handleCloseQuoteDetails}
          quoteId={detailQuoteId}
          onQuoteChange={handleOpenQuoteDetails}
          onEdit={handleEditFromModal}
          onRefresh={fetchData}
          managerOptions={managerOptions}
        />
      ) : null}

      {formOpen ? (
        <QuoteFormDialog
          open
          onClose={() => { setFormOpen(false); setEditingQuote(null); }}
          onSubmit={handleSubmit}
          onAttachmentsChange={handleEditingQuoteAttachmentsChange}
          quote={editingQuote}
          customers={customers}
          managerOptions={managerOptions}
          approvers={approvers}
          initialCustomerId={customerId}
          createdCustomerId={createdQuoteCustomerId}
          onCreatedCustomerApplied={() => setCreatedQuoteCustomerId(null)}
          onAddCustomer={() => setCustomerFormOpen(true)}
        />
      ) : null}

      {customerFormOpen ? (
        <CustomerFormDialog
          open
          onClose={() => setCustomerFormOpen(false)}
          onSubmit={handleCreateCustomerFromQuote}
        />
      ) : null}
    </AppPageShell>
  );
}
