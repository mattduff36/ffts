import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

export type CustomerSiteRow = Database['public']['Tables']['customer_sites']['Row'];
export type CustomerSiteInsert = Database['public']['Tables']['customer_sites']['Insert'];

export interface CustomerWithSites {
  sites: CustomerSiteRow[];
}

export interface NormalizedCustomerSite {
  id: string | null;
  site_name: string;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  county: string | null;
  postcode: string | null;
  is_active: boolean;
  is_default: boolean;
  notes: string | null;
}

export interface NormalizedCustomerSitesPayload {
  sites: NormalizedCustomerSite[];
  fieldErrors: Record<string, string>;
}

interface CustomerSiteAddress {
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  county: string | null;
  postcode: string | null;
}

interface ResolveCustomerSiteSelectionInput {
  customerId: string | null;
  customerSiteId: string | null;
  siteAddress: unknown;
  allowInactive?: boolean;
}

export interface ResolvedCustomerSiteSelection {
  customerSiteId: string | null;
  siteAddress: string | null;
  fieldErrors: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function hasStructuredAddress(site: CustomerSiteAddress): boolean {
  return Boolean(
    site.address_line_1
    || site.address_line_2
    || site.city
    || site.county
    || site.postcode
  );
}

export function formatCustomerSiteAddress(site: CustomerSiteAddress): string {
  return [
    site.address_line_1,
    site.address_line_2,
    [site.city, site.county].filter(Boolean).join(', ') || null,
    site.postcode,
  ]
    .filter(Boolean)
    .join('\n');
}

export function normalizeAddressSnapshot(value: unknown): string {
  return normalizeOptionalString(value)?.replace(/\s+/g, ' ').toLowerCase() || '';
}

export function normalizeCustomerSitesPayload(body: unknown): NormalizedCustomerSitesPayload {
  const raw = isRecord(body) && Array.isArray(body.sites) ? body.sites : [];
  const fieldErrors: Record<string, string> = {};
  const seenIds = new Set<string>();
  let defaultCount = 0;

  const sites = raw.flatMap((value, index): NormalizedCustomerSite[] => {
    if (!isRecord(value)) {
      fieldErrors[`sites.${index}`] = 'Enter valid site details.';
      return [];
    }

    const id = normalizeOptionalString(value.id);
    const siteName = normalizeOptionalString(value.site_name);
    const isActive = value.is_active !== false;
    const site: NormalizedCustomerSite = {
      id,
      site_name: siteName || '',
      address_line_1: normalizeOptionalString(value.address_line_1),
      address_line_2: normalizeOptionalString(value.address_line_2),
      city: normalizeOptionalString(value.city),
      county: normalizeOptionalString(value.county),
      postcode: normalizeOptionalString(value.postcode),
      is_active: isActive,
      is_default: isActive && value.is_default === true,
      notes: normalizeOptionalString(value.notes),
    };

    if (!siteName) {
      fieldErrors[`sites.${index}.site_name`] = 'Enter a site name.';
    }
    if (!hasStructuredAddress(site)) {
      fieldErrors[`sites.${index}.address_line_1`] = 'Enter at least one address field.';
    }
    if (id && seenIds.has(id)) {
      fieldErrors[`sites.${index}.id`] = 'This site is included more than once.';
    }
    if (id) seenIds.add(id);
    if (site.is_default) defaultCount += 1;

    return [site];
  });

  if (defaultCount > 1) {
    fieldErrors.sites = 'Choose only one default site.';
  }

  return { sites, fieldErrors };
}

export async function fetchCustomerSitesByCustomerId(
  supabase: SupabaseClient<Database>,
  customerIds: string[]
): Promise<Map<string, CustomerSiteRow[]>> {
  const uniqueCustomerIds = Array.from(new Set(customerIds.filter(Boolean)));
  const sitesByCustomerId = new Map<string, CustomerSiteRow[]>();
  if (uniqueCustomerIds.length === 0) return sitesByCustomerId;

  const { data, error } = await supabase
    .from('customer_sites')
    .select('*')
    .in('customer_id', uniqueCustomerIds)
    .order('is_default', { ascending: false })
    .order('site_name', { ascending: true });

  if (error) throw error;

  for (const site of data || []) {
    const sites = sitesByCustomerId.get(site.customer_id) || [];
    sites.push(site);
    sitesByCustomerId.set(site.customer_id, sites);
  }

  return sitesByCustomerId;
}

export function attachCustomerSites<T extends { id: string }>(
  customers: T[],
  sitesByCustomerId: Map<string, CustomerSiteRow[]>
): Array<T & CustomerWithSites> {
  return customers.map(customer => ({
    ...customer,
    sites: sitesByCustomerId.get(customer.id) || [],
  }));
}

export async function replaceCustomerSites(
  supabase: SupabaseClient<Database>,
  customerId: string,
  sites: NormalizedCustomerSite[],
  actorUserId: string
): Promise<void> {
  const { data: existingSites, error: existingError } = await supabase
    .from('customer_sites')
    .select('id')
    .eq('customer_id', customerId);

  if (existingError) throw existingError;

  const existingIds = new Set((existingSites || []).map(site => site.id));
  const invalidSite = sites.find(site => site.id && !existingIds.has(site.id));
  if (invalidSite) {
    throw new Error('A customer site does not belong to this customer.');
  }

  const requestedDefault = sites.find(site => site.is_default);
  if (requestedDefault) {
    const { error: clearDefaultError } = await supabase
      .from('customer_sites')
      .update({ is_default: false, updated_by: actorUserId })
      .eq('customer_id', customerId)
      .eq('is_default', true);

    if (clearDefaultError) throw clearDefaultError;
  }

  for (const site of sites) {
    const payload = {
      customer_id: customerId,
      site_name: site.site_name,
      address_line_1: site.address_line_1,
      address_line_2: site.address_line_2,
      city: site.city,
      county: site.county,
      postcode: site.postcode,
      is_active: site.is_active,
      is_default: site.is_default,
      notes: site.notes,
      updated_by: actorUserId,
    };

    if (site.id) {
      const { error: updateError } = await supabase
        .from('customer_sites')
        .update(payload)
        .eq('id', site.id)
        .eq('customer_id', customerId);

      if (updateError) throw updateError;
      continue;
    }

    const { error: insertError } = await supabase
      .from('customer_sites')
      .insert({
        ...payload,
        created_by: actorUserId,
      } satisfies CustomerSiteInsert);

    if (insertError) throw insertError;
  }
}

export async function resolveCustomerSiteSelection(
  supabase: SupabaseClient<Database>,
  input: ResolveCustomerSiteSelectionInput
): Promise<ResolvedCustomerSiteSelection> {
  const snapshot = normalizeOptionalString(input.siteAddress);
  if (!input.customerSiteId) {
    return {
      customerSiteId: null,
      siteAddress: snapshot,
      fieldErrors: {},
    };
  }

  if (!input.customerId) {
    return {
      customerSiteId: null,
      siteAddress: snapshot,
      fieldErrors: { customer_site_id: 'Select a customer before selecting a site.' },
    };
  }

  const { data: site, error } = await supabase
    .from('customer_sites')
    .select('id, customer_id, address_line_1, address_line_2, city, county, postcode, is_active')
    .eq('id', input.customerSiteId)
    .eq('customer_id', input.customerId)
    .maybeSingle();

  if (error) throw error;
  if (!site) {
    return {
      customerSiteId: null,
      siteAddress: snapshot,
      fieldErrors: { customer_site_id: 'Select a site that belongs to this customer.' },
    };
  }
  if (!site.is_active && !input.allowInactive) {
    return {
      customerSiteId: null,
      siteAddress: snapshot,
      fieldErrors: { customer_site_id: 'Select an active customer site.' },
    };
  }

  return {
    customerSiteId: site.id,
    siteAddress: snapshot || formatCustomerSiteAddress(site),
    fieldErrors: {},
  };
}
