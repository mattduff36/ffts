/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

type ScriptSupabaseClient = ReturnType<typeof createClient<any>>;

interface DemoUser {
  key: 'admin' | 'manager' | 'employee' | 'contractor';
  email: string;
  fullName: string;
  employeeId: string;
  roleName: string;
  teamId: string;
  superAdmin: boolean;
}

interface SeededProfile extends DemoUser {
  id: string;
}

interface SeededVehicle {
  id: string;
  reg_number: string;
}

interface SeededHgv {
  id: string;
  reg_number: string;
}

interface SeededPlant {
  id: string;
  plant_id: string;
}

const demoDomain = process.env.NEXT_PUBLIC_DEMO_EMAIL_DOMAIN || 'demo.example.test';
const password = process.env.DEMO_USER_PASSWORD || 'DemoPass123!';

const users: DemoUser[] = [
  {
    key: 'admin',
    email: `avery.stone@${demoDomain}`,
    fullName: 'Avery Stone',
    employeeId: 'DEMO-ADM',
    roleName: 'admin',
    teamId: 'management',
    superAdmin: true,
  },
  {
    key: 'manager',
    email: `morgan.reid@${demoDomain}`,
    fullName: 'Morgan Reid',
    employeeId: 'DEMO-MGR',
    roleName: 'manager',
    teamId: 'transport',
    superAdmin: false,
  },
  {
    key: 'employee',
    email: `jamie.carter@${demoDomain}`,
    fullName: 'Jamie Carter',
    employeeId: 'DEMO-EMP',
    roleName: 'employee',
    teamId: 'civils',
    superAdmin: false,
  },
  {
    key: 'contractor',
    email: `taylor.brooks@${demoDomain}`,
    fullName: 'Taylor Brooks',
    employeeId: 'DEMO-CON',
    roleName: 'employee',
    teamId: 'plant',
    superAdmin: false,
  },
];

const vans = [
  { reg_number: 'DM24VAN', vehicle_type: 'Van', status: 'active', nickname: 'Demo Service Van' },
  { reg_number: 'DM24KIT', vehicle_type: 'Van', status: 'active', nickname: 'Demo Stores Van' },
  { reg_number: 'DM24OPS', vehicle_type: 'Van', status: 'active', nickname: 'Demo Ops Van' },
  { reg_number: 'DM24SUP', vehicle_type: 'Van', status: 'active', nickname: 'Demo Supervisor Van' },
  { reg_number: 'DM24TMP', vehicle_type: 'Van', status: 'active', nickname: 'Demo Traffic Van' },
  { reg_number: 'DM24SPR', vehicle_type: 'Van', status: 'maintenance', nickname: 'Demo Spare Van' },
];

const hgvs = [
  { reg_number: 'DM24HGV', status: 'active', nickname: 'Demo Tipper', current_mileage: 84500 },
  { reg_number: 'DM24ART', status: 'active', nickname: 'Demo Artic', current_mileage: 128900 },
  { reg_number: 'DM24SKP', status: 'active', nickname: 'Demo Skip Lorry', current_mileage: 97600 },
  { reg_number: 'DM24LOW', status: 'maintenance', nickname: 'Demo Low Loader', current_mileage: 154200 },
];

const plantAssets = [
  {
    plant_id: 'DM-EX-001',
    reg_number: 'DM24EXC',
    nickname: 'Demo Excavator',
    make: 'Hitachi',
    model: 'ZX130',
    serial_number: 'DEMOZX130001',
    year: 2022,
    current_hours: 1840,
    status: 'active',
  },
  {
    plant_id: 'DM-RL-002',
    reg_number: 'DM24ROL',
    nickname: 'Demo Roller',
    make: 'Bomag',
    model: 'BW120',
    serial_number: 'DEMOBW120002',
    year: 2021,
    current_hours: 1265,
    status: 'active',
  },
  {
    plant_id: 'DM-DM-003',
    reg_number: 'DM24DMP',
    nickname: 'Demo Dumper',
    make: 'Thwaites',
    model: '6T',
    serial_number: 'DEMOTW6T003',
    year: 2023,
    current_hours: 740,
    status: 'active',
  },
  {
    plant_id: 'DM-TL-004',
    reg_number: 'DM24TEL',
    nickname: 'Demo Telehandler',
    make: 'JCB',
    model: '540-140',
    serial_number: 'DEMOJCB540004',
    year: 2020,
    current_hours: 2150,
    status: 'maintenance',
  },
];

function isoDate(daysFromToday: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return date.toISOString().slice(0, 10);
}

function weekEnding(weeksAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - weeksAgo * 7);
  const day = date.getDay();
  date.setDate(date.getDate() + (day === 0 ? 0 : 7 - day));
  return date.toISOString().slice(0, 10);
}

function dateTime(daysFromToday: number, hour = 9): string {
  const date = new Date(`${isoDate(daysFromToday)}T${String(hour).padStart(2, '0')}:00:00.000Z`);
  return date.toISOString();
}

function normaliseInventoryNumber(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-');
}

async function deleteByIds(
  supabase: ScriptSupabaseClient,
  table: string,
  ids: string[],
  column = 'id'
): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from(table).delete().in(column, ids);
  if (error) throw error;
}

async function ensureVanCategory(
  supabase: ScriptSupabaseClient,
  name: string,
  description: string,
  appliesTo: string[]
): Promise<string> {
  const { data, error } = await supabase
    .from('van_categories')
    .upsert(
      {
        name,
        description,
        applies_to: appliesTo,
      },
      { onConflict: 'name' }
    )
    .select('id')
    .single();

  if (error) throw error;
  if (!data?.id) throw new Error(`Unable to resolve category ${name}`);
  return data.id;
}

async function ensureHgvCategory(supabase: ScriptSupabaseClient, name: string): Promise<string> {
  const { data, error } = await supabase
    .from('hgv_categories')
    .upsert({ name, description: `Demo ${name.toLowerCase()} category` }, { onConflict: 'name' })
    .select('id')
    .single();

  if (error) throw error;
  if (!data?.id) throw new Error(`Unable to resolve HGV category ${name}`);
  return data.id;
}

async function runOptionalStep(label: string, step: () => Promise<void>): Promise<void> {
  try {
    await step();
    console.log(`Ready: ${label}`);
  } catch (error) {
    console.warn(`Skipped ${label}: ${formatError(error)}`);
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error) return JSON.stringify(error);
  return String(error);
}

