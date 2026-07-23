import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { addDays, format, startOfWeek } from 'date-fns';
import pg, { type Client } from 'pg';

const { Client: PgClient } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const FIXTURE_KEY = 'scheduling-sample-v1';
const CONFIRMATION = '--confirm-production=FFTS_SCHEDULING_SAMPLE';
const SAMPLE_EMAIL = 'scheduling-sample-v1@example.test';
const SAMPLE_INITIALS = 'SD';
const SAMPLE_NUMBER_START = 99000;
const QUOTE_COUNT = 22;
const QUEUE_SAMPLE_NUMBER_START = SAMPLE_NUMBER_START + QUOTE_COUNT;
const QUEUE_QUOTE_COUNT = 12;

type Mode = 'plan' | 'apply' | 'cleanup' | 'queue-plan' | 'queue-apply';

interface VisitDefinition {
  date: string;
  startsAt: string;
  endsAt: string;
  title: string;
}

interface QuoteDefinition {
  id: string;
  customerIndex: number;
  reference: string;
  title: string;
  siteAddress: string;
  startDate: string;
  estimatedDays: number;
  estimatedMinutes: number;
  status: 'po_received' | 'in_progress';
  visits: VisitDefinition[];
}

type QueueQuoteStatus =
  | 'draft'
  | 'changes_requested'
  | 'pending_internal_approval'
  | 'approved'
  | 'sent'
  | 'won'
  | 'po_received'
  | 'in_progress';

interface QueueQuoteDefinition {
  id: string;
  customerIndex: number;
  reference: string;
  title: string;
  siteAddress: string;
  startDate: string | null;
  estimatedDays: number;
  estimatedMinutes: number;
  status: QueueQuoteStatus;
  visits: VisitDefinition[];
}

interface SampleManifest {
  fixture_key: string;
  project_ref: string;
  profile_email: string;
  series: {
    initials: string;
    number_start: number;
    next_number: number;
  };
  date_window: { start: string; end: string };
  counts: { customers: number; quotes: number; visits: number; assignments: number };
  quotes: Array<{
    reference: string;
    start_date: string;
    estimated_days: number;
    estimated_minutes: number;
    visit_count: number;
  }>;
}

interface QueueSampleManifest {
  fixture_key: string;
  project_ref: string;
  profile_email: string;
  series: {
    initials: string;
    number_start: number;
    next_number: number;
  };
  date_window: { start: string; end: string };
  counts: {
    customers: number;
    quotes: number;
    jobs: number;
    visits: number;
    assignments: number;
  };
  unscheduled_status_counts: { draft: number; pending: number; accepted: number };
  quotes: Array<{
    reference: string;
    status: QueueQuoteStatus;
    start_date: string | null;
    estimated_days: number;
    visit_count: number;
  }>;
}

function requiredEnvironment() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  const allowedProjectRef = process.env.SCHEDULING_SAMPLE_PRODUCTION_PROJECT_REF;
  if (!supabaseUrl || !serviceRoleKey || !connectionString || !allowedProjectRef) {
    throw new Error(
      'Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, POSTGRES_URL_NON_POOLING, and SCHEDULING_SAMPLE_PRODUCTION_PROJECT_REF.'
    );
  }
  const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
  if (projectRef !== allowedProjectRef || !connectionString.includes(allowedProjectRef)) {
    throw new Error('Configured Supabase URL and database do not match the explicitly allowed production project.');
  }
  return { supabaseUrl, serviceRoleKey, connectionString, projectRef };
}

function londonOffsetFor(date: string): string {
  const utcNoon = new Date(`${date}T12:00:00.000Z`);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(utcNoon);
  const localHour = Number(parts.find((part) => part.type === 'hour')?.value || 12);
  const offset = localHour - 12;
  const sign = offset >= 0 ? '+' : '-';
  return `${sign}${String(Math.abs(offset)).padStart(2, '0')}:00`;
}

function localDateTime(date: string, hour: number, minute = 0): string {
  return `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00${londonOffsetFor(date)}`;
}

function buildVisit(date: string, startHour: number, durationHours: number, title: string): VisitDefinition {
  const endMinutes = startHour * 60 + durationHours * 60;
  return {
    date,
    startsAt: localDateTime(date, startHour),
    endsAt: localDateTime(date, Math.floor(endMinutes / 60), endMinutes % 60),
    title,
  };
}

