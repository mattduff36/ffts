import 'server-only';

import { randomUUID } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  buildFixtureDefinitions,
  buildQueueFixtureDefinitions,
} from '@/scripts/testing/scheduling-sample';
import type { SampleDataDbClient } from './database';
import type { SampleDataFixtureStatus } from './types';

export const SCHEDULING_FIXTURE_KEY = 'scheduling-sample-v1' as const;
export const SCHEDULING_TOOLING_VERSION = 'debug-scheduling-v1';

const SAMPLE_EMAIL = 'scheduling-sample-v1@example.test';
const SAMPLE_INITIALS = 'SD';
const BASE_START = 99000;
const BASE_COUNT = 22;
const QUEUE_START = BASE_START + BASE_COUNT;
const QUEUE_COUNT = 12;
const BASE_VISIT_COUNT = 36;
const QUEUE_JOB_COUNT = 3;
const QUEUE_VISIT_COUNT = 3;

function references(start: number, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${start + index}-${SAMPLE_INITIALS}`);
}

const BASE_REFERENCES = references(BASE_START, BASE_COUNT);
const QUEUE_REFERENCES = references(QUEUE_START, QUEUE_COUNT);

async function findAuthUserByEmail() {
  const admin = createAdminClient();
  for (let page = 1; page <= 20; page += 1) {
    const result = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (result.error) throw result.error;
    const match = result.data.users.find(
      (user) => user.email?.toLowerCase() === SAMPLE_EMAIL
    );
    if (match) return match;
    if (result.data.users.length < 200) return null;
  }
  throw new Error('Unable to safely inspect all auth users.');
}

function getProjectAvailabilityReason(): string | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const connectionString =
    process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  const allowedProjectRef = process.env.SCHEDULING_SAMPLE_PRODUCTION_PROJECT_REF;
  if (!supabaseUrl || !connectionString || !allowedProjectRef) {
    return 'Scheduling sample production allowlist is not configured.';
  }

  try {
    const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
    if (
      projectRef !== allowedProjectRef
      || !connectionString.includes(allowedProjectRef)
    ) {
      return 'Configured URL and database do not match the Scheduling sample allowlist.';
    }
  } catch {
    return 'Scheduling sample environment configuration is invalid.';
  }
  return null;
}

export async function inspectSchedulingFixture(
  client: SampleDataDbClient
): Promise<SampleDataFixtureStatus> {
  const availabilityReason = getProjectAvailabilityReason();
  if (availabilityReason) {
    return unavailableSchedulingStatus(availabilityReason);
  }

  const schemaResult = await client.query<{
    visits_table: string | null;
    operations_table: string | null;
    sync_trigger: string | null;
  }>(`
    SELECT
      to_regclass('public.schedule_visits')::text AS visits_table,
      to_regclass('public.sample_data_operations')::text AS operations_table,
      (
        SELECT trigger_name
        FROM information_schema.triggers
        WHERE event_object_schema = 'public'
          AND event_object_table = 'quotes'
          AND trigger_name = 'sync_operational_quote_schedule_job_trigger'
        LIMIT 1
      ) AS sync_trigger
  `);
  const schema = schemaResult.rows[0];
  if (
    schema?.visits_table !== 'schedule_visits'
    || schema.operations_table !== 'sample_data_operations'
    || schema.sync_trigger !== 'sync_operational_quote_schedule_job_trigger'
  ) {
    return unavailableSchedulingStatus(
      'Required Scheduling or sample-operation schema is not deployed.'
    );
  }

  const authUser = await findAuthUserByEmail();
  const result = await client.query<Record<string, string>>(
      `
        WITH owned_profile AS (
          SELECT id
          FROM public.profiles
          WHERE placeholder_key = $1
            AND is_placeholder = TRUE
            AND employer_profile_notes = $1
        ),
        base_quotes AS (
          SELECT id FROM public.quotes
          WHERE quote_reference = ANY($2::text[])
            AND version_notes = $1
        ),
        queue_quotes AS (
          SELECT id FROM public.quotes
          WHERE quote_reference = ANY($3::text[])
            AND version_notes = $1
        ),
        owned_quotes AS (
          SELECT id FROM public.quotes WHERE version_notes = $1
        ),
        owned_jobs AS (
          SELECT id, quote_id
          FROM public.schedule_jobs
          WHERE quote_id IN (SELECT id FROM owned_quotes)
        ),
        owned_visits AS (
          SELECT id, job_id
          FROM public.schedule_visits
          WHERE job_id IN (SELECT id FROM owned_jobs)
        )
        SELECT
          (SELECT COUNT(*)::text FROM owned_profile) AS profiles,
          (SELECT COUNT(*)::text FROM public.customers WHERE notes = $1) AS customers,
          (
            SELECT COUNT(*)::text
            FROM public.quote_manager_series
            WHERE profile_id IN (SELECT id FROM owned_profile)
              AND initials = $4
              AND is_active = FALSE
          ) AS series,
          (
            SELECT COUNT(*)::text
            FROM public.quote_manager_series
            WHERE profile_id IN (SELECT id FROM owned_profile)
              AND initials = $4
              AND next_number = ${QUEUE_START}
              AND is_active = FALSE
          ) AS series_base_ready,
          (
            SELECT COUNT(*)::text
            FROM public.quote_manager_series
            WHERE profile_id IN (SELECT id FROM owned_profile)
              AND initials = $4
              AND next_number = ${QUEUE_START + QUEUE_COUNT}
              AND is_active = FALSE
          ) AS series_complete_ready,
          (
            SELECT COUNT(*)::text FROM owned_profile WHERE id = $5::uuid
          ) AS auth_profile_match,
          (SELECT COUNT(*)::text FROM base_quotes) AS base_quotes,
          (
            SELECT COUNT(*)::text FROM owned_jobs
            WHERE quote_id IN (SELECT id FROM base_quotes)
          ) AS base_jobs,
          (
            SELECT COUNT(*)::text FROM owned_visits
            WHERE job_id IN (
              SELECT id FROM owned_jobs
              WHERE quote_id IN (SELECT id FROM base_quotes)
            )
          ) AS base_visits,
          (SELECT COUNT(*)::text FROM queue_quotes) AS queue_quotes,
          (
            SELECT COUNT(*)::text FROM owned_jobs
            WHERE quote_id IN (SELECT id FROM queue_quotes)
          ) AS queue_jobs,
          (
            SELECT COUNT(*)::text FROM owned_visits
            WHERE job_id IN (
              SELECT id FROM owned_jobs
              WHERE quote_id IN (SELECT id FROM queue_quotes)
            )
          ) AS queue_visits,
          (SELECT COUNT(*)::text FROM owned_quotes) AS owned_quotes,
          (
            SELECT COUNT(*)::text
            FROM public.schedule_employee_assignments
            WHERE visit_id IN (SELECT id FROM owned_visits)
          ) AS employee_assignments,
          (
            SELECT COUNT(*)::text
            FROM public.schedule_plant_assignments
            WHERE visit_id IN (SELECT id FROM owned_visits)
          ) AS plant_assignments,
          (
            SELECT COUNT(*)::text FROM public.quote_attachments
            WHERE quote_id IN (SELECT id FROM owned_quotes)
          ) AS quote_attachments,
          (
            SELECT COUNT(*)::text FROM public.quote_invoices
            WHERE quote_id IN (SELECT id FROM owned_quotes)
          ) AS quote_invoices,
          (
            SELECT COUNT(*)::text FROM public.quote_invoice_requests
            WHERE quote_id IN (SELECT id FROM owned_quotes)
          ) AS invoice_requests,
          (
            SELECT COUNT(*)::text FROM public.rams_documents
            WHERE quote_id IN (SELECT id FROM owned_quotes)
          ) AS rams_documents,
          (
            SELECT COUNT(*)::text FROM public.work_calendar_entries
            WHERE quote_id IN (SELECT id FROM owned_quotes)
          ) AS work_calendar_entries,
          (
            SELECT COUNT(*)::text FROM public.quote_project_numbers
            WHERE linked_quote_id IN (SELECT id FROM owned_quotes)
               OR converted_quote_id IN (SELECT id FROM owned_quotes)
          ) AS project_links,
          (
            SELECT COUNT(*)::text FROM public.customer_contacts
            WHERE customer_id IN (
              SELECT id FROM public.customers WHERE notes = $1
            )
          ) AS customer_contacts,
          (
            SELECT COUNT(*)::text FROM public.customer_sites
            WHERE customer_id IN (
              SELECT id FROM public.customers WHERE notes = $1
            )
          ) AS customer_sites,
          (
            SELECT COUNT(*)::text FROM public.quote_manager_series
            WHERE initials = $4
              AND profile_id NOT IN (SELECT id FROM owned_profile)
          ) AS series_collisions,
          (
            SELECT COUNT(*)::text FROM public.quotes
            WHERE quote_reference = ANY(($2::text[]) || ($3::text[]))
              AND version_notes IS DISTINCT FROM $1
          ) AS reference_collisions
      `,
      [
        SCHEDULING_FIXTURE_KEY,
        BASE_REFERENCES,
        QUEUE_REFERENCES,
        SAMPLE_INITIALS,
        authUser?.id || null,
      ]
    );

  const observed = Object.fromEntries(
    Object.entries(result.rows[0]).map(([key, value]) => [key, Number(value)])
  );
  observed.auth_users = authUser ? 1 : 0;
  observed.auth_metadata_match =
    authUser?.user_metadata?.placeholder_key === SCHEDULING_FIXTURE_KEY
    && authUser.user_metadata?.is_placeholder === true
      ? 1
      : 0;

  const baseExpected = {
    auth_users: 1,
    auth_metadata_match: 1,
    auth_profile_match: 1,
    profiles: 1,
    customers: 5,
    series: 1,
    base_quotes: BASE_COUNT,
    base_jobs: BASE_COUNT,
    base_visits: BASE_VISIT_COUNT,
  };
  const queueExpected = {
    queue_quotes: QUEUE_COUNT,
    queue_jobs: QUEUE_JOB_COUNT,
    queue_visits: QUEUE_VISIT_COUNT,
  };
  const markerTotal =
    observed.auth_users + observed.profiles + observed.customers
    + observed.series + observed.owned_quotes;
  const baseInstalled = Object.entries(baseExpected).every(
    ([key, value]) => observed[key] === value
  );
  const queueInstalled = Object.entries(queueExpected).every(
    ([key, value]) => observed[key] === value
  );
  const queueAbsent = Object.keys(queueExpected).every((key) => observed[key] === 0);
  const seriesStateValid =
    queueInstalled
      ? observed.series_complete_ready === 1
      : queueAbsent
        ? observed.series_base_ready === 1
        : false;
  const dependencies = [
    'employee_assignments',
    'plant_assignments',
    'quote_attachments',
    'quote_invoices',
    'invoice_requests',
    'rams_documents',
    'work_calendar_entries',
    'project_links',
    'customer_contacts',
    'customer_sites',
  ].filter((key) => observed[key] > 0);
  const collisions = ['series_collisions', 'reference_collisions'].filter(
    (key) => observed[key] > 0
  );
  const blockers = [
    ...dependencies.map(
      (key) => `${key.replaceAll('_', ' ')}: ${observed[key]}`
    ),
    ...collisions.map(
      (key) => `${key.replaceAll('_', ' ')}: ${observed[key]}`
    ),
  ];
  if (baseInstalled && !seriesStateValid) {
    blockers.unshift('Scheduling SAMPLE quote series has changed.');
  }

  let state: SampleDataFixtureStatus['state'];
  if (markerTotal === 0 && collisions.length === 0) state = 'absent';
  else if (baseInstalled && seriesStateValid && (queueInstalled || queueAbsent)) {
    state = blockers.length > 0 ? 'blocked' : 'installed';
  } else if (markerTotal > 0) {
    const hasExcess =
      observed.owned_quotes > BASE_COUNT + QUEUE_COUNT
      || observed.profiles > 1
      || observed.auth_users > 1;
    state = hasExcess ? 'drifted' : 'partial';
    blockers.unshift('Managed Scheduling ownership is incomplete or has changed.');
  } else {
    state = 'blocked';
  }

  return {
    fixtureKey: SCHEDULING_FIXTURE_KEY,
    label: 'Scheduling Sample Data',
    description:
      'Fictional Customers, Quotes, synchronized jobs and unassigned visits.',
    toolingVersion: SCHEDULING_TOOLING_VERSION,
    state,
    available: true,
    expected: { ...baseExpected, ...queueExpected },
    observed,
    blockers,
    availabilityReason: null,
    variants: {
      base: {
        state: baseInstalled
          ? !seriesStateValid
            ? 'drifted'
            : blockers.length > 0
              ? 'blocked'
              : 'installed'
          : markerTotal === 0
            ? 'absent'
            : 'partial',
        expected: baseExpected,
        observed: Object.fromEntries(
          Object.keys(baseExpected).map((key) => [key, observed[key]])
        ),
      },
      queue: {
        state: queueInstalled ? (blockers.length > 0 ? 'blocked' : 'installed') : queueAbsent ? 'absent' : 'partial',
        expected: queueExpected,
        observed: Object.fromEntries(
          Object.keys(queueExpected).map((key) => [key, observed[key]])
        ),
      },
    },
    lastOperation: null,
  };
}

function unavailableSchedulingStatus(reason: string): SampleDataFixtureStatus {
  return {
    fixtureKey: SCHEDULING_FIXTURE_KEY,
    label: 'Scheduling Sample Data',
    description:
      'Fictional Customers, Quotes, synchronized jobs and unassigned visits.',
    toolingVersion: SCHEDULING_TOOLING_VERSION,
    state: 'unavailable',
    available: false,
    expected: {},
    observed: {},
    blockers: [reason],
    availabilityReason: reason,
    lastOperation: null,
  };
}

export async function createSchedulingAuthUser(): Promise<string> {
  const admin = createAdminClient();
  const existing = await findAuthUserByEmail();
  if (existing) throw new Error('Scheduling SAMPLE auth identity already exists.');

  const result = await admin.auth.admin.createUser({
    email: SAMPLE_EMAIL,
    password: randomUUID(),
    email_confirm: true,
    ban_duration: '876000h',
    user_metadata: {
      full_name: 'SAMPLE Scheduling Manager',
      account_status: 'scheduling_sample',
      is_placeholder: true,
      placeholder_key: SCHEDULING_FIXTURE_KEY,
    },
  });
  if (result.error || !result.data.user) {
    throw result.error || new Error('Unable to create Scheduling SAMPLE auth identity.');
  }
  return result.data.user.id;
}

export async function deleteSchedulingAuthUser(profileId: string): Promise<void> {
  const result = await createAdminClient().auth.admin.deleteUser(profileId);
  if (result.error) throw result.error;
}

export async function insertSchedulingBase(
  client: SampleDataDbClient,
  profileId: string,
  fixtureDate = new Date()
): Promise<void> {
  const fixture = buildFixtureDefinitions(fixtureDate);
  const customerIds = fixture.customers.map(() => randomUUID());
  const roleResult = await client.query<{ id: string }>(
    `SELECT id FROM public.roles WHERE LOWER(name) = 'manager' LIMIT 1`
  );
  if (!roleResult.rows[0]) throw new Error('Manager role not found.');

  await client.query(
    `
      INSERT INTO public.profiles (
        id, employee_id, full_name, role, role_id, must_change_password,
        super_admin, is_placeholder, placeholder_key, employer_profile_notes
      ) VALUES ($1, 'SAMPLE-SCHEDULING', 'SAMPLE Scheduling Manager',
        'manager', $2, FALSE, FALSE, TRUE, $3, $3)
    `,
    [profileId, roleResult.rows[0].id, SCHEDULING_FIXTURE_KEY]
  );
  await client.query(
    `
      INSERT INTO public.quote_manager_series (
        profile_id, initials, next_number, number_start, signoff_name,
        signoff_title, manager_email, is_active
      ) VALUES ($1, $2, $3, $4, 'SAMPLE Scheduling Manager',
        'Fictional Fixture', $5, FALSE)
    `,
    [profileId, SAMPLE_INITIALS, QUEUE_START, BASE_START, SAMPLE_EMAIL]
  );

  for (const [index, customer] of fixture.customers.entries()) {
    await client.query(
      `
        INSERT INTO public.customers (
          id, company_name, short_name, contact_name, contact_email,
          address_line_1, city, postcode, status, notes, created_by, updated_by
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          'active', $9, $10, $10
        )
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
        SCHEDULING_FIXTURE_KEY,
        profileId,
      ]
    );
  }
  await insertSchedulingQuotes(client, fixture.quotes, customerIds, profileId);
}