function assertDemoMode() {
  const appMode = process.env.APP_MODE || process.env.NEXT_PUBLIC_APP_MODE;
  if (appMode !== 'demo') {
    throw new Error('demo:seed can only run when APP_MODE or NEXT_PUBLIC_APP_MODE is set to demo.');
  }
}

async function findRoleId(supabase: ScriptSupabaseClient, roleName: string): Promise<string | null> {
  const { data } = await supabase
    .from('roles')
    .select('id')
    .or(`name.eq.${roleName},display_name.ilike.${roleName}`)
    .limit(1)
    .maybeSingle();

  return data?.id || null;
}

async function ensureDemoRoles(supabase: ScriptSupabaseClient): Promise<void> {
  const { error } = await supabase.from('roles').upsert(
    [
      {
        name: 'admin',
        display_name: 'Administrator',
        description: 'Demo administrator with full system access',
        is_super_admin: true,
        is_manager_admin: true,
      },
      {
        name: 'manager',
        display_name: 'Manager',
        description: 'Demo manager with team oversight and approval access',
        is_super_admin: false,
        is_manager_admin: true,
      },
      {
        name: 'employee',
        display_name: 'Employee',
        description: 'Demo employee profile',
        is_super_admin: false,
        is_manager_admin: false,
      },
    ],
    { onConflict: 'name' }
  );

  if (error) throw error;
}

async function ensureDemoTeams(supabase: ScriptSupabaseClient): Promise<void> {
  const { error } = await supabase.from('org_teams').upsert(
    [
      { id: 'management', name: 'Management', code: 'MGT', active: true, timesheet_type: 'civils' },
      { id: 'transport', name: 'Transport', code: 'TRN', active: true, timesheet_type: 'civils' },
      { id: 'civils', name: 'Civils', code: 'CIV', active: true, timesheet_type: 'civils' },
      { id: 'plant', name: 'Plant', code: 'PLT', active: true, timesheet_type: 'plant' },
      { id: 'workshop', name: 'Workshop', code: 'WRK', active: true, timesheet_type: 'civils' },
    ],
    { onConflict: 'id' }
  );

  if (error) throw error;
}

async function ensureDemoUsers(supabase: ScriptSupabaseClient): Promise<SeededProfile[]> {
  const { data: existingUsers } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const seededProfiles: SeededProfile[] = [];

  for (const user of users) {
    const existing = existingUsers.users.find((candidate) => candidate.email === user.email);
    const authUser =
      existing ||
      (
        await supabase.auth.admin.createUser({
          email: user.email,
          password,
          email_confirm: true,
          user_metadata: {
            full_name: user.fullName,
            employee_id: user.employeeId,
            demo: true,
          },
        })
      ).data.user;

    if (!authUser) throw new Error(`Unable to create demo user ${user.email}`);

    if (existing) {
      await supabase.auth.admin.updateUserById(existing.id, {
        password,
        email_confirm: true,
        user_metadata: {
          ...existing.user_metadata,
          full_name: user.fullName,
          employee_id: user.employeeId,
          demo: true,
        },
      });
    }

    const roleId = await findRoleId(supabase, user.roleName);
    const { error } = await supabase.from('profiles').upsert(
      {
        id: authUser.id,
        full_name: user.fullName,
        employee_id: user.employeeId,
        role: user.roleName,
        role_id: roleId,
        team_id: user.teamId,
        phone_number: '01632 960123',
        super_admin: user.superAdmin,
        must_change_password: false,
      },
      { onConflict: 'id' }
    );

    if (error) throw error;
    seededProfiles.push({ ...user, id: authUser.id });
    console.log(`Ready: ${user.fullName} (${user.email})`);
  }

  const manager = seededProfiles.find((profile) => profile.key === 'manager');
  const admin = seededProfiles.find((profile) => profile.key === 'admin');
  if (manager?.id || admin?.id) {
    await supabase
      .from('org_teams')
      .update({
        manager_1_profile_id: manager?.id || admin?.id,
        manager_2_profile_id: admin?.id || null,
      })
      .in('id', ['transport', 'civils', 'plant', 'workshop']);
  }

  return seededProfiles;
}

async function seedVehicles(supabase: ScriptSupabaseClient): Promise<SeededVehicle[]> {
  const categoryId = await ensureVanCategory(
    supabase,
    'Demo Vans',
    'Fictional vans used to demonstrate fleet, inspections, maintenance, and workshop workflows.',
    ['vehicle', 'van']
  );

  const { data, error } = await supabase
    .from('vans')
    .upsert(
      vans.map((van) => ({ ...van, category_id: categoryId })),
      { onConflict: 'reg_number' }
    )
    .select('id, reg_number');
  if (error) {
    console.warn(`Vehicle seed skipped: ${error.message}`);
    return [];
  }

  console.log(`Ready: ${vans.length} demo fleet records`);
  return data || [];
}

async function seedHgvs(supabase: ScriptSupabaseClient): Promise<SeededHgv[]> {
  const categoryId = await ensureHgvCategory(supabase, 'Demo HGV');
  const { data, error } = await supabase
    .from('hgvs')
    .upsert(
      hgvs.map((hgv) => ({ ...hgv, category_id: categoryId })),
      { onConflict: 'reg_number' }
    )
    .select('id, reg_number');

  if (error) throw error;
  console.log(`Ready: ${hgvs.length} demo HGV records`);
  return data || [];
}

async function seedPlant(supabase: ScriptSupabaseClient, profiles: SeededProfile[]): Promise<SeededPlant[]> {
  const admin = profiles.find((profile) => profile.key === 'admin') || profiles[0];
  const categoryId = await ensureVanCategory(
    supabase,
    'Demo Plant',
    'Fictional plant machinery used in the public demo.',
    ['plant']
  );

  const { data, error } = await supabase
    .from('plant')
    .upsert(
      plantAssets.map((asset) => ({
        ...asset,
        category_id: categoryId,
        created_by: admin.id,
        updated_by: admin.id,
        loler_due_date: isoDate(45),
        loler_last_inspection_date: isoDate(-320),
        loler_certificate_number: `LOLER-${asset.plant_id}`,
      })),
      { onConflict: 'plant_id' }
    )
    .select('id, plant_id');

  if (error) throw error;
  console.log(`Ready: ${plantAssets.length} demo plant records`);
  return data || [];
}

