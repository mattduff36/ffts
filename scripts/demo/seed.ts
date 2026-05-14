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
  superAdmin: boolean;
}

interface SeededProfile extends DemoUser {
  id: string;
}

interface SeededVehicle {
  id: string;
  reg_number: string;
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
    superAdmin: true,
  },
  {
    key: 'manager',
    email: `morgan.reid@${demoDomain}`,
    fullName: 'Morgan Reid',
    employeeId: 'DEMO-MGR',
    roleName: 'manager',
    superAdmin: false,
  },
  {
    key: 'employee',
    email: `jamie.carter@${demoDomain}`,
    fullName: 'Jamie Carter',
    employeeId: 'DEMO-EMP',
    roleName: 'employee',
    superAdmin: false,
  },
  {
    key: 'contractor',
    email: `taylor.brooks@${demoDomain}`,
    fullName: 'Taylor Brooks',
    employeeId: 'DEMO-CON',
    roleName: 'employee',
    superAdmin: false,
  },
];

const vans = [{ reg_number: 'DM24VAN', vehicle_type: 'Van', status: 'active' }];

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
        role_id: roleId,
        super_admin: user.superAdmin,
        must_change_password: false,
      },
      { onConflict: 'id' }
    );

    if (error) throw error;
    seededProfiles.push({ ...user, id: authUser.id });
    console.log(`Ready: ${user.fullName} (${user.email})`);
  }

  return seededProfiles;
}