export async function insertSchedulingQueue(
  client: SampleDataDbClient,
  fixtureDate = new Date()
): Promise<void> {
  const profileResult = await client.query<{ id: string }>(
    `
      SELECT id FROM public.profiles
      WHERE placeholder_key = $1
        AND is_placeholder = TRUE
        AND employer_profile_notes = $1
    `,
    [SCHEDULING_FIXTURE_KEY]
  );
  const customerResult = await client.query<{ id: string }>(
    `SELECT id FROM public.customers WHERE notes = $1 ORDER BY company_name`,
    [SCHEDULING_FIXTURE_KEY]
  );
  if (profileResult.rows.length !== 1 || customerResult.rows.length !== 5) {
    throw new Error('Scheduling base fixture is not in the expected state.');
  }

  const fixture = buildQueueFixtureDefinitions(fixtureDate);
  await insertSchedulingQuotes(
    client,
    fixture.quotes,
    customerResult.rows.map((row) => row.id),
    profileResult.rows[0].id
  );
  const seriesResult = await client.query(
    `
      UPDATE public.quote_manager_series
      SET next_number = $1, updated_at = NOW()
      WHERE profile_id = $2
        AND initials = $3
        AND next_number = $4
        AND is_active = FALSE
    `,
    [
      QUEUE_START + QUEUE_COUNT,
      profileResult.rows[0].id,
      SAMPLE_INITIALS,
      QUEUE_START,
    ]
  );
  if (seriesResult.rowCount !== 1) {
    throw new Error('Scheduling SAMPLE series changed while adding the queue.');
  }
}