export function buildFixtureDefinitions(today = new Date()): {
  windowStart: string;
  windowEnd: string;
  customers: Array<{ companyName: string; contactName: string; city: string; postcode: string }>;
  quotes: QuoteDefinition[];
} {
  const monday = startOfWeek(today, { weekStartsOn: 1 });
  const windowStart = format(monday, 'yyyy-MM-dd');
  const windowEnd = format(addDays(monday, 27), 'yyyy-MM-dd');
  const customers = [
    { companyName: 'Northbridge Community Gardens', contactName: 'Alex Rowan', city: 'Northbridge', postcode: 'NB1 1AA' },
    { companyName: 'Willowmere Estate Services', contactName: 'Jamie Brook', city: 'Willowmere', postcode: 'WM2 2BB' },
    { companyName: 'Meadowgate Primary Trust', contactName: 'Taylor Finch', city: 'Meadowgate', postcode: 'MG3 3CC' },
    { companyName: 'Cedar Vale Property Group', contactName: 'Morgan Ash', city: 'Cedar Vale', postcode: 'CV4 4DD' },
    { companyName: 'Riverside Habitat Partnership', contactName: 'Casey Reed', city: 'Riverside', postcode: 'RS5 5EE' },
  ];
  const titles = [
    'Crown lift and deadwood removal',
    'Boundary hedge reduction',
    'Ash condition inspection',
    'Storm-damaged limb removal',
    'Woodland path clearance',
    'Young tree formative pruning',
    'Oak canopy reduction',
    'Site tree safety survey',
    'Poplar pollard programme',
    'Stump grinding works',
    'Veteran tree inspection',
    'Estate-wide tree maintenance',
    'Conifer dismantle',
    'School grounds pruning',
    'Riverbank vegetation clearance',
    'Tree planting preparation',
    'Cedar crown thinning',
    'Large woodland management project',
    'Roadside clearance',
    'Habitat pile creation',
    'Elm sanitation works',
    'Post-work site inspection',
  ];
  const singleHours = [2, 4, 1, 6, 3, 5];
  const quotes: QuoteDefinition[] = titles.map((title, index) => {
    const weekIndex = Math.floor(index / 6);
    const dayIndex = index % 5;
    const start = addDays(monday, weekIndex * 7 + dayIndex);
    const startDate = format(start, 'yyyy-MM-dd');
    const isLarge = index === 0 || index === 17;
    const isRepeat = [4, 8, 16].includes(index);
    let visits: VisitDefinition[];
    let estimatedDays = 1;
    if (isLarge) {
      estimatedDays = 5;
      visits = Array.from({ length: 5 }, (_, visitIndex) => {
        const date = format(addDays(start, visitIndex), 'yyyy-MM-dd');
        return buildVisit(date, 8, 8, `${title} — phase ${visitIndex + 1}`);
      });
    } else if (isRepeat) {
      estimatedDays = 5;
      visits = [0, 2, 4].map((offset, visitIndex) => {
        const date = format(addDays(start, offset), 'yyyy-MM-dd');
        return buildVisit(date, 9, 3, `${title} — visit ${visitIndex + 1}`);
      });
    } else {
      const hours = singleHours[index % singleHours.length];
      visits = [buildVisit(startDate, index % 2 === 0 ? 8 : 10, hours, title)];
    }
    return {
      id: randomUUID(),
      customerIndex: index % customers.length,
      reference: `${SAMPLE_NUMBER_START + index}-${SAMPLE_INITIALS}`,
      title,
      siteAddress: `${10 + index} Sample Lane, ${customers[index % customers.length].city}`,
      startDate,
      estimatedDays,
      estimatedMinutes: visits.reduce(
        (total, visit) => total + (new Date(visit.endsAt).getTime() - new Date(visit.startsAt).getTime()) / 60_000,
        0
      ),
      status: index % 4 === 0 ? 'in_progress' : 'po_received',
      visits,
    };
  });
  return { windowStart, windowEnd, customers, quotes };
}

export function createManifest(projectRef: string): SampleManifest {
  const fixture = buildFixtureDefinitions();
  return {
    fixture_key: FIXTURE_KEY,
    project_ref: projectRef,
    profile_email: SAMPLE_EMAIL,
    series: {
      initials: SAMPLE_INITIALS,
      number_start: SAMPLE_NUMBER_START,
      next_number: SAMPLE_NUMBER_START + QUOTE_COUNT,
    },
    date_window: { start: fixture.windowStart, end: fixture.windowEnd },
    counts: {
      customers: fixture.customers.length,
      quotes: fixture.quotes.length,
      visits: fixture.quotes.reduce((total, quote) => total + quote.visits.length, 0),
      assignments: 0,
    },
    quotes: fixture.quotes.map((quote) => ({
      reference: quote.reference,
      start_date: quote.startDate,
      estimated_days: quote.estimatedDays,
      estimated_minutes: quote.estimatedMinutes,
      visit_count: quote.visits.length,
    })),
  };
}

