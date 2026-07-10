import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { CustomerContactRow } from '@/lib/server/customer-contacts';

export type QuoteCustomerContactRecipientInsert = Database['public']['Tables']['quote_customer_contact_recipients']['Insert'];

export function normalizeSecondaryContactIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.trim())
        .filter(Boolean)
    )
  );
}

export async function fetchQuoteSelectedSecondaryContacts(
  supabase: SupabaseClient<Database>,
  quoteId: string
): Promise<CustomerContactRow[]> {
  const { data: recipients, error: recipientsError } = await supabase
    .from('quote_customer_contact_recipients')
    .select('customer_contact_id')
    .eq('quote_id', quoteId);

  if (recipientsError) {
    throw recipientsError;
  }

  const contactIds = (recipients || []).map(recipient => recipient.customer_contact_id);
  if (contactIds.length === 0) {
    return [];
  }

  const { data: contacts, error: contactsError } = await supabase
    .from('customer_contacts')
    .select('*')
    .in('id', contactIds);

  if (contactsError) {
    throw contactsError;
  }

  const contactById = new Map((contacts || []).map(contact => [contact.id, contact]));
  return contactIds
    .map(contactId => contactById.get(contactId))
    .filter((contact): contact is CustomerContactRow => Boolean(contact));
}

export async function validateSecondaryContactIdsForCustomer(
  supabase: SupabaseClient<Database>,
  customerId: string,
  contactIds: string[]
): Promise<Record<string, string>> {
  if (contactIds.length === 0) {
    return {};
  }

  const { data, error } = await supabase
    .from('customer_contacts')
    .select('id')
    .eq('customer_id', customerId)
    .in('id', contactIds);

  if (error) {
    throw error;
  }

  const availableIds = new Set((data || []).map(contact => contact.id));
  const invalidIds = contactIds.filter(contactId => !availableIds.has(contactId));
  return invalidIds.length > 0
    ? { secondary_contact_ids: 'Select secondary contacts that belong to the selected customer.' }
    : {};
}

export async function replaceQuoteCustomerContactRecipients(
  supabase: SupabaseClient<Database>,
  quoteId: string,
  customerId: string,
  contactIds: string[],
  actorUserId: string
): Promise<Record<string, string>> {
  const fieldErrors = await validateSecondaryContactIdsForCustomer(supabase, customerId, contactIds);
  if (Object.keys(fieldErrors).length > 0) {
    return fieldErrors;
  }

  const { error: deleteError } = await supabase
    .from('quote_customer_contact_recipients')
    .delete()
    .eq('quote_id', quoteId);

  if (deleteError) {
    throw deleteError;
  }

  if (contactIds.length === 0) {
    return {};
  }

  const rows = contactIds.map(contactId => ({
    quote_id: quoteId,
    customer_contact_id: contactId,
    created_by: actorUserId,
  } satisfies QuoteCustomerContactRecipientInsert));

  const { error: insertError } = await supabase
    .from('quote_customer_contact_recipients')
    .insert(rows);

  if (insertError) {
    throw insertError;
  }

  return {};
}

export async function copyQuoteCustomerContactRecipients(
  supabase: SupabaseClient<Database>,
  quoteId: string,
  selectedContacts: CustomerContactRow[],
  actorUserId: string
): Promise<void> {
  if (selectedContacts.length === 0) {
    return;
  }

  const rows = selectedContacts.map(contact => ({
    quote_id: quoteId,
    customer_contact_id: contact.id,
    created_by: actorUserId,
  } satisfies QuoteCustomerContactRecipientInsert));

  const { error } = await supabase
    .from('quote_customer_contact_recipients')
    .insert(rows);

  if (error) {
    throw error;
  }
}