async function seedTimesheets(supabase: ScriptSupabaseClient, profiles: SeededProfile[]): Promise<void> {
  const manager = profiles.find((profile) => profile.key === 'manager') || profiles[0];
  const timesheetProfiles = profiles.filter((profile) => profile.key !== 'admin');
  const regNumbers = ['DM24VAN', 'DM24HGV', 'DM24OPS', 'DM24KIT', 'DM24ART', 'DM24TMP'];
  const statuses = ['submitted', 'approved', 'draft', 'approved', 'submitted', 'rejected'];
  const timesheetRows = timesheetProfiles.flatMap((profile) =>
    [0, 1].map((weekOffset) => ({
      profile,
      weekOffset,
    }))
  );

  for (const [index, row] of timesheetRows.entries()) {
    const employee = row.profile;
    const weekOffset = row.weekOffset;
    const status = statuses[index % statuses.length];
    const { data: timesheet, error } = await supabase
      .from('timesheets')
      .upsert(
        {
          user_id: employee.id,
          reg_number: regNumbers[index % regNumbers.length],
          week_ending: weekEnding(weekOffset),
          status,
          submitted_at: status === 'draft' ? null : dateTime(-index, 16),
          reviewed_by: status === 'approved' || status === 'rejected' ? manager.id : null,
          reviewed_at: status === 'approved' || status === 'rejected' ? dateTime(-index, 17) : null,
          manager_comments:
            status === 'approved'
              ? 'Demo approval for a completed week.'
              : status === 'rejected'
                ? 'Demo rejection: missing site reference on Wednesday.'
                : null,
        },
        { onConflict: 'user_id,week_ending' }
      )
      .select('id')
      .single();

    if (error) throw error;
    if (!timesheet?.id) continue;

    const entries = [1, 2, 3, 4, 5].map((day) => ({
      timesheet_id: timesheet.id,
      day_of_week: day,
      time_started: '07:30',
      time_finished: '16:30',
      daily_total: 9,
      working_in_yard: day === 5,
      remarks: day === 5 ? 'Demo yard and preparation work.' : `Demo job DEMO-${100 + day}.`,
    }));

    const { error: entriesError } = await supabase.from('timesheet_entries').upsert(entries, {
      onConflict: 'timesheet_id,day_of_week',
    });
    if (entriesError) throw entriesError;
  }

  console.log(`Ready: ${timesheetRows.length} demo timesheets`);
}

async function seedCustomersAndQuotes(supabase: ScriptSupabaseClient, profiles: SeededProfile[]): Promise<void> {
  const admin = profiles.find((profile) => profile.key === 'admin') || profiles[0];
  const customerQuotes = [
    {
      customer: {
        company_name: 'Demo Civil Engineering Ltd',
        short_name: 'Demo Civils',
        contact_name: 'Casey Morgan',
        city: 'Exampletown',
        postcode: 'DE1 2MO',
      },
      quote: {
        quote_reference: 'DEMO-6001-AS',
        base_quote_reference: 'DEMO-6001',
        subject_line: 'Demo yard resurfacing works',
        project_description: 'Fictional resurfacing and drainage works used for product demonstrations.',
        status: 'sent',
        sent_at: dateTime(-3, 9),
        lines: [
          ['Demo labour, plant, and materials package', 1, 'item', 12500],
          ['Traffic management setup', 2, 'days', 850],
        ],
      },
    },
    {
      customer: {
        company_name: 'Demo Utilities Partnership',
        short_name: 'Demo Utilities',
        contact_name: 'Jordan Ellis',
        city: 'Northbridge',
        postcode: 'DU4 8MO',
      },
      quote: {
        quote_reference: 'DEMO-6002-AS',
        base_quote_reference: 'DEMO-6002',
        subject_line: 'Demo emergency reinstatement package',
        project_description: 'Fictional quotation showing urgent reactive works and approval states.',
        status: 'won',
        sent_at: dateTime(-8, 11),
        lines: [
          ['Emergency call-out crew', 1, 'shift', 1750],
          ['Reinstatement materials', 12, 'tonnes', 145],
        ],
      },
    },
    {
      customer: {
        company_name: 'Demo Highways Authority',
        short_name: 'Demo Highways',
        contact_name: 'Riley Shaw',
        city: 'Southford',
        postcode: 'DH7 3MO',
      },
      quote: {
        quote_reference: 'DEMO-6003-AS',
        base_quote_reference: 'DEMO-6003',
        subject_line: 'Demo drainage survey and remedials',
        project_description: 'Fictional quote in draft for demonstrating quote editing and PDF generation.',
        status: 'draft',
        sent_at: null,
        lines: [
          ['CCTV drainage survey', 1, 'item', 2150],
          ['Provisional remedial works allowance', 1, 'item', 4800],
        ],
      },
    },
  ];

  for (const item of customerQuotes) {
    const contactSlug = item.customer.contact_name.toLowerCase().replace(/\s+/g, '.');
    const customerPayload = {
      ...item.customer,
      contact_email: `${contactSlug}@${demoDomain}`,
      contact_phone: '01632 960000',
      status: 'active',
      notes: 'Fictional customer for the public demo.',
      created_by: admin.id,
      updated_by: admin.id,
    };

    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('id')
      .eq('company_name', customerPayload.company_name)
      .maybeSingle();

    const customerQuery = existingCustomer?.id
      ? supabase.from('customers').update(customerPayload).eq('id', existingCustomer.id)
      : supabase.from('customers').insert(customerPayload);

    const { data: customer, error: customerError } = await customerQuery.select('id').single();
    if (customerError) throw customerError;
    if (!customer?.id) continue;

    const { data: existingQuote } = await supabase
      .from('quotes')
      .select('id, quote_thread_id')
      .eq('quote_reference', item.quote.quote_reference)
      .maybeSingle();
    const quoteId = existingQuote?.id || randomUUID();
    const subtotal = item.quote.lines.reduce((total, [, quantity, , unitRate]) => total + Number(quantity) * Number(unitRate), 0);

    const quotePayload = {
      id: quoteId,
      quote_reference: item.quote.quote_reference,
      base_quote_reference: item.quote.base_quote_reference,
      quote_thread_id: existingQuote?.quote_thread_id || quoteId,
      customer_id: customer.id,
      requester_id: admin.id,
      requester_initials: 'AS',
      attention_name: item.customer.contact_name,
      attention_email: `${contactSlug}@${demoDomain}`,
      subject_line: item.quote.subject_line,
      project_description: item.quote.project_description,
      subtotal,
      total: subtotal,
      status: item.quote.status,
      created_by: admin.id,
      updated_by: admin.id,
      sent_at: item.quote.sent_at,
    };

    const quoteQuery = existingQuote?.id
      ? supabase.from('quotes').update(quotePayload).eq('id', existingQuote.id)
      : supabase.from('quotes').insert(quotePayload);

    const { data: quote, error: quoteError } = await quoteQuery.select('id').single();
    if (quoteError) throw quoteError;
    if (!quote?.id) continue;

    await supabase.from('quote_line_items').delete().eq('quote_id', quote.id);

    const { error: lineItemError } = await supabase.from('quote_line_items').insert(
      item.quote.lines.map(([description, quantity, unit, unitRate], index) => ({
        quote_id: quote.id,
        description,
        quantity,
        unit,
        unit_rate: unitRate,
        line_total: Number(quantity) * Number(unitRate),
        sort_order: index + 1,
      }))
    );
    if (lineItemError && !lineItemError.message.includes('duplicate')) throw lineItemError;
  }

  console.log(`Ready: ${customerQuotes.length} demo customers and quotes`);
}