async function insertSchedulingQuotes(
  client: SampleDataDbClient,
  quotes: ReturnType<typeof buildFixtureDefinitions>['quotes'] | ReturnType<typeof buildQueueFixtureDefinitions>['quotes'],
  customerIds: string[],
  profileId: string
): Promise<void> {
  for (const quote of quotes) {
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
          $1, $2, $2, $1, $3, $4, $5, CURRENT_DATE,
          $6, $7, $7, $8, $9, $9, $10, $11, $12, $13,
          $14, $15, $16, $17, 'not_completed', 'open',
          0, 'original', 'Original', $18, TRUE, 'itemized',
          'SAMPLE Scheduling Manager', $19, $4, $4
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
        isAccepted,
        quote.status === 'in_progress',
        hasPurchaseOrder ? `SAMPLE-${quote.reference}` : null,
        hasPurchaseOrder ? new Date() : null,
        quote.startDate,
        quote.estimatedDays,
        quote.estimatedMinutes,
        SCHEDULING_FIXTURE_KEY,
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

    const jobResult = await client.query<{ id: string }>(
      `SELECT id FROM public.schedule_jobs WHERE quote_id = $1`,
      [quote.id]
    );
    if (!quote.startDate) {
      if (jobResult.rows.length > 0) {
        throw new Error(`Unscheduled Quote ${quote.reference} unexpectedly synchronized.`);
      }
      continue;
    }
    if (!jobResult.rows[0]) {
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
          SCHEDULING_FIXTURE_KEY,
          profileId,
        ]
      );
    }
  }
}

