import { getQuoteLocationSegment } from '@/lib/quotes/quote-display-name';
import type { Database } from '@/types/database';
import {
  normalizeExternalReference,
  type InventoryAdminClient,
  type InventoryLocationRow,
} from './inventory-locations';

type QuoteRow = Database['public']['Tables']['quotes']['Row'];
type QuoteProjectNumberRow = Database['public']['Tables']['quote_project_numbers']['Row'];

const OPERATIONAL_QUOTE_STATUSES = new Set<QuoteRow['status']>(['po_received', 'in_progress']);
const ARCHIVED_QUOTE_STATUSES = new Set<QuoteRow['status']>(['lost', 'closed']);

export interface SiteLocationSyncResult {
  action: 'created' | 'updated' | 'archived' | 'unchanged' | 'skipped';
  location_id: string | null;
  external_reference: string | null;
}

interface SiteLocationSyncInput {
  sourceType: 'quote' | 'project_number';
  sourceId: string;
  externalReference: string | null;
  name: string;
  description: string | null;
  isActive: boolean;
  actorUserId?: string | null;
}

function buildSiteLocationName(reference: string, label: string | null): string {
  return label?.trim() ? `Site - ${reference} - ${label.trim()}` : `Site - ${reference}`;
}

function buildQuoteSiteLabel(quote: Pick<QuoteRow, 'site_address' | 'subject_line'>): string | null {
  return getQuoteLocationSegment(quote.site_address) || quote.subject_line?.trim() || null;
}

function buildProjectSiteLabel(project: Pick<QuoteProjectNumberRow, 'title' | 'description'>): string | null {
  return project.title?.trim() || project.description?.trim() || null;
}

async function findSiteLocationByReference(
  admin: InventoryAdminClient,
  externalReference: string
): Promise<InventoryLocationRow | null> {
  const { data, error } = await admin
    .from('inventory_locations')
    .select('*')
    .eq('location_type', 'site')
    .eq('external_reference', externalReference)
    .order('is_active', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export function shouldQuoteHaveActiveSiteLocation(quote: Pick<QuoteRow, 'status' | 'commercial_status'>): boolean {
  return quote.commercial_status !== 'closed' && OPERATIONAL_QUOTE_STATUSES.has(quote.status);
}

export function shouldArchiveQuoteSiteLocation(quote: Pick<QuoteRow, 'status' | 'commercial_status'>): boolean {
  return quote.commercial_status === 'closed' || ARCHIVED_QUOTE_STATUSES.has(quote.status);
}

export async function syncSiteLocation(
  admin: InventoryAdminClient,
  input: SiteLocationSyncInput
): Promise<SiteLocationSyncResult> {
  const externalReference = normalizeExternalReference(input.externalReference);
  if (!externalReference) {
    return { action: 'skipped', location_id: null, external_reference: null };
  }

  const existingLocation = await findSiteLocationByReference(admin, externalReference);
  const now = new Date().toISOString();

  if (!input.isActive) {
    if (!existingLocation || !existingLocation.is_active) {
      return {
        action: existingLocation ? 'unchanged' : 'skipped',
        location_id: existingLocation?.id || null,
        external_reference: externalReference,
      };
    }

    const { data, error } = await admin
      .from('inventory_locations')
      .update({
        is_active: false,
        sync_status: 'archived',
        source_synced_at: now,
        updated_by: input.actorUserId || null,
      })
      .eq('id', existingLocation.id)
      .select('id')
      .single();

    if (error) throw error;
    return { action: 'archived', location_id: data.id, external_reference: externalReference };
  }

  const payload = {
    name: input.name,
    description: input.description,
    is_active: true,
    location_type: 'site' as const,
    source_type: input.sourceType,
    source_id: input.sourceId,
    external_reference: externalReference,
    sync_status: 'synced' as const,
    source_synced_at: now,
    linked_van_id: null,
    linked_hgv_id: null,
    linked_plant_id: null,
    updated_by: input.actorUserId || null,
  };

  if (existingLocation) {
    const shouldUpdate =
      existingLocation.name !== payload.name ||
      existingLocation.description !== payload.description ||
      existingLocation.is_active !== true ||
      existingLocation.source_type !== payload.source_type ||
      existingLocation.source_id !== payload.source_id ||
      existingLocation.sync_status !== payload.sync_status;

    if (!shouldUpdate) {
      return { action: 'unchanged', location_id: existingLocation.id, external_reference: externalReference };
    }

    const { data, error } = await admin
      .from('inventory_locations')
      .update(payload)
      .eq('id', existingLocation.id)
      .select('id')
      .single();

    if (error) throw error;
    return { action: 'updated', location_id: data.id, external_reference: externalReference };
  }

  const { data, error } = await admin
    .from('inventory_locations')
    .insert({
      ...payload,
      created_by: input.actorUserId || null,
    })
    .select('id')
    .single();

  if (error) throw error;
  return { action: 'created', location_id: data.id, external_reference: externalReference };
}

export async function syncQuoteSiteLocation(
  admin: InventoryAdminClient,
  quote: Pick<QuoteRow, 'id' | 'quote_reference' | 'base_quote_reference' | 'status' | 'commercial_status' | 'site_address' | 'subject_line'>,
  actorUserId?: string | null
): Promise<SiteLocationSyncResult> {
  const reference = normalizeExternalReference(quote.base_quote_reference || quote.quote_reference);
  const shouldBeActive = shouldQuoteHaveActiveSiteLocation(quote);
  const shouldArchive = shouldArchiveQuoteSiteLocation(quote);

  if (!shouldBeActive && !shouldArchive) {
    return { action: 'skipped', location_id: null, external_reference: reference };
  }

  return syncSiteLocation(admin, {
    sourceType: 'quote',
    sourceId: quote.id,
    externalReference: reference,
    name: buildSiteLocationName(reference || 'Quote', buildQuoteSiteLabel(quote)),
    description: quote.site_address?.trim() || quote.subject_line?.trim() || null,
    isActive: shouldBeActive,
    actorUserId,
  });
}

export async function syncProjectNumberSiteLocation(
  admin: InventoryAdminClient,
  project: Pick<QuoteProjectNumberRow, 'id' | 'project_reference' | 'status' | 'title' | 'description'>,
  actorUserId?: string | null
): Promise<SiteLocationSyncResult> {
  const reference = normalizeExternalReference(project.project_reference);
  const shouldBeActive = project.status === 'open';

  if (!shouldBeActive && project.status !== 'cancelled' && project.status !== 'converted') {
    return { action: 'skipped', location_id: null, external_reference: reference };
  }

  return syncSiteLocation(admin, {
    sourceType: 'project_number',
    sourceId: project.id,
    externalReference: reference,
    name: buildSiteLocationName(reference || 'Project', buildProjectSiteLabel(project)),
    description: project.description?.trim() || project.title?.trim() || null,
    isActive: shouldBeActive,
    actorUserId,
  });
}