async function seedMessages(supabase: ScriptSupabaseClient, profiles: SeededProfile[]): Promise<void> {
  const manager = profiles.find((profile) => profile.key === 'manager') || profiles[0];
  const recipients = profiles.filter((profile) => profile.key === 'employee' || profile.key === 'contractor');
  const { data: existingMessages } = await supabase
    .from('messages')
    .select('id')
    .eq('created_via', 'demo-seed');
  const messageIds = (existingMessages || []).map((message: { id: string }) => message.id);
  await deleteByIds(supabase, 'message_recipients', messageIds, 'message_id');
  await deleteByIds(supabase, 'messages', messageIds);

  const messagePayloads = [
    {
      type: 'TOOLBOX_TALK',
      subject: 'Demo toolbox talk: site access',
      body: 'This is a fictional toolbox talk used to demonstrate message acknowledgement workflows.',
      priority: 'LOW',
      sender_id: manager.id,
      created_via: 'demo-seed',
    },
    {
      type: 'NOTIFICATION',
      subject: 'Demo notice: weekend possession confirmed',
      body: 'Fictional operations notice showing a higher priority site update for the demo team.',
      priority: 'HIGH',
      sender_id: manager.id,
      created_via: 'demo-seed',
    },
    {
      type: 'REMINDER',
      subject: 'Demo message: plant handover reminder',
      body: 'Fictional reminder used to demonstrate read and signed recipient states.',
      priority: 'LOW',
      sender_id: manager.id,
      created_via: 'demo-seed',
    },
  ];

  const { data: messages, error } = await supabase
    .from('messages')
    .insert(messagePayloads)
    .select('id');

  if (error) throw error;
  if (!messages?.length) return;

  const { error: recipientsError } = await supabase.from('message_recipients').insert(
    messages.flatMap((message: { id: string }, messageIndex: number) =>
      recipients.map((recipient, recipientIndex) => ({
        message_id: message.id,
        user_id: recipient.id,
        status: messageIndex === 0 && recipientIndex === 0 ? 'PENDING' : 'SIGNED',
        signed_at: messageIndex === 0 && recipientIndex === 0 ? null : dateTime(-messageIndex, 12),
      }))
    )
  );
  if (recipientsError) throw recipientsError;

  console.log(`Ready: ${messages.length} demo messages`);
}

async function seedAbsence(supabase: ScriptSupabaseClient, profiles: SeededProfile[]): Promise<void> {
  const employee = profiles.find((profile) => profile.key === 'employee') || profiles[0];
  const contractor = profiles.find((profile) => profile.key === 'contractor') || employee;
  const manager = profiles.find((profile) => profile.key === 'manager') || profiles[0];

  async function ensureAbsenceReason(name: string, color: string): Promise<string> {
    const { data, error } = await supabase
      .from('absence_reasons')
      .upsert(
        {
          name,
          is_paid: true,
          color,
          is_active: true,
        },
        { onConflict: 'name' }
      )
      .select('id')
      .single();

    if (error) throw error;
    if (!data?.id) throw new Error(`Unable to resolve absence reason ${name}`);
    return data.id;
  }

  const annualLeaveReasonId = await ensureAbsenceReason('Annual Leave', '#22c55e');
  const trainingReasonId = await ensureAbsenceReason('Training', '#38bdf8');
  const medicalReasonId = await ensureAbsenceReason('Medical Appointment', '#f97316');

  const demoProfiles = [employee, contractor, manager].filter(Boolean);
  await supabase
    .from('absences')
    .delete()
    .in('profile_id', demoProfiles.map((profile) => profile.id))
    .gte('date', isoDate(-14));

  const { error } = await supabase.from('absences').insert([
    {
      profile_id: employee.id,
      date: isoDate(14),
      end_date: isoDate(18),
      reason_id: annualLeaveReasonId,
      duration_days: 5,
      status: 'approved',
      created_by: employee.id,
      approved_by: manager.id,
      approved_at: dateTime(-1, 10),
      notes: 'Fictional demo approved annual leave.',
    },
    {
      profile_id: employee.id,
      date: isoDate(28),
      end_date: isoDate(28),
      reason_id: trainingReasonId,
      duration_days: 1,
      status: 'pending',
      created_by: employee.id,
      notes: 'Fictional demo pending training day.',
    },
    {
      profile_id: contractor.id,
      date: isoDate(7),
      end_date: isoDate(8),
      reason_id: medicalReasonId,
      duration_days: 2,
      status: 'pending',
      created_by: contractor.id,
      notes: 'Fictional demo medical appointment request.',
    },
    {
      profile_id: manager.id,
      date: isoDate(-5),
      end_date: isoDate(-5),
      reason_id: trainingReasonId,
      duration_days: 1,
      status: 'approved',
      created_by: manager.id,
      approved_by: manager.id,
      approved_at: dateTime(-10, 9),
      notes: 'Fictional demo completed training day.',
    },
  ]);

  if (error) throw error;
  console.log('Ready: 4 demo absence records');
}

