import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

export type CustomerRow = Database['public']['Tables']['customers']['Row'];
export type CustomerContactRow = Database['public']['Tables']['customer_contacts']['Row'];
export type CustomerContactInsert = Database['public']['Tables']['customer_contacts']['Insert'];

export interface CustomerWithSecondaryContacts extends CustomerRow {
  secondary_contacts: CustomerContactRow[];
}

export interface NormalizedCustomerContact {
  id: string | null;
  name: string | null;
  job_title: string | null;
  email: string | null;
  phone: string | null;
}

export interface NormalizedCustomerPayload {
  customer: Database['public']['Tables']['customers']['Insert'];
  secondaryContacts: NormalizedCustomerContact[];
  fieldErrors: Record<string, string>;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeInteger(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function normalizeStatus(value: unknown): 'active' | 'inactive' {
  return value === 'inactive' ? 'inactive' : 'active';
}

function hasContactValue(contact: NormalizedCustomerContact): boolean {
  return Boolean(contact.name || contact.job_title || contact.email || contact.phone);
}

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value);
}

export function normalizeCustomerPayload(body: unknown): NormalizedCustomerPayload {
  const raw = isRecord(body) ? body : {};
  const fieldErrors: Record<string, string> = {};
  const companyName = normalizeOptionalString(raw.company_name);
  const primaryEmail = normalizeOptionalString(raw.contact_email);

  if (!companyName) {
    fieldErrors.company_name = 'Enter a company name.';
  }

  if (primaryEmail && !isValidEmail(primaryEmail)) {
    fieldErrors.contact_email = 'Enter a valid primary contact email.';
  }

  const rawSecondaryContacts = Array.isArray(raw.secondary_contacts)
    ? raw.secondary_contacts
    : [];

  const secondaryContacts = rawSecondaryContacts
    .map((value, index): NormalizedCustomerContact | null => {
      if (!isRecord(value)) {
        return null;
      }

      const contact = {
        id: normalizeOptionalString(value.id),
        name: normalizeOptionalString(value.name),
        job_title: normalizeOptionalString(value.job_title),
        email: normalizeOptionalString(value.email),
        phone: normalizeOptionalString(value.phone),
      };

      if (!hasContactValue(contact)) {
        return null;
      }

      if (contact.email && !isValidEmail(contact.email)) {
        fieldErrors[`secondary_contacts.${index}.email`] = 'Enter a valid secondary contact email.';
      }

      return contact;
    })
    .filter((contact): contact is NormalizedCustomerContact => Boolean(contact));

  return {
    customer: {
      company_name: companyName || '',
      short_name: normalizeOptionalString(raw.short_name),
      contact_name: normalizeOptionalString(raw.contact_name),
      contact_email: primaryEmail,
      contact_phone: normalizeOptionalString(raw.contact_phone),
      contact_job_title: normalizeOptionalString(raw.contact_job_title),
      address_line_1: normalizeOptionalString(raw.address_line_1),
      address_line_2: normalizeOptionalString(raw.address_line_2),
      city: normalizeOptionalString(raw.city),
      county: normalizeOptionalString(raw.county),
      postcode: normalizeOptionalString(raw.postcode),
      payment_terms_days: normalizeInteger(raw.payment_terms_days, 30),
      default_validity_days: normalizeInteger(raw.default_validity_days, 30),
      status: normalizeStatus(raw.status),
      notes: normalizeOptionalString(raw.notes),
    },
    secondaryContacts,
    fieldErrors,
  };
}

export async function fetchSecondaryContactsByCustomerId(
  supabase: SupabaseClient<Database>,
  customerIds: string[]
): Promise<Map<string, CustomerContactRow[]>> {
  const uniqueCustomerIds = Array.from(new Set(customerIds.filter(Boolean)));
  const contactsByCustomerId = new Map<string, CustomerContactRow[]>();
  if (uniqueCustomerIds.length === 0) {
    return contactsByCustomerId;
  }

  const { data, error } = await supabase
    .from('customer_contacts')
    .select('*')
    .in('customer_id', uniqueCustomerIds)
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  for (const contact of data || []) {
    const contacts = contactsByCustomerId.get(contact.customer_id) || [];
    contacts.push(contact);
    contactsByCustomerId.set(contact.customer_id, contacts);
  }

  return contactsByCustomerId;
}

export function attachSecondaryContacts<T extends CustomerRow>(
  customers: T[],
  contactsByCustomerId: Map<string, CustomerContactRow[]>
): Array<T & { secondary_contacts: CustomerContactRow[] }> {
  return customers.map(customer => ({
    ...customer,
    secondary_contacts: contactsByCustomerId.get(customer.id) || [],
  }));
}

export async function replaceCustomerSecondaryContacts(
  supabase: SupabaseClient<Database>,
  customerId: string,
  contacts: NormalizedCustomerContact[],
  actorUserId: string
): Promise<void> {
  const { data: existingContacts, error: existingError } = await supabase
    .from('customer_contacts')
    .select('id')
    .eq('customer_id', customerId);

  if (existingError) {
    throw existingError;
  }

  const requestedExistingIds = new Set(contacts.map(contact => contact.id).filter((id): id is string => Boolean(id)));
  const deleteIds = (existingContacts || [])
    .map(contact => contact.id)
    .filter(id => !requestedExistingIds.has(id));

  if (deleteIds.length > 0) {
    const { error: deleteError } = await supabase
      .from('customer_contacts')
      .delete()
      .in('id', deleteIds);

    if (deleteError) {
      throw deleteError;
    }
  }

  for (const contact of contacts) {
    const payload = {
      customer_id: customerId,
      name: contact.name,
      job_title: contact.job_title,
      email: contact.email,
      phone: contact.phone,
      updated_by: actorUserId,
    };

    if (contact.id) {
      const { error: updateError } = await supabase
        .from('customer_contacts')
        .update(payload)
        .eq('id', contact.id)
        .eq('customer_id', customerId);

      if (updateError) {
        throw updateError;
      }
      continue;
    }

    const { error: insertError } = await supabase
      .from('customer_contacts')
      .insert({
        ...payload,
        created_by: actorUserId,
      } satisfies CustomerContactInsert);

    if (insertError) {
      throw insertError;
    }
  }
}