export function buildQueueFixtureDefinitions(today = new Date()): {
  windowStart: string;
  windowEnd: string;
  quotes: QueueQuoteDefinition[];
} {
  const monday = startOfWeek(today, { weekStartsOn: 1 });
  const windowStart = format(monday, 'yyyy-MM-dd');
  const windowEnd = format(addDays(monday, 6), 'yyyy-MM-dd');
  const statuses: QueueQuoteStatus[] = [
    'draft',
    'changes_requested',
    'draft',
    'pending_internal_approval',
    'approved',
    'sent',
    'won',
    'po_received',
    'in_progress',
    'po_received',
    'in_progress',
    'po_received',
  ];
  const titles = [
    'Unpriced emergency call-out',
    'Revised woodland clearance',
    'Draft estate inspection',
    'Awaiting internal tree survey approval',
    'Approved roadside pruning proposal',
    'Confirmed school grounds works',
    'Won habitat improvement project',
    'Accepted veteran oak inspection',
    'Urgent ash dieback response',
    'Scheduled avenue crown lifting',
    'Scheduled storm damage clearance',
    'Scheduled hedge reduction programme',
  ];
  const quotes = titles.map((title, index): QueueQuoteDefinition => {
    const isScheduled = index >= 9;
    const startDate = isScheduled
      ? format(addDays(monday, index - 9), 'yyyy-MM-dd')
      : null;
    const estimatedDays = (index % 3) + 1;
    const visits = startDate
      ? [buildVisit(startDate, 8 + (index - 9), 4 + (index % 2), title)]
      : [];
    return {
      id: randomUUID(),
      customerIndex: index % 5,
      reference: `${QUEUE_SAMPLE_NUMBER_START + index}-${SAMPLE_INITIALS}`,
      title,
      siteAddress: `${40 + index} Queue Test Road`,
      startDate,
      estimatedDays,
      estimatedMinutes: visits.length > 0
        ? visits.reduce(
            (total, visit) =>
              total
              + (new Date(visit.endsAt).getTime() - new Date(visit.startsAt).getTime())
                / 60_000,
            0
          )
        : estimatedDays * 360,
      status: statuses[index],
      visits,
    };
  });
  return { windowStart, windowEnd, quotes };
}

export function createQueueManifest(projectRef: string): QueueSampleManifest {
  const fixture = buildQueueFixtureDefinitions();
  return {
    fixture_key: FIXTURE_KEY,
    project_ref: projectRef,
    profile_email: SAMPLE_EMAIL,
    series: {
      initials: SAMPLE_INITIALS,
      number_start: QUEUE_SAMPLE_NUMBER_START,
      next_number: QUEUE_SAMPLE_NUMBER_START + QUEUE_QUOTE_COUNT,
    },
    date_window: { start: fixture.windowStart, end: fixture.windowEnd },
    counts: {
      customers: 0,
      quotes: fixture.quotes.length,
      jobs: fixture.quotes.filter((quote) => quote.startDate).length,
      visits: fixture.quotes.reduce((total, quote) => total + quote.visits.length, 0),
      assignments: 0,
    },
    unscheduled_status_counts: {
      draft: fixture.quotes.filter((quote) =>
        !quote.startDate && ['draft', 'changes_requested'].includes(quote.status)
      ).length,
      pending: fixture.quotes.filter((quote) =>
        !quote.startDate
        && ['pending_internal_approval', 'approved', 'sent'].includes(quote.status)
      ).length,
      accepted: fixture.quotes.filter((quote) =>
        !quote.startDate && ['won', 'po_received', 'in_progress'].includes(quote.status)
      ).length,
    },
    quotes: fixture.quotes.map((quote) => ({
      reference: quote.reference,
      status: quote.status,
      start_date: quote.startDate,
      estimated_days: quote.estimatedDays,
      visit_count: quote.visits.length,
    })),
  };
}

function createPgClient(connectionString: string): Client {
  const url = new URL(connectionString);
  return new PgClient({
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false },
  });
}

async function assertSchema(client: Client) {
  const result = await client.query<{
    visits_table: string | null;
    quote_minutes: string | null;
    assignment_visit: string | null;
    sync_trigger: string | null;
  }>(`
    SELECT
      to_regclass('public.schedule_visits')::text AS visits_table,
      (
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'quotes'
          AND column_name = 'estimated_duration_minutes'
      ) AS quote_minutes,
      (
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'schedule_employee_assignments'
          AND column_name = 'visit_id'
      ) AS assignment_visit,
      (
        SELECT trigger_name FROM information_schema.triggers
        WHERE event_object_schema = 'public' AND event_object_table = 'quotes'
          AND trigger_name = 'sync_operational_quote_schedule_job_trigger'
        LIMIT 1
      ) AS sync_trigger
  `);
  const schema = result.rows[0];
  if (
    schema?.visits_table !== 'schedule_visits'
    || schema.quote_minutes !== 'estimated_duration_minutes'
    || schema.assignment_visit !== 'visit_id'
    || schema.sync_trigger !== 'sync_operational_quote_schedule_job_trigger'
  ) {
    throw new Error('Timed scheduling schema is not ready. Run npm run scheduling:migrate:visits first.');
  }
}