async function seedInspections(
  supabase: ScriptSupabaseClient,
  profiles: SeededProfile[],
  seededVehicles: SeededVehicle[],
  seededHgvs: SeededHgv[],
  seededPlant: SeededPlant[]
): Promise<void> {
  const employee = profiles.find((profile) => profile.key === 'employee') || profiles[0];
  const manager = profiles.find((profile) => profile.key === 'manager') || profiles[0];

  for (const table of ['van_inspections', 'hgv_inspections', 'plant_inspections']) {
    const { data: existing } = await supabase
      .from(table)
      .select('id')
      .ilike('inspector_comments', 'Demo seed:%');
    const ids = (existing || []).map((row: { id: string }) => row.id);
    await deleteByIds(supabase, 'actions', ids, 'inspection_id');
    await deleteByIds(supabase, 'inspection_items', ids, 'inspection_id');
    await deleteByIds(supabase, 'inspection_daily_hours', ids, 'inspection_id');
    await deleteByIds(supabase, table, ids);
  }

  async function insertInspection(table: string, payload: Record<string, unknown>) {
    const { data, error } = await supabase.from(table).insert(payload).select('id').single();
    if (error) throw error;
    return data?.id ? { table, id: data.id as string } : null;
  }

  const inspectionRequests = [
    ...seededVehicles.slice(0, 4).map((van, index) =>
      insertInspection('van_inspections', {
        van_id: van.id,
        user_id: employee.id,
        week_ending: weekEnding(index),
        inspection_date: isoDate(-1 - index),
        current_mileage: 48250 + index * 410,
        checked_by: employee.fullName,
        status: index === 3 ? 'draft' : 'submitted',
        submitted_at: index === 3 ? null : dateTime(-1 - index, 16),
        reviewed_by: index === 3 ? null : manager.id,
        reviewed_at: index === 3 ? null : dateTime(-index, 9),
        manager_comments: index === 0 ? 'Demo review: marker light defect raised for workshop.' : 'Demo review complete.',
        inspector_comments: `Demo seed: van daily check ${index + 1}.`,
        defects_comments: index === 0 ? 'Nearside marker light not illuminating.' : null,
        signature_data: index === 3 ? null : 'data:image/png;base64,demo',
        signed_at: index === 3 ? null : dateTime(-1 - index, 16),
      })
    ),
    ...seededHgvs.slice(0, 3).map((hgv, index) =>
      insertInspection('hgv_inspections', {
        hgv_id: hgv.id,
        user_id: employee.id,
        inspection_date: isoDate(-2 - index),
        current_mileage: 84520 + index * 920,
        status: 'submitted',
        submitted_at: dateTime(-2 - index, 15),
        reviewed_by: manager.id,
        reviewed_at: dateTime(-1 - index, 10),
        manager_comments: index === 0 ? 'Demo review: tyre pressure note monitored.' : 'Demo review complete.',
        inspector_comments: `Demo seed: HGV daily check ${index + 1}.`,
        signature_data: 'data:image/png;base64,demo',
        signed_at: dateTime(-2 - index, 15),
      })
    ),
    ...seededPlant.slice(0, 3).map((plant, index) =>
      insertInspection('plant_inspections', {
        plant_id: plant.id,
        user_id: employee.id,
        inspection_date: isoDate(-3 - index),
        current_mileage: 1848 + index * 55,
        status: 'submitted',
        submitted_at: dateTime(-3 - index, 14),
        reviewed_by: manager.id,
        reviewed_at: dateTime(-2 - index, 8),
        manager_comments: index === 0 ? 'Demo review: hydraulic hose observation logged.' : 'Demo review complete.',
        inspector_comments: `Demo seed: plant daily check ${index + 1}.`,
        signature_data: 'data:image/png;base64,demo',
        signed_at: dateTime(-3 - index, 14),
      })
    ),
  ];

  const inspections = (await Promise.all(inspectionRequests)).filter(Boolean) as Array<{ table: string; id: string }>;
  const items = inspections.flatMap((inspection, inspectionIndex) => [
    {
      inspection_id: inspection.id,
      item_number: 1,
      day_of_week: 1,
      status: 'ok',
      item_description: 'Lights and beacons checked',
      comments: 'Demo pass item.',
    },
    {
      inspection_id: inspection.id,
      item_number: 2,
      day_of_week: 1,
      status: inspectionIndex % 4 === 0 ? 'attention' : 'ok',
      item_description: inspection.table === 'plant_inspections' ? 'Hydraulics and leaks' : 'Tyres and wheels',
      comments: inspectionIndex % 4 === 0 ? 'Demo observation raised for follow-up.' : 'No issue found.',
    },
    {
      inspection_id: inspection.id,
      item_number: 3,
      day_of_week: 1,
      status: 'na',
      item_description: 'Ancillary equipment',
      comments: 'Not applicable for this demo asset.',
    },
  ]);

  if (items.length > 0) {
    const { error } = await supabase.from('inspection_items').insert(items);
    if (error) throw error;
  }

  console.log(`Ready: ${inspections.length} demo daily check records`);
}

