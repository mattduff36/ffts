import type { Customer } from '@/app/(dashboard)/customers/types';
import type { Quote } from '@/app/(dashboard)/quotes/types';
const userId = '33333333-3333-4333-8333-333333333333';
const date = '2026-11-05';
const now = `${date}T08:00:00.000Z`;
export const customerFixture: Customer = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', company_name: 'Fictional Customer',
  short_name: null, contact_name: 'Fictional Contact', contact_email: 'contact@ffts.test', contact_phone: '00000 000000', contact_job_title: 'Test coordinator',
  address_line_1: '1 Fictional Lane', address_line_2: null, city: 'Test Town', county: null, postcode: 'ZZ99 1ZZ',
  payment_terms_days: 30, default_validity_days: 30, status: 'active', notes: null,
  created_at: now, updated_at: now, created_by: userId, updated_by: userId, secondary_contacts: [], sites: [],
};

export const quoteFixture: Quote = {
  id: '99999999-9999-4999-8999-999999999991', quote_reference: 'LOCAL-Q-1', base_quote_reference: 'LOCAL-Q-1',
  quote_thread_id: '99999999-9999-4999-8999-999999999991', parent_quote_id: null, customer_id: customerFixture.id,
  customer_site_id: null, requester_id: userId, requester_initials: 'ST', quote_date: date,
  attention_name: 'Fictional Contact', attention_email: 'contact@ffts.test', subject_line: 'Fictional quote works',
  project_description: 'Fictional pruning', scope: 'Fictional scope', salutation: 'Dear Contact,', site_address: '1 Fictional Lane',
  validity_days: 30, subtotal: 100, total: 100, pricing_mode: 'itemized', status: 'draft', accepted: false,
  po_number: null, po_received_at: null, po_value: null, started: false, start_date: null, start_alert_days: null,
  start_alert_sent_at: null, estimated_duration_days: 1, estimated_duration_minutes: 60, required_staff_count: 2,
  invoice_number: null, invoice_notes: null, last_invoice_at: null, signoff_name: 'Sample Manager', signoff_title: 'Manager', custom_footer_text: null,
  revision_number: 0, revision_type: 'original', version_label: null, version_notes: null, is_latest_version: true,
  duplicate_source_quote_id: null, manager_name: 'Sample Manager', manager_email: 'manager@ffts.test', approver_profile_id: userId,
  approved_by: null, approved_at: null, returned_at: null, return_comments: null, customer_sent_at: null, customer_sent_by: null,
  completion_status: 'not_completed', completion_comments: null, commercial_status: 'open', closed_at: null, rams_requested_at: null,
  created_at: now, updated_at: now, created_by: userId, updated_by: userId, sent_at: null, accepted_at: null, invoiced_at: null,
  sage_posted_at: null, sage_posted_by: null, customer: customerFixture,
  line_items: [{ description: 'Fictional work', quantity: 1, unit: 'item', unit_rate: 100, line_total: 100, sort_order: 0 }],
  attachments: [], invoices: [], invoice_requests: [], versions: [], timeline: [],
};

export function createPanelFixture() {
  const customers = [structuredClone(customerFixture)];
  const quotes = [structuredClone(quoteFixture)];
  const reads: string[] = [];
  const writes: string[] = [];
  const locked = new Set<string>();
  const expiries = new Map<string, string>();
  let failSaves = false;
  let failReads = false;
  let revision = 0;
  const updatedAt = () => new Date(new Date(now).getTime() + ++revision * 1000).toISOString();
  function respond(url: URL, method: string, body?: Record<string, unknown>) {
    const path = url.pathname;
    if (!path.startsWith('/api/customers') && !path.startsWith('/api/quotes') && !path.startsWith('/api/sensitive-access')) return null;
    (method === 'GET' ? reads : writes).push(`${method} ${path}`);
    const panelModule = path.startsWith('/api/customers') ? 'customers' : 'quotes';
    if (path === '/api/sensitive-access/status') {
      const name = url.searchParams.get('module') || 'quotes';
      return { status: 200, json: { state: {
        module_name: name, required: locked.has(name) || expiries.has(name), unlocked: !locked.has(name), expires_at: expiries.get(name) || null,
        pin_status: { configured: true, pin_length: 4, must_reset: false, locked_until: null },
      } } };
    }
    if (path.startsWith('/api/sensitive-access')) return { status: 403, json: { error: 'Unlock is disabled in this fixture.' } };
    if (locked.has(panelModule)) return { status: 428, json: { error: `${panelModule} locked by fixture` } };
    if (method !== 'GET' && failSaves) return { status: 500, json: { error: 'Fictional save failure' } };
    if (method === 'GET' && failReads && path !== '/api/quotes/metadata') return { status: 503, json: { error: 'Fictional refresh failure' } };
    if (path === '/api/quotes/metadata') return { status: 200, json: {
      managerOptions: [{ profile_id: userId, initials: 'ST', is_active: true, next_number: 2, number_start: 1, profile: { id: userId, full_name: 'Sample Manager', email: 'manager@ffts.test' } }],
      approvers: [],
    } };
    const collection = panelModule === 'customers' ? customers : quotes;
    const singular = panelModule === 'customers' ? 'customer' : 'quote';
    const id = path.split('/')[3];
    const item = collection.find(item => item.id === id);
    if (path.endsWith('/sites') && method === 'POST' && item && 'sites' in item) {
      const input = (body?.sites as Record<string, unknown>[])[0];
      const site = { ...input, id: crypto.randomUUID(), customer_id: id, is_active: true, is_default: !item.sites.length, created_at: updatedAt(), updated_at: updatedAt(), created_by: userId, updated_by: userId };
      Object.assign(item, { sites: [site, ...item.sites] });
      return { status: 201, json: { site } };
    }
    if (!id && method === 'GET') return { status: 200, json: { [panelModule]: collection.filter(item => panelModule !== 'quotes' || !url.searchParams.get('customer_id') || ('customer_id' in item && item.customer_id === url.searchParams.get('customer_id'))) } };
    if (method === 'GET' && item) return { status: 200, json: { [singular]: item } };
    if (method === 'POST' && !id) {
      const created = { ...structuredClone(panelModule === 'customers' ? customerFixture : quoteFixture), ...body, id: crypto.randomUUID(), updated_at: updatedAt() };
      if (panelModule === 'customers') customers.unshift(created as Customer);
      else quotes.unshift({ ...created, quote_reference: `LOCAL-Q-${quotes.length + 1}`, base_quote_reference: `LOCAL-Q-${quotes.length + 1}` } as Quote);
      return { status: 201, json: { [singular]: collection[0] } };
    }
    if (method === 'PATCH' && item) {
      Object.assign(item, body, { updated_at: updatedAt() });
      if (body?.action === 'mark_as_sent') Object.assign(item, { status: 'sent' });
      if (body?.action === 'mark_as_accepted') Object.assign(item, { status: 'po_received' });
      if (body?.action === 'toggle_closed' && 'commercial_status' in item) Object.assign(item, { commercial_status: item.commercial_status === 'closed' ? 'open' : 'closed' });
      return { status: 200, json: { [singular]: item } };
    }
    return { status: 501, json: { error: `Unconfigured panel fixture: ${method} ${path}` } };
  }
  return { customers, quotes, reads, writes, locked, expiries, respond, setFailSaves: (value: boolean) => { failSaves = value; }, setFailReads: (value: boolean) => { failReads = value; } };
}