async function collisionCounts(client: Client) {
  const result = await client.query<{
    profiles: string;
    series: string;
    series_range: string;
    customers: string;
    quotes: string;
  }>(
    `
      SELECT
        (SELECT COUNT(*)::text FROM public.profiles WHERE placeholder_key = $1) AS profiles,
        (SELECT COUNT(*)::text FROM public.quote_manager_series WHERE initials = $2) AS series,
        (
          SELECT COUNT(*)::text FROM public.quote_manager_series
          WHERE number_start <= $5
            AND next_number >= $6
        ) AS series_range,
        (SELECT COUNT(*)::text FROM public.customers WHERE notes = $3) AS customers,
        (
          SELECT COUNT(*)::text FROM public.quotes
          WHERE version_notes = $3
             OR quote_reference = ANY($4::text[])
        ) AS quotes
    `,
    [
      FIXTURE_KEY,
      SAMPLE_INITIALS,
      FIXTURE_KEY,
      Array.from({ length: QUOTE_COUNT }, (_, index) => `${SAMPLE_NUMBER_START + index}-${SAMPLE_INITIALS}`),
      SAMPLE_NUMBER_START + QUOTE_COUNT - 1,
      SAMPLE_NUMBER_START,
    ]
  );
  return Object.fromEntries(
    Object.entries(result.rows[0]).map(([key, value]) => [key, Number(value)])
  ) as Record<'profiles' | 'series' | 'series_range' | 'customers' | 'quotes', number>;
}

function queueSampleReferences(): string[] {
  return Array.from(
    { length: QUEUE_QUOTE_COUNT },
    (_, index) => `${QUEUE_SAMPLE_NUMBER_START + index}-${SAMPLE_INITIALS}`
  );
}

async function assertQueueExtensionReady(client: Client) {
  const result = await client.query<{
    profiles: string;
    customers: string;
    base_quotes: string;
    base_jobs: string;
    base_visits: string;
    series: string;
    queue_collisions: string;
  }>(
    `
      WITH owned_quotes AS (
        SELECT id FROM public.quotes WHERE version_notes = $1
      ), owned_jobs AS (
        SELECT id FROM public.schedule_jobs
        WHERE quote_id IN (SELECT id FROM owned_quotes)
      )
      SELECT
        (SELECT COUNT(*)::text FROM public.profiles
          WHERE placeholder_key = $1 AND is_placeholder = TRUE) AS profiles,
        (SELECT COUNT(*)::text FROM public.customers WHERE notes = $1) AS customers,
        (SELECT COUNT(*)::text FROM owned_quotes) AS base_quotes,
        (SELECT COUNT(*)::text FROM owned_jobs) AS base_jobs,
        (SELECT COUNT(*)::text FROM public.schedule_visits
          WHERE job_id IN (SELECT id FROM owned_jobs)) AS base_visits,
        (
          SELECT COUNT(*)::text
          FROM public.quote_manager_series AS series
          JOIN public.profiles AS profile ON profile.id = series.profile_id
          WHERE profile.placeholder_key = $1
            AND series.initials = $2
            AND series.next_number = $3
            AND series.is_active = FALSE
        ) AS series,
        (SELECT COUNT(*)::text FROM public.quotes
          WHERE quote_reference = ANY($4::text[])) AS queue_collisions
    `,
    [
      FIXTURE_KEY,
      SAMPLE_INITIALS,
      QUEUE_SAMPLE_NUMBER_START,
      queueSampleReferences(),
    ]
  );
  const counts = Object.fromEntries(
    Object.entries(result.rows[0]).map(([key, value]) => [key, Number(value)])
  );
  const expected = {
    profiles: 1,
    customers: 5,
    base_quotes: QUOTE_COUNT,
    base_jobs: QUOTE_COUNT,
    series: 1,
    queue_collisions: 0,
  };
  if (
    Object.entries(expected).some(([key, value]) => counts[key] !== value)
    || Number(counts.base_visits) < 36
  ) {
    throw new Error(
      `Existing fixture is not in the expected extension state: ${JSON.stringify(counts)}`
    );
  }
  return counts;
}

async function findAuthUserByEmail(
  supabase: SupabaseClient,
  email: string
): Promise<User | null> {
  for (let page = 1; page <= 20; page += 1) {
    const result = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (result.error) throw result.error;
    const user = result.data.users.find((item) => item.email?.toLowerCase() === email.toLowerCase());
    if (user) return user;
    if (result.data.users.length < 200) return null;
  }
  throw new Error('Unable to safely inspect all auth users.');
}

function writeManifest(manifest: SampleManifest) {
  const directory = resolve(process.cwd(), 'docs_private', 'automation', 'runs', 'scheduling-sample');
  mkdirSync(directory, { recursive: true });
  const path = resolve(directory, `plan-${manifest.date_window.start}.json`);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Manifest: ${path}`);
}

function writeQueueManifest(manifest: QueueSampleManifest) {
  const directory = resolve(process.cwd(), 'docs_private', 'automation', 'runs', 'scheduling-sample');
  mkdirSync(directory, { recursive: true });
  const path = resolve(directory, `queue-plan-${manifest.date_window.start}.json`);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Manifest: ${path}`);
}