async function seedWorkshopTasks(
  supabase: ScriptSupabaseClient,
  profiles: SeededProfile[],
  seededVehicles: SeededVehicle[],
  seededHgvs: SeededHgv[],
  seededPlant: SeededPlant[]
): Promise<void> {
  const manager = profiles.find((profile) => profile.key === 'manager') || profiles[0];

  const { data: existingCategory } = await supabase
    .from('workshop_task_categories')
    .select('id')
    .eq('slug', 'demo-repairs')
    .maybeSingle();

  const categoryQuery = existingCategory?.id
    ? supabase
        .from('workshop_task_categories')
        .update({
          applies_to: 'van',
          name: 'Demo Repairs',
          is_active: true,
          sort_order: 1,
          ui_color: '#f97316',
          requires_subcategories: true,
        })
        .eq('id', existingCategory.id)
    : supabase.from('workshop_task_categories').insert({
        applies_to: 'van',
        name: 'Demo Repairs',
        slug: 'demo-repairs',
        is_active: true,
        sort_order: 1,
        ui_color: '#f97316',
        created_by: manager.id,
        requires_subcategories: true,
      });

  const { data: category, error: categoryError } = await categoryQuery.select('id').single();
  if (categoryError) throw categoryError;
  if (!category?.id) return;

  const { data: existingTasks } = await supabase
    .from('actions')
    .select('id')
    .like('title', 'Demo workshop:%');
  const existingTaskIds = (existingTasks || []).map((task: { id: string }) => task.id);
  await deleteByIds(supabase, 'workshop_task_comments', existingTaskIds, 'task_id');
  await deleteByIds(supabase, 'actions', existingTaskIds);

  const { error: deleteSubcategoriesError } = await supabase
    .from('workshop_task_subcategories')
    .delete()
    .eq('category_id', category.id);
  if (deleteSubcategoriesError) throw deleteSubcategoriesError;

  const { data: subcategories, error: subcategoryError } = await supabase
    .from('workshop_task_subcategories')
    .insert([
      { category_id: category.id, name: 'Electrical', slug: 'demo-electrical', sort_order: 1, created_by: manager.id },
      { category_id: category.id, name: 'Hydraulics', slug: 'demo-hydraulics', sort_order: 2, created_by: manager.id },
      { category_id: category.id, name: 'Service', slug: 'demo-service', sort_order: 3, created_by: manager.id },
    ])
    .select('id, slug');
  if (subcategoryError) throw subcategoryError;

  const subcategoryBySlug = new Map((subcategories || []).map((item: { id: string; slug: string }) => [item.slug, item.id]));
  const electricalSubcategoryId = subcategoryBySlug.get('demo-electrical') || subcategories?.[0]?.id;
  const hydraulicSubcategoryId = subcategoryBySlug.get('demo-hydraulics') || electricalSubcategoryId;
  const serviceSubcategoryId = subcategoryBySlug.get('demo-service') || electricalSubcategoryId;

  const tasks = [
    seededVehicles[0]?.id && {
      title: 'Demo workshop: replace nearside marker light',
      description: 'Fictional van defect created from a daily check.',
      priority: 'medium',
      status: 'pending',
      action_type: 'workshop_vehicle_task',
      van_id: seededVehicles[0].id,
      workshop_category_id: category.id,
      workshop_subcategory_id: electricalSubcategoryId,
      created_by: manager.id,
      workshop_comments: 'Seeded demo task for workshop workflow previews.',
    },
    seededVehicles[1]?.id && {
      title: 'Demo workshop: service van brake inspection',
      description: 'Preventative maintenance task for a demo service van.',
      priority: 'high',
      status: 'in_progress',
      action_type: 'workshop_vehicle_task',
      van_id: seededVehicles[1].id,
      workshop_category_id: category.id,
      workshop_subcategory_id: serviceSubcategoryId,
      created_by: manager.id,
      workshop_comments: 'Brake inspection started by workshop team.',
    },
    seededVehicles[2]?.id && {
      title: 'Demo workshop: repair damaged cone rack',
      description: 'Fictional minor repair for demo van equipment.',
      priority: 'low',
      status: 'completed',
      action_type: 'workshop_vehicle_task',
      van_id: seededVehicles[2].id,
      workshop_category_id: category.id,
      workshop_subcategory_id: serviceSubcategoryId,
      created_by: manager.id,
      workshop_comments: 'Completed demo repair for historical workflow state.',
    },
    seededHgvs[0]?.id && {
      title: 'Demo workshop: inspect tyre pressure report',
      description: 'Follow-up task for an HGV daily check observation.',
      priority: 'low',
      status: 'in_progress',
      action_type: 'workshop_vehicle_task',
      hgv_id: seededHgvs[0].id,
      workshop_category_id: category.id,
      workshop_subcategory_id: serviceSubcategoryId,
      created_by: manager.id,
      workshop_comments: 'Technician assigned for afternoon check.',
    },
    seededHgvs[1]?.id && {
      title: 'Demo workshop: six-weekly inspection preparation',
      description: 'Fictional HGV compliance preparation task.',
      priority: 'medium',
      status: 'pending',
      action_type: 'workshop_vehicle_task',
      hgv_id: seededHgvs[1].id,
      workshop_category_id: category.id,
      workshop_subcategory_id: serviceSubcategoryId,
      created_by: manager.id,
      workshop_comments: 'Awaiting workshop bay allocation.',
    },
    seededPlant[0]?.id && {
      title: 'Demo workshop: hydraulic hose service',
      description: 'Plant service observation requiring planned maintenance.',
      priority: 'high',
      status: 'on_hold',
      action_type: 'workshop_vehicle_task',
      plant_id: seededPlant[0].id,
      workshop_category_id: category.id,
      workshop_subcategory_id: hydraulicSubcategoryId,
      created_by: manager.id,
      workshop_comments: 'Awaiting replacement hose from supplier.',
    },
    seededPlant[1]?.id && {
      title: 'Demo workshop: roller vibration check',
      description: 'Follow-up task for a fictional plant operator observation.',
      priority: 'medium',
      status: 'pending',
      action_type: 'workshop_vehicle_task',
      plant_id: seededPlant[1].id,
      workshop_category_id: category.id,
      workshop_subcategory_id: hydraulicSubcategoryId,
      created_by: manager.id,
      workshop_comments: 'Planned inspection before next hire.',
    },
  ].filter(Boolean);

  const { data: insertedTasks, error } = await supabase.from('actions').insert(tasks).select('id');
  if (error) throw error;

  if (insertedTasks?.length) {
    await supabase.from('workshop_task_comments').insert(
      insertedTasks.map((task: { id: string }, index: number) => ({
        task_id: task.id,
        author_id: manager.id,
        body: index === 0 ? 'Demo comment: part ordered and task ready to schedule.' : 'Demo comment: progress updated.',
      }))
    );
  }

  console.log(`Ready: ${tasks.length} demo workshop tasks`);
}