async function seedVehicles(supabase: ScriptSupabaseClient): Promise<SeededVehicle[]> {
  const { data: category } = await supabase.from('van_categories').select('id').limit(1).maybeSingle();
  if (!category?.id) {
    console.warn('Vehicle seed skipped: no van category exists.');
    return [];
  }

  const { data, error } = await supabase
    .from('vans')
    .upsert(
      vans.map((van) => ({ ...van, category_id: category.id })),
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

async function seedTimesheets(supabase: ScriptSupabaseClient, profiles: SeededProfile[]): Promise<void> {
  const manager = profiles.find((profile) => profile.key === 'manager') || profiles[0];
  const employees = profiles.filter((profile) => profile.key === 'employee' || profile.key === 'contractor');

  for (const [index, employee] of employees.entries()) {
    const { data: timesheet, error } = await supabase
      .from('timesheets')
      .upsert(
        {
          user_id: employee.id,
          reg_number: index === 0 ? 'DM24VAN' : 'DM24HGV',
          week_ending: weekEnding(index),
          status: index === 0 ? 'submitted' : 'approved',
          submitted_at: new Date().toISOString(),
          reviewed_by: index === 0 ? null : manager.id,
          reviewed_at: index === 0 ? null : new Date().toISOString(),
          manager_comments: index === 0 ? null : 'Demo approval for a completed week.',
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
}

async function seedCustomersAndQuotes(supabase: ScriptSupabaseClient, profiles: SeededProfile[]): Promise<void> {
  const admin = profiles.find((profile) => profile.key === 'admin') || profiles[0];
  const customerPayload = {
    company_name: 'Demo Civil Engineering Ltd',
    short_name: 'Demo Civils',
    contact_name: 'Casey Morgan',
    contact_email: `casey.morgan@${demoDomain}`,
    contact_phone: '01632 960000',
    city: 'Exampletown',
    postcode: 'DE1 2MO',
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
  if (!customer?.id) return;

  const { data: existingQuote } = await supabase
    .from('quotes')
    .select('id, quote_thread_id')
    .eq('quote_reference', 'DEMO-6001-AS')
    .maybeSingle();
  const quoteId = existingQuote?.id || randomUUID();

  const quotePayload = {
    id: quoteId,
    quote_reference: 'DEMO-6001-AS',
    base_quote_reference: 'DEMO-6001',
    quote_thread_id: existingQuote?.quote_thread_id || quoteId,
    customer_id: customer.id,
    requester_id: admin.id,
    requester_initials: 'AS',
    attention_name: 'Casey Morgan',
    attention_email: `casey.morgan@${demoDomain}`,
    subject_line: 'Demo yard resurfacing works',
    project_description: 'Fictional resurfacing and drainage works used for product demonstrations.',
    subtotal: 12500,
    total: 12500,
    status: 'sent',
    created_by: admin.id,
    updated_by: admin.id,
    sent_at: new Date().toISOString(),
  };

  const quoteQuery = existingQuote?.id
    ? supabase.from('quotes').update(quotePayload).eq('id', existingQuote.id)
    : supabase.from('quotes').insert(quotePayload);

  const { data: quote, error: quoteError } = await quoteQuery.select('id').single();

  if (quoteError) throw quoteError;
  if (!quote?.id) return;

  await supabase.from('quote_line_items').delete().eq('quote_id', quote.id);

  const { error: lineItemError } = await supabase.from('quote_line_items').insert([
    {
      quote_id: quote.id,
      description: 'Demo labour, plant, and materials package',
      quantity: 1,
      unit: 'item',
      unit_rate: 12500,
      line_total: 12500,
      sort_order: 1,
    },
  ]);
  if (lineItemError && !lineItemError.message.includes('duplicate')) throw lineItemError;
}

async function seedMessages(supabase: ScriptSupabaseClient, profiles: SeededProfile[]): Promise<void> {
  const manager = profiles.find((profile) => profile.key === 'manager') || profiles[0];
  const recipients = profiles.filter((profile) => profile.key === 'employee' || profile.key === 'contractor');
  const { data: message, error } = await supabase
    .from('messages')
    .insert({
      type: 'TOOLBOX_TALK',
      subject: 'Demo toolbox talk: site access',
      body: 'This is a fictional toolbox talk used to demonstrate message acknowledgement workflows.',
      priority: 'LOW',
      sender_id: manager.id,
      created_via: 'demo-seed',
    })
    .select('id')
    .single();

  if (error) throw error;
  if (!message?.id) return;

  const { error: recipientsError } = await supabase.from('message_recipients').insert(
    recipients.map((recipient) => ({
      message_id: message.id,
      user_id: recipient.id,
      status: recipient.key === 'employee' ? 'PENDING' : 'SIGNED',
      signed_at: recipient.key === 'contractor' ? new Date().toISOString() : null,
    }))
  );
  if (recipientsError) throw recipientsError;
}

async function seedAbsence(supabase: ScriptSupabaseClient, profiles: SeededProfile[]): Promise<void> {
  const employee = profiles.find((profile) => profile.key === 'employee') || profiles[0];
  const manager = profiles.find((profile) => profile.key === 'manager') || profiles[0];
  const { data: reason, error: reasonError } = await supabase
    .from('absence_reasons')
    .upsert(
      {
        name: 'Annual Leave',
        is_paid: true,
        color: '#22c55e',
        is_active: true,
      },
      { onConflict: 'name' }
    )
    .select('id')
    .single();

  if (reasonError) throw reasonError;
  if (!reason?.id) return;

  await supabase
    .from('absences')
    .delete()
    .eq('profile_id', employee.id)
    .eq('notes', 'Fictional approved demo annual leave.');

  const { error } = await supabase.from('absences').insert({
    profile_id: employee.id,
    date: isoDate(14),
    end_date: isoDate(18),
    reason_id: reason.id,
    duration_days: 5,
    status: 'approved',
    created_by: employee.id,
    approved_by: manager.id,
    approved_at: new Date().toISOString(),
    notes: 'Fictional approved demo annual leave.',
  });

  if (error) throw error;
}

async function seedWorkshopTasks(
  supabase: ScriptSupabaseClient,
  profiles: SeededProfile[],
  seededVehicles: SeededVehicle[]
): Promise<void> {
  const manager = profiles.find((profile) => profile.key === 'manager') || profiles[0];
  const vehicle = seededVehicles.find((item) => item.reg_number === 'DM24VAN') || seededVehicles[0];
  if (!vehicle?.id) return;

  const { error } = await supabase.from('actions').insert({
    title: 'Demo defect: replace nearside marker light',
    description: 'Fictional workshop task created from a demo inspection defect.',
    priority: 'medium',
    status: 'pending',
    action_type: 'workshop_vehicle_task',
    van_id: vehicle.id,
    created_by: manager.id,
    workshop_comments: 'Seeded demo task for workshop workflow previews.',
  });

  if (error) throw error;
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
  const profiles = await ensureDemoUsers(supabase);
  const seededVehicles = await seedVehicles(supabase);
  await runOptionalStep('demo timesheets and entries', () => seedTimesheets(supabase, profiles));
  await runOptionalStep('demo customer and quote', () => seedCustomersAndQuotes(supabase, profiles));
  await runOptionalStep('demo toolbox message', () => seedMessages(supabase, profiles));
  await runOptionalStep('demo absence request', () => seedAbsence(supabase, profiles));
  await runOptionalStep('demo workshop task', () => seedWorkshopTasks(supabase, profiles, seededVehicles));

  console.log('Demo seed complete. Login personas use password DemoPass123!');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