async function applyFixture(
  client: Client,
  supabase: SupabaseClient,
  manifest: SampleManifest
) {
  const collisions = await collisionCounts(client);
  const existingAuth = await findAuthUserByEmail(supabase, SAMPLE_EMAIL);
  if (Object.values(collisions).some((count) => count > 0) || existingAuth) {
    throw new Error('Sample ownership marker, series, references, or auth identity already exists. Cleanup or investigate before applying.');
  }

  const authResult = await supabase.auth.admin.createUser({
    email: SAMPLE_EMAIL,
    password: randomUUID(),
    email_confirm: true,
    ban_duration: '876000h',
    user_metadata: {
      full_name: 'SAMPLE Scheduling Manager',
      account_status: 'scheduling_sample',
      is_placeholder: true,
      placeholder_key: FIXTURE_KEY,
    },
  });
  if (authResult.error || !authResult.data.user) {
    throw authResult.error || new Error('Unable to create the SAMPLE auth identity.');
  }

  const profileId = authResult.data.user.id;
  const fixture = buildFixtureDefinitions(new Date(`${manifest.date_window.start}T12:00:00Z`));
  const customerIds = fixture.customers.map(() => randomUUID());
  try {
    await client.query('BEGIN');
    const roleResult = await client.query<{ id: string }>(
      `SELECT id FROM public.roles WHERE LOWER(name) = 'manager' LIMIT 1`
    );
    if (!roleResult.rows[0]) throw new Error('Manager role not found.');

    await client.query(
      `
        INSERT INTO public.profiles (
          id, employee_id, full_name, role, role_id, must_change_password,
          super_admin, is_placeholder, placeholder_key, employer_profile_notes
        ) VALUES ($1, $2, $3, 'manager', $4, FALSE, FALSE, TRUE, $5, $5)
        ON CONFLICT (id) DO UPDATE
        SET
          employee_id = EXCLUDED.employee_id,
          full_name = EXCLUDED.full_name,
          role = EXCLUDED.role,
          role_id = EXCLUDED.role_id,
          must_change_password = FALSE,
          super_admin = FALSE,
          is_placeholder = TRUE,
          placeholder_key = EXCLUDED.placeholder_key,
          employer_profile_notes = EXCLUDED.employer_profile_notes,
          updated_at = NOW()
      `,
      [profileId, 'SAMPLE-SCHEDULING', 'SAMPLE Scheduling Manager', roleResult.rows[0].id, FIXTURE_KEY]
    );
    await client.query(
      `
        INSERT INTO public.quote_manager_series (
          profile_id, initials, next_number, number_start, signoff_name,
          signoff_title, manager_email, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE)
      `,
      [
        profileId,
        SAMPLE_INITIALS,
        SAMPLE_NUMBER_START + QUOTE_COUNT,
        SAMPLE_NUMBER_START,
        'SAMPLE Scheduling Manager',
        'Fictional Fixture',
        SAMPLE_EMAIL,
      ]
    );

    for (const [index, customer] of fixture.customers.entries()) {
      await client.query(
        `
          INSERT INTO public.customers (
            id, company_name, short_name, contact_name, contact_email,
            address_line_1, city, postcode, status, notes, created_by, updated_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $10, $10)
        `,
        [
          customerIds[index],
          customer.companyName,
          customer.companyName.slice(0, 40),
          customer.contactName,
          `contact${index + 1}@example.test`,
          `${10 + index} Fictional Avenue`,
          customer.city,
          customer.postcode,
          FIXTURE_KEY,
          profileId,
        ]
      );
    }

    for (const quote of fixture.quotes) {
      const total = Math.max(quote.estimatedMinutes * 2.5, 350);
      await client.query(
        `
          INSERT INTO public.quotes (
            id, quote_reference, base_quote_reference, quote_thread_id,
            customer_id, requester_id, requester_initials, quote_date,
            subject_line, project_description, scope, site_address,
            subtotal, total, status, accepted, started, po_number,
            po_received_at, start_date, estimated_duration_days,
            estimated_duration_minutes, completion_status, commercial_status,
            revision_number, revision_type, version_label, version_notes,
            is_latest_version, pricing_mode, manager_name, manager_email,
            created_by, updated_by
          ) VALUES (
            $1, $2, $2, $1, $3, $4, $5, CURRENT_DATE,
            $6, $7, $7, $8,
            $9, $9, $10, TRUE, $11, $12,
            NOW(), $13, $14,
            $15, 'not_completed', 'open',
            0, 'original', 'Original', $16,
            TRUE, 'itemized', $17, $18,
            $4, $4
          )
        `,
        [
          quote.id,
          quote.reference,
          customerIds[quote.customerIndex],
          profileId,
          SAMPLE_INITIALS,
          quote.title,
          `Fictional sample scope for ${quote.title.toLowerCase()}.`,
          quote.siteAddress,
          total,
          quote.status,
          quote.status === 'in_progress',
          `SAMPLE-${quote.reference}`,
          quote.startDate,
          quote.estimatedDays,
          quote.estimatedMinutes,
          FIXTURE_KEY,
          'SAMPLE Scheduling Manager',
          SAMPLE_EMAIL,
        ]
      );
      await client.query(
        `
          INSERT INTO public.quote_line_items (
            quote_id, description, quantity, unit, unit_rate, line_total, sort_order
          ) VALUES ($1, $2, 1, 'job', $3, $3, 0)
        `,
        [quote.id, quote.title, total]
      );

      const jobResult = await client.query<{ id: string; job_reference: string }>(
        `SELECT id, job_reference FROM public.schedule_jobs WHERE quote_id = $1`,
        [quote.id]
      );
      if (jobResult.rows[0]?.job_reference !== quote.reference) {
        throw new Error(`Quote synchronization failed for ${quote.reference}.`);
      }
      for (const [visitIndex, visit] of quote.visits.entries()) {
        await client.query(
          `
            INSERT INTO public.schedule_visits (
              job_id, sequence_number, title, starts_at, ends_at,
              status, notes, created_by, updated_by
            ) VALUES ($1, $2, $3, $4, $5, 'planned', $6, $7, $7)
          `,
          [
            jobResult.rows[0].id,
            visitIndex + 1,
            visit.title,
            visit.startsAt,
            visit.endsAt,
            FIXTURE_KEY,
            profileId,
          ]
        );
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    await supabase.auth.admin.deleteUser(profileId);
    throw error;
  }
}

async function applyQueueFixture(
  client: Client,
  manifest: QueueSampleManifest
) {
  await assertQueueExtensionReady(client);
  const fixture = buildQueueFixtureDefinitions(
    new Date(`${manifest.date_window.start}T12:00:00Z`)
  );
  const profileResult = await client.query<{ id: string }>(
    `
      SELECT id FROM public.profiles
      WHERE placeholder_key = $1
        AND is_placeholder = TRUE
        AND employer_profile_notes = $1
    `,
    [FIXTURE_KEY]
  );
  const customerResult = await client.query<{ id: string }>(
    `
      SELECT id FROM public.customers
      WHERE notes = $1
      ORDER BY company_name
    `,
    [FIXTURE_KEY]
  );
  if (profileResult.rows.length !== 1 || customerResult.rows.length !== 5) {
    throw new Error('The base SAMPLE identity or Customers are not uniquely available.');
  }
  const profileId = profileResult.rows[0].id;

  await client.query('BEGIN');
  try {
    for (const quote of fixture.quotes) {
      const isAccepted = ['won', 'po_received', 'in_progress'].includes(quote.status);
      const hasPurchaseOrder = ['po_received', 'in_progress'].includes(quote.status);
      const total = Math.max(quote.estimatedMinutes * 2.5, 350);
      await client.query(
        `
          INSERT INTO public.quotes (
            id, quote_reference, base_quote_reference, quote_thread_id,
            customer_id, requester_id, requester_initials, quote_date,
            subject_line, project_description, scope, site_address,
            subtotal, total, status, accepted, started, po_number,
            po_received_at, start_date, estimated_duration_days,
            estimated_duration_minutes, completion_status, commercial_status,
            revision_number, revision_type, version_label, version_notes,
            is_latest_version, pricing_mode, manager_name, manager_email,
            created_by, updated_by
          ) VALUES (
            $1, $2, $2, $1,
            $3, $4, $5, CURRENT_DATE,
            $6, $7, $7, $8,
            $9, $9, $10, $11, $12, $13,
            $14, $15, $16,
            $17, 'not_completed', 'open',
            0, 'original', 'Original', $18,
            TRUE, 'itemized', $19, $20,
            $4, $4
          )
        `,
        [
          quote.id,
          quote.reference,
          customerResult.rows[quote.customerIndex].id,
          profileId,
          SAMPLE_INITIALS,
          quote.title,
          `Fictional queue sample scope for ${quote.title.toLowerCase()}.`,
          quote.siteAddress,
          total,
          quote.status,
          isAccepted,
          quote.status === 'in_progress',
          hasPurchaseOrder ? `SAMPLE-${quote.reference}` : null,
          hasPurchaseOrder ? new Date() : null,
          quote.startDate,
          quote.estimatedDays,
          quote.estimatedMinutes,
          FIXTURE_KEY,
          'SAMPLE Scheduling Manager',
          SAMPLE_EMAIL,
        ]
      );
      await client.query(
        `
          INSERT INTO public.quote_line_items (
            quote_id, description, quantity, unit, unit_rate, line_total, sort_order
          ) VALUES ($1, $2, 1, 'job', $3, $3, 0)
        `,
        [quote.id, quote.title, total]
      );

      const jobResult = await client.query<{ id: string; job_reference: string }>(
        `SELECT id, job_reference FROM public.schedule_jobs WHERE quote_id = $1`,
        [quote.id]
      );
      if (!quote.startDate) {
        if (jobResult.rows.length > 0) {
          throw new Error(`Unscheduled Quote ${quote.reference} unexpectedly synchronized.`);
        }
        continue;
      }
      if (jobResult.rows[0]?.job_reference !== quote.reference) {
        throw new Error(`Quote synchronization failed for ${quote.reference}.`);
      }
      for (const [visitIndex, visit] of quote.visits.entries()) {
        await client.query(
          `
            INSERT INTO public.schedule_visits (
              job_id, sequence_number, title, starts_at, ends_at,
              status, notes, created_by, updated_by
            ) VALUES ($1, $2, $3, $4, $5, 'planned', $6, $7, $7)
          `,
          [
            jobResult.rows[0].id,
            visitIndex + 1,
            visit.title,
            visit.startsAt,
            visit.endsAt,
            FIXTURE_KEY,
            profileId,
          ]
        );
      }
    }
    const seriesResult = await client.query(
      `
        UPDATE public.quote_manager_series AS series
        SET next_number = $1
        FROM public.profiles AS profile
        WHERE profile.id = series.profile_id
          AND profile.placeholder_key = $2
          AND series.initials = $3
          AND series.next_number = $4
          AND series.is_active = FALSE
      `,
      [
        QUEUE_SAMPLE_NUMBER_START + QUEUE_QUOTE_COUNT,
        FIXTURE_KEY,
        SAMPLE_INITIALS,
        QUEUE_SAMPLE_NUMBER_START,
      ]
    );
    if (seriesResult.rowCount !== 1) {
      throw new Error('SAMPLE quote series changed while extending the fixture.');
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function inspectQueueFixture(client: Client) {
  const result = await client.query<{
    quotes: string;
    jobs: string;
    visits: string;
    employee_assignments: string;
    plant_assignments: string;
  }>(
    `
      WITH queue_quotes AS (
        SELECT id FROM public.quotes WHERE quote_reference = ANY($1::text[])
      ), queue_jobs AS (
        SELECT id FROM public.schedule_jobs WHERE quote_id IN (SELECT id FROM queue_quotes)
      ), queue_visits AS (
        SELECT id FROM public.schedule_visits WHERE job_id IN (SELECT id FROM queue_jobs)
      )
      SELECT
        (SELECT COUNT(*)::text FROM queue_quotes) AS quotes,
        (SELECT COUNT(*)::text FROM queue_jobs) AS jobs,
        (SELECT COUNT(*)::text FROM queue_visits) AS visits,
        (SELECT COUNT(*)::text FROM public.schedule_employee_assignments
          WHERE visit_id IN (SELECT id FROM queue_visits)) AS employee_assignments,
        (SELECT COUNT(*)::text FROM public.schedule_plant_assignments
          WHERE visit_id IN (SELECT id FROM queue_visits)) AS plant_assignments
    `,
    [queueSampleReferences()]
  );
  return Object.fromEntries(
    Object.entries(result.rows[0]).map(([key, value]) => [key, Number(value)])
  );
}

async function inspectFixture(client: Client) {
  const result = await client.query<{
    profiles: string;
    customers: string;
    quotes: string;
    jobs: string;
    visits: string;
    employee_assignments: string;
    plant_assignments: string;
  }>(
    `
      WITH owned_quotes AS (
        SELECT id FROM public.quotes WHERE version_notes = $1
      ), owned_jobs AS (
        SELECT id FROM public.schedule_jobs WHERE quote_id IN (SELECT id FROM owned_quotes)
      ), owned_visits AS (
        SELECT id FROM public.schedule_visits WHERE job_id IN (SELECT id FROM owned_jobs)
      )
      SELECT
        (SELECT COUNT(*)::text FROM public.profiles WHERE placeholder_key = $1) AS profiles,
        (SELECT COUNT(*)::text FROM public.customers WHERE notes = $1) AS customers,
        (SELECT COUNT(*)::text FROM owned_quotes) AS quotes,
        (SELECT COUNT(*)::text FROM owned_jobs) AS jobs,
        (SELECT COUNT(*)::text FROM owned_visits) AS visits,
        (
          SELECT COUNT(*)::text FROM public.schedule_employee_assignments
          WHERE visit_id IN (SELECT id FROM owned_visits)
        ) AS employee_assignments,
        (
          SELECT COUNT(*)::text FROM public.schedule_plant_assignments
          WHERE visit_id IN (SELECT id FROM owned_visits)
        ) AS plant_assignments
    `,
    [FIXTURE_KEY]
  );
  return Object.fromEntries(
    Object.entries(result.rows[0]).map(([key, value]) => [key, Number(value)])
  );
}

async function cleanupFixture(
  client: Client,
  supabase: SupabaseClient,
  isDryRun: boolean
) {
  const profileResult = await client.query<{ id: string }>(
    `
      SELECT id FROM public.profiles
      WHERE placeholder_key = $1
        AND is_placeholder = TRUE
        AND employer_profile_notes = $1
    `,
    [FIXTURE_KEY]
  );
  const authUser = await findAuthUserByEmail(supabase, SAMPLE_EMAIL);
  const counts = await inspectFixture(client);
  console.log('Owned fixture counts:', JSON.stringify(counts));
  if (isDryRun) return;
  if (profileResult.rows.length !== 1 || authUser?.id !== profileResult.rows[0].id) {
    throw new Error('Ownership markers do not identify exactly one matching SAMPLE auth/profile identity.');
  }
  if (Number(counts.employee_assignments) > 0 || Number(counts.plant_assignments) > 0) {
    throw new Error('Fixture visits have resource assignments. Remove or investigate them before cleanup.');
  }

  const profileId = profileResult.rows[0].id;
  await client.query('BEGIN');
  try {
    await client.query(
      `
        DELETE FROM public.schedule_visits
        WHERE job_id IN (
          SELECT job.id FROM public.schedule_jobs AS job
          JOIN public.quotes AS quote ON quote.id = job.quote_id
          WHERE quote.version_notes = $1 AND job.source_type = 'quote'
        )
      `,
      [FIXTURE_KEY]
    );
    await client.query(
      `
        DELETE FROM public.schedule_jobs
        WHERE source_type = 'quote'
          AND quote_id IN (SELECT id FROM public.quotes WHERE version_notes = $1)
      `,
      [FIXTURE_KEY]
    );
    await client.query(
      `DELETE FROM public.quote_line_items WHERE quote_id IN (SELECT id FROM public.quotes WHERE version_notes = $1)`,
      [FIXTURE_KEY]
    );
    await client.query(`DELETE FROM public.quotes WHERE version_notes = $1 AND requester_id = $2`, [FIXTURE_KEY, profileId]);
    await client.query(`DELETE FROM public.customers WHERE notes = $1 AND created_by = $2`, [FIXTURE_KEY, profileId]);
    await client.query(
      `DELETE FROM public.quote_manager_series WHERE profile_id = $1 AND initials = $2 AND is_active = FALSE`,
      [profileId, SAMPLE_INITIALS]
    );
    await client.query(
      `DELETE FROM public.profiles WHERE id = $1 AND placeholder_key = $2 AND is_placeholder = TRUE`,
      [profileId, FIXTURE_KEY]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  const deleteResult = await supabase.auth.admin.deleteUser(profileId);
  if (deleteResult.error) {
    throw new Error(`Database cleanup completed, but auth cleanup failed: ${deleteResult.error.message}`);
  }
}

async function main() {
  const mode = (process.argv.find((argument) => argument.startsWith('--mode='))?.split('=')[1] || 'plan') as Mode;
  if (!['plan', 'apply', 'cleanup', 'queue-plan', 'queue-apply'].includes(mode)) {
    throw new Error('Invalid mode.');
  }
  const isDryRun = process.argv.includes('--dry-run');
  if (
    (mode === 'apply' || mode === 'queue-apply' || (mode === 'cleanup' && !isDryRun))
    && !process.argv.includes(CONFIRMATION)
  ) {
    throw new Error(`Production confirmation required: ${CONFIRMATION}`);
  }

  const environment = requiredEnvironment();
  const client = createPgClient(environment.connectionString);
  const supabase = createClient(environment.supabaseUrl, environment.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await client.connect();
  try {
    await assertSchema(client);
    if (mode === 'queue-plan') {
      const manifest = createQueueManifest(environment.projectRef);
      await assertQueueExtensionReady(client);
      writeQueueManifest(manifest);
      console.log(JSON.stringify(manifest, null, 2));
      return;
    }
    if (mode === 'queue-apply') {
      const manifest = createQueueManifest(environment.projectRef);
      await applyQueueFixture(client, manifest);
      const counts = await inspectQueueFixture(client);
      const expectedCounts = {
        quotes: manifest.counts.quotes,
        jobs: manifest.counts.jobs,
        visits: manifest.counts.visits,
        employee_assignments: 0,
        plant_assignments: 0,
      };
      if (
        Object.entries(expectedCounts).some(
          ([key, value]) => Number(counts[key]) !== value
        )
      ) {
        throw new Error(
          `Queue fixture verification failed: ${JSON.stringify(counts)}`
        );
      }
      console.log('Applied queue fixture counts:', JSON.stringify(counts));
      console.log(`Cleanup: npm run scheduling:sample:cleanup -- ${CONFIRMATION}`);
      return;
    }
    const manifest = createManifest(environment.projectRef);
    if (mode === 'plan') {
      const collisions = await collisionCounts(client);
      if (Object.values(collisions).some((count) => count > 0)) {
        throw new Error(`Fixture collision detected: ${JSON.stringify(collisions)}`);
      }
      writeManifest(manifest);
      console.log(JSON.stringify(manifest, null, 2));
      return;
    }
    if (mode === 'apply') {
      await applyFixture(client, supabase, manifest);
      const counts = await inspectFixture(client);
      console.log('Applied fixture counts:', JSON.stringify(counts));
      console.log(`Cleanup: npm run scheduling:sample:cleanup -- ${CONFIRMATION}`);
      return;
    }
    await cleanupFixture(client, supabase, isDryRun);
    if (!isDryRun) console.log('SAMPLE scheduling fixture removed.');
  } finally {
    await client.end();
  }
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