async function seedMaintenance(
  supabase: ScriptSupabaseClient,
  profiles: SeededProfile[],
  seededVehicles: SeededVehicle[],
  seededHgvs: SeededHgv[],
  seededPlant: SeededPlant[]
): Promise<void> {
  const manager = profiles.find((profile) => profile.key === 'manager') || profiles[0];

  for (const [index, van] of seededVehicles.entries()) {
    await supabase.from('vehicle_maintenance').upsert(
      {
        van_id: van.id,
        current_mileage: 48000 + index * 1200,
        last_service_mileage: 42000 + index * 1000,
        next_service_mileage: 54000 + index * 1200,
        mot_due_date: isoDate(30 + index * 20),
        tax_due_date: isoDate(90 + index * 15),
        notes: 'Demo maintenance record for van fleet overview.',
        last_updated_by: manager.id,
      },
      { onConflict: 'van_id' }
    );
  }

  for (const [index, hgv] of seededHgvs.entries()) {
    await supabase.from('vehicle_maintenance').upsert(
      {
        hgv_id: hgv.id,
        current_mileage: 84500 + index * 18000,
        last_service_mileage: 78000 + index * 15000,
        next_service_mileage: 90000 + index * 18000,
        six_weekly_inspection_due_date: isoDate(12 + index * 7),
        taco_calibration_due_date: isoDate(120 + index * 30),
        notes: 'Demo HGV service and compliance record.',
        last_updated_by: manager.id,
      },
      { onConflict: 'hgv_id' }
    );
  }

  for (const [index, plant] of seededPlant.entries()) {
    await supabase.from('vehicle_maintenance').upsert(
      {
        plant_id: plant.id,
        current_hours: 1800 + index * 300,
        last_service_hours: 1500 + index * 250,
        next_service_hours: 2000 + index * 300,
        six_weekly_inspection_due_date: isoDate(18 + index * 14),
        notes: 'Demo plant service schedule record.',
        last_updated_by: manager.id,
      },
      { onConflict: 'plant_id' }
    );
  }

  await supabase.from('maintenance_history').delete().like('comment', 'Demo maintenance:%');

  const historyRows = [
    seededVehicles[0]?.id && {
      van_id: seededVehicles[0].id,
      field_name: 'mot_due_date',
      old_value: isoDate(7),
      new_value: isoDate(30),
      value_type: 'date',
      comment: 'Demo maintenance: MOT date updated after booking.',
      updated_by: manager.id,
      updated_by_name: manager.fullName,
    },
    seededHgvs[0]?.id && {
      hgv_id: seededHgvs[0].id,
      field_name: 'six_weekly_inspection_due_date',
      old_value: isoDate(5),
      new_value: isoDate(12),
      value_type: 'date',
      comment: 'Demo maintenance: six-weekly inspection rescheduled.',
      updated_by: manager.id,
      updated_by_name: manager.fullName,
    },
    seededPlant[0]?.id && {
      plant_id: seededPlant[0].id,
      field_name: 'next_service_hours',
      old_value: '1900',
      new_value: '2000',
      value_type: 'mileage',
      comment: 'Demo maintenance: service interval confirmed.',
      updated_by: manager.id,
      updated_by_name: manager.fullName,
    },
  ].filter(Boolean);

  if (historyRows.length) {
    const { error } = await supabase.from('maintenance_history').insert(historyRows);
    if (error) throw error;
  }

  console.log('Ready: demo maintenance schedules and history');
}

async function seedProjects(supabase: ScriptSupabaseClient, profiles: SeededProfile[]): Promise<void> {
  const admin = profiles.find((profile) => profile.key === 'admin') || profiles[0];
  const employees = profiles.filter((profile) => profile.key !== 'admin');
  const { data: documentType, error: typeError } = await supabase
    .from('project_document_types')
    .upsert(
      {
        name: 'Demo Project Pack',
        description: 'Fictional document type for DigiDocs demonstrations',
        required_signature: true,
        is_active: true,
        sort_order: 2,
        created_by: admin.id,
      },
      { onConflict: 'name' }
    )
    .select('id')
    .single();

  if (typeError) throw typeError;
  if (!documentType?.id) return;

  const { data: existingDocs } = await supabase
    .from('rams_documents')
    .select('id')
    .in('title', [
      'Demo A47 Resurfacing RAMS',
      'Demo Yard Drainage Method Statement',
      'Demo Emergency Reinstatement Pack',
      'Demo Plant Lift Plan',
    ]);
  const existingDocIds = (existingDocs || []).map((doc: { id: string }) => doc.id);
  await deleteByIds(supabase, 'project_favourites', existingDocIds, 'document_id');
  await deleteByIds(supabase, 'rams_assignments', existingDocIds, 'rams_document_id');
  await deleteByIds(supabase, 'rams_documents', existingDocIds);

  const { data: docs, error } = await supabase
    .from('rams_documents')
    .insert([
      {
        title: 'Demo A47 Resurfacing RAMS',
        description: 'Fictional risk assessment and method statement for resurfacing works.',
        file_name: 'demo-a47-resurfacing-rams.pdf',
        file_path: 'demo/project-documents/demo-a47-resurfacing-rams.pdf',
        file_size: 842000,
        file_type: 'application/pdf',
        uploaded_by: admin.id,
        document_type_id: documentType.id,
        is_active: true,
      },
      {
        title: 'Demo Yard Drainage Method Statement',
        description: 'Fictional project document showing assignment and signature states.',
        file_name: 'demo-yard-drainage-method-statement.pdf',
        file_path: 'demo/project-documents/demo-yard-drainage-method-statement.pdf',
        file_size: 616000,
        file_type: 'application/pdf',
        uploaded_by: admin.id,
        document_type_id: documentType.id,
        is_active: true,
      },
      {
        title: 'Demo Emergency Reinstatement Pack',
        description: 'Fictional urgent works pack with mixed assignment states.',
        file_name: 'demo-emergency-reinstatement-pack.pdf',
        file_path: 'demo/project-documents/demo-emergency-reinstatement-pack.pdf',
        file_size: 724000,
        file_type: 'application/pdf',
        uploaded_by: admin.id,
        document_type_id: documentType.id,
        is_active: true,
      },
      {
        title: 'Demo Plant Lift Plan',
        description: 'Fictional plant lift plan for demonstrating project document libraries.',
        file_name: 'demo-plant-lift-plan.pdf',
        file_path: 'demo/project-documents/demo-plant-lift-plan.pdf',
        file_size: 538000,
        file_type: 'application/pdf',
        uploaded_by: admin.id,
        document_type_id: documentType.id,
        is_active: true,
      },
    ])
    .select('id');

  if (error) throw error;
  const assignments = (docs || []).flatMap((doc: { id: string }, docIndex: number) =>
    employees.map((employee, employeeIndex) => ({
      rams_document_id: doc.id,
      employee_id: employee.id,
      assigned_by: admin.id,
      status: docIndex === 0 && employeeIndex === 0 ? 'signed' : employeeIndex === 1 ? 'read' : 'pending',
      read_at: employeeIndex <= 1 ? dateTime(-1, 10) : null,
      signed_at: docIndex === 0 && employeeIndex === 0 ? dateTime(-1, 11) : null,
      signature_data: docIndex === 0 && employeeIndex === 0 ? 'data:image/png;base64,demo' : null,
      comments: 'Demo project assignment.',
    }))
  );

  if (assignments.length) {
    const { error: assignmentsError } = await supabase.from('rams_assignments').insert(assignments);
    if (assignmentsError) throw assignmentsError;
  }

  if (docs?.[0]?.id) {
    await supabase.from('project_favourites').upsert(
      { document_id: docs[0].id, user_id: admin.id },
      { onConflict: 'document_id,user_id' }
    );
  }

  console.log(`Ready: ${docs?.length || 0} demo project documents`);
}