export async function removeSchedulingRows(
  client: SampleDataDbClient
): Promise<string> {
  const profileResult = await client.query<{ id: string }>(
    `
      SELECT id FROM public.profiles
      WHERE placeholder_key = $1
        AND is_placeholder = TRUE
        AND employer_profile_notes = $1
    `,
    [SCHEDULING_FIXTURE_KEY]
  );
  const authUser = await findAuthUserByEmail();
  if (
    profileResult.rows.length !== 1
    || authUser?.id !== profileResult.rows[0].id
  ) {
    throw new Error('Scheduling SAMPLE ownership is ambiguous.');
  }
  const profileId = profileResult.rows[0].id;

  await client.query(
    `
      DELETE FROM public.schedule_visits
      WHERE job_id IN (
        SELECT job.id
        FROM public.schedule_jobs AS job
        JOIN public.quotes AS quote ON quote.id = job.quote_id
        WHERE quote.version_notes = $1 AND job.source_type = 'quote'
      )
    `,
    [SCHEDULING_FIXTURE_KEY]
  );
  await client.query(
    `
      DELETE FROM public.schedule_jobs
      WHERE source_type = 'quote'
        AND quote_id IN (
          SELECT id FROM public.quotes WHERE version_notes = $1
        )
    `,
    [SCHEDULING_FIXTURE_KEY]
  );
  await client.query(
    `DELETE FROM public.quotes WHERE version_notes = $1 AND requester_id = $2`,
    [SCHEDULING_FIXTURE_KEY, profileId]
  );
  await client.query(
    `DELETE FROM public.customers WHERE notes = $1 AND created_by = $2`,
    [SCHEDULING_FIXTURE_KEY, profileId]
  );
  await client.query(
    `
      DELETE FROM public.quote_manager_series
      WHERE profile_id = $1 AND initials = $2 AND is_active = FALSE
    `,
    [profileId, SAMPLE_INITIALS]
  );
  await client.query(
    `
      DELETE FROM public.profiles
      WHERE id = $1 AND placeholder_key = $2 AND is_placeholder = TRUE
    `,
    [profileId, SCHEDULING_FIXTURE_KEY]
  );
  return profileId;
}