async function upsertInventoryLocation(
  supabase: ScriptSupabaseClient,
  payload: Record<string, unknown>
): Promise<string> {
  const { data: existing } = await supabase
    .from('inventory_locations')
    .select('id')
    .eq('name', payload.name)
    .maybeSingle();

  const query = existing?.id
    ? supabase.from('inventory_locations').update(payload).eq('id', existing.id)
    : supabase.from('inventory_locations').insert(payload);

  const { data, error } = await query.select('id').single();
  if (error) throw error;
  if (!data?.id) throw new Error(`Unable to seed inventory location ${payload.name}`);
  return data.id;
}

async function seedInventory(
  supabase: ScriptSupabaseClient,
  profiles: SeededProfile[],
  seededVehicles: SeededVehicle[],
  seededPlant: SeededPlant[]
): Promise<void> {
  const manager = profiles.find((profile) => profile.key === 'manager') || profiles[0];
  const yardLocationId = await upsertInventoryLocation(supabase, {
    name: 'Demo Main Yard',
    description: 'Central stores location for demo inventory.',
    is_active: true,
    created_by: manager.id,
    updated_by: manager.id,
  });
  const vanLocationId = seededVehicles[0]?.id
    ? await upsertInventoryLocation(supabase, {
        name: 'Demo Service Van Stores',
        description: 'Mobile stock held on the demo service van.',
        is_active: true,
        linked_van_id: seededVehicles[0].id,
        created_by: manager.id,
        updated_by: manager.id,
      })
    : yardLocationId;
  const plantLocationId = seededPlant[0]?.id
    ? await upsertInventoryLocation(supabase, {
        name: 'Demo Plant Container',
        description: 'Small tools and equipment assigned to demo plant operations.',
        is_active: true,
        linked_plant_id: seededPlant[0].id,
        created_by: manager.id,
        updated_by: manager.id,
      })
    : yardLocationId;

  const inventoryItems = [
    { item_number: 'DD-001', name: 'Laser Level Kit', category: 'tools', location_id: yardLocationId },
    { item_number: 'DD-002', name: 'Temporary Road Signs Pack', category: 'signs', location_id: vanLocationId },
    { item_number: 'DD-003', name: 'Portable Generator', category: 'equipment', location_id: plantLocationId },
    { item_number: 'DD-004', name: 'Hydraulic Breaker Attachment', category: 'hired_plant', location_id: plantLocationId },
    { item_number: 'DD-005', name: 'CAT Scanner and Genny', category: 'tools', location_id: yardLocationId },
    { item_number: 'DD-006', name: 'Pedestrian Barrier Set', category: 'signs', location_id: yardLocationId },
    { item_number: 'DD-007', name: 'Confined Space Gas Monitor', category: 'equipment', location_id: vanLocationId },
    { item_number: 'DD-008', name: 'Plate Compactor', category: 'equipment', location_id: plantLocationId },
    { item_number: 'DD-009', name: 'Road Plate Lifting Chains', category: 'tools', location_id: yardLocationId },
    { item_number: 'DD-010', name: 'Stihl Saw Kit', category: 'tools', location_id: vanLocationId },
    { item_number: 'DD-011', name: 'Trench Box Pins Set', category: 'equipment', location_id: plantLocationId },
    { item_number: 'DD-012', name: 'Portable Lighting Tower', category: 'hired_plant', location_id: yardLocationId },
  ];

  const { data: items, error } = await supabase
    .from('inventory_items')
    .upsert(
      inventoryItems.map((item) => ({
        ...item,
        item_number_normalized: normaliseInventoryNumber(item.item_number),
        last_checked_at: isoDate(-2),
        status: 'active',
        source: 'demo-seed',
        source_reference: 'DigiDocs demo inventory',
        created_by: manager.id,
        updated_by: manager.id,
      })),
      { onConflict: 'item_number_normalized' }
    )
    .select('id, location_id');

  if (error) throw error;
  await supabase.from('inventory_item_movements').delete().like('note', 'Demo inventory:%');
  if (items?.length) {
    const { error: movementError } = await supabase.from('inventory_item_movements').insert(
      items.map((item: { id: string; location_id: string }) => ({
        item_id: item.id,
        to_location_id: item.location_id,
        moved_by: manager.id,
        note: 'Demo inventory: seeded opening stock position.',
      }))
    );
    if (movementError) throw movementError;
  }

  console.log(`Ready: ${items?.length || 0} demo inventory items`);
}

async function main() {
  assertDemoMode();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  }

  const supabase = createClient<any>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  await ensureDemoRoles(supabase);
  await ensureDemoTeams(supabase);
  const profiles = await ensureDemoUsers(supabase);
  const seededVehicles = await seedVehicles(supabase);
  const seededHgvs = await seedHgvs(supabase);
  const seededPlant = await seedPlant(supabase, profiles);
  await runOptionalStep('demo timesheets and entries', () => seedTimesheets(supabase, profiles));
  await runOptionalStep('demo daily inspections', () =>
    seedInspections(supabase, profiles, seededVehicles, seededHgvs, seededPlant)
  );
  await runOptionalStep('demo maintenance and service schedules', () =>
    seedMaintenance(supabase, profiles, seededVehicles, seededHgvs, seededPlant)
  );
  await runOptionalStep('demo project documents', () => seedProjects(supabase, profiles));
  await runOptionalStep('demo inventory', () => seedInventory(supabase, profiles, seededVehicles, seededPlant));
  await runOptionalStep('demo customer and quote', () => seedCustomersAndQuotes(supabase, profiles));
  await runOptionalStep('demo toolbox message', () => seedMessages(supabase, profiles));
  await runOptionalStep('demo absence request', () => seedAbsence(supabase, profiles));
  await runOptionalStep('demo workshop task', () =>
    seedWorkshopTasks(supabase, profiles, seededVehicles, seededHgvs, seededPlant)
  );

  console.log('Demo seed complete. Login personas use password DemoPass123!');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
