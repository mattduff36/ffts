/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

type ScriptSupabaseClient = ReturnType<typeof createClient<any>>;

interface DemoUser {
  key: string;
  email: string;
  fullName: string;
  employeeId: string;
  roleName: string;
  teamId: string;
  superAdmin: boolean;
  phoneNumber?: string;
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

const demoManagers: DemoUser[] = [
  {
    key: 'manager',
    email: `morgan.reid@${demoDomain}`,
    fullName: 'Morgan Reid',
    employeeId: 'DEMO-MGR-01',
    roleName: 'manager',
    teamId: 'transport',
    superAdmin: false,
  },
  {
    key: 'manager-02',
    email: `harper.evans@${demoDomain}`,
    fullName: 'Harper Evans',
    employeeId: 'DEMO-MGR-02',
    roleName: 'manager',
    teamId: 'civils',
    superAdmin: false,
  },
  {
    key: 'manager-03',
    email: `casey.turner@${demoDomain}`,
    fullName: 'Casey Turner',
    employeeId: 'DEMO-MGR-03',
    roleName: 'manager',
    teamId: 'plant',
    superAdmin: false,
  },
  {
    key: 'manager-04',
    email: `elliot.hughes@${demoDomain}`,
    fullName: 'Elliot Hughes',
    employeeId: 'DEMO-MGR-04',
    roleName: 'manager',
    teamId: 'workshop',
    superAdmin: false,
  },
];

const demoEmployees: DemoUser[] = [
  ['employee', 'Jamie Carter', 'civils'],
  ['contractor', 'Taylor Brooks', 'plant'],
  ['employee-03', 'Alex Parker', 'transport'],
  ['employee-04', 'Bailey Morris', 'civils'],
  ['employee-05', 'Charlie Bennett', 'surfacing'],
  ['employee-06', 'Drew Campbell', 'drainage'],
  ['employee-07', 'Emery Foster', 'traffic'],
  ['employee-08', 'Finley Ward', 'transport'],
  ['employee-09', 'Gray Ellis', 'plant'],
  ['employee-10', 'Hayden Price', 'workshop'],
  ['employee-11', 'Indigo Kelly', 'surfacing'],
  ['employee-12', 'Jules Morgan', 'drainage'],
  ['employee-13', 'Kai Richardson', 'traffic'],
  ['employee-14', 'Logan Bell', 'civils'],
  ['employee-15', 'Marley Brooks', 'plant'],
  ['employee-16', 'Nico James', 'transport'],
  ['employee-17', 'Oakley Cooper', 'surfacing'],
  ['employee-18', 'Peyton Wood', 'drainage'],
  ['employee-19', 'Quinn Edwards', 'workshop'],
  ['employee-20', 'Rowan Hayes', 'traffic'],
].map(([key, fullName, teamId], index) => {
  const emailName = fullName.toLowerCase().replace(/\s+/g, '.');
  return {
    key,
    email: `${emailName}@${demoDomain}`,
    fullName,
    employeeId: `DEMO-EMP-${String(index + 1).padStart(2, '0')}`,
    roleName: 'employee',
    teamId,
    superAdmin: false,
  };
});

const users: DemoUser[] = [
  {
    key: 'admin',
    email: `avery.stone@${demoDomain}`,
    fullName: 'Avery Stone',
    employeeId: 'DEMO-ADM-01',
    roleName: 'admin',
    teamId: 'management',
    superAdmin: false,
  },
  {
    key: 'admin-02',
    email: `riley.cooper@${demoDomain}`,
    fullName: 'Riley Cooper',
    employeeId: 'DEMO-ADM-02',
    roleName: 'admin',
    teamId: 'management',
    superAdmin: false,
  },
  ...demoManagers,
  ...demoEmployees,
];

const vans = [
  { reg_number: 'DM24VAN', vehicle_type: 'Van', status: 'active', nickname: 'Demo Service Van' },
  { reg_number: 'DM24KIT', vehicle_type: 'Van', status: 'active', nickname: 'Demo Stores Van' },
  { reg_number: 'DM24OPS', vehicle_type: 'Van', status: 'active', nickname: 'Demo Ops Van' },
  { reg_number: 'DM24SUP', vehicle_type: 'Van', status: 'active', nickname: 'Demo Supervisor Van' },
  { reg_number: 'DM24TMP', vehicle_type: 'Van', status: 'active', nickname: 'Demo Traffic Van' },
  { reg_number: 'DM24SPR', vehicle_type: 'Van', status: 'maintenance', nickname: 'Demo Spare Van' },
  { reg_number: 'DM24CIV', vehicle_type: 'Van', status: 'active', nickname: 'Demo Civils Van' },
  { reg_number: 'DM24DRN', vehicle_type: 'Van', status: 'active', nickname: 'Demo Drainage Van' },
  { reg_number: 'DM24SRF', vehicle_type: 'Van', status: 'active', nickname: 'Demo Surfacing Van' },
  { reg_number: 'DM24TM1', vehicle_type: 'Van', status: 'active', nickname: 'Demo Traffic Support 1' },
  { reg_number: 'DM24TM2', vehicle_type: 'Van', status: 'active', nickname: 'Demo Traffic Support 2' },
  { reg_number: 'DM24WRK', vehicle_type: 'Van', status: 'active', nickname: 'Demo Workshop Van' },
  { reg_number: 'DM24FLT', vehicle_type: 'Van', status: 'maintenance', nickname: 'Demo Fleet Loan Van' },
  { reg_number: 'DM24YRD', vehicle_type: 'Van', status: 'active', nickname: 'Demo Yard Van' },
  { reg_number: 'DM24SUR', vehicle_type: 'Van', status: 'active', nickname: 'Demo Survey Van' },
  { reg_number: 'DM24PAV', vehicle_type: 'Van', status: 'active', nickname: 'Demo Paving Van' },
];

const hgvs = [
  { reg_number: 'DM24HGV', status: 'active', nickname: 'Demo Tipper', current_mileage: 84500 },
  { reg_number: 'DM24ART', status: 'active', nickname: 'Demo Artic', current_mileage: 128900 },
  { reg_number: 'DM24SKP', status: 'active', nickname: 'Demo Skip Lorry', current_mileage: 97600 },
  { reg_number: 'DM24LOW', status: 'maintenance', nickname: 'Demo Low Loader', current_mileage: 154200 },
  { reg_number: 'DM24GRB', status: 'active', nickname: 'Demo Grab Lorry', current_mileage: 110450 },
  { reg_number: 'DM24WAG', status: 'active', nickname: 'Demo Wagon and Drag', current_mileage: 139300 },
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
  {
    plant_id: 'DM-ME-005',
    reg_number: 'DM24MEX',
    nickname: 'Demo Mini Excavator',
    make: 'Kubota',
    model: 'KX027',
    serial_number: 'DEMOKX027005',
    year: 2022,
    current_hours: 980,
    status: 'active',
  },
  {
    plant_id: 'DM-CP-006',
    reg_number: 'DM24CMP',
    nickname: 'Demo Compactor',
    make: 'Ammann',
    model: 'ASC70',
    serial_number: 'DEMOASC70006',
    year: 2019,
    current_hours: 2485,
    status: 'active',
  },
  {
    plant_id: 'DM-LT-007',
    reg_number: 'DM24LGT',
    nickname: 'Demo Lighting Tower',
    make: 'Trime',
    model: 'X-ECO',
    serial_number: 'DEMOTRIME007',
    year: 2023,
    current_hours: 410,
    status: 'active',
  },
  {
    plant_id: 'DM-BR-008',
    reg_number: 'DM24BRK',
    nickname: 'Demo Breaker Pack',
    make: 'Atlas Copco',
    model: 'LP13',
    serial_number: 'DEMOACLP13008',
    year: 2021,
    current_hours: 1340,
    status: 'active',
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
        description: 'Demo administrator with admin controls but not owner superadmin access',
        role_class: 'admin',
        is_super_admin: false,
        is_manager_admin: true,
      },
      {
        name: 'superadmin',
        display_name: 'Super Administrator',
        description: 'Hidden owner-only superadmin role for the hosted demo operator',
        role_class: 'admin',
        is_super_admin: true,
        is_manager_admin: true,
      },
      {
        name: 'manager',
        display_name: 'Manager',
        description: 'Demo manager with team oversight and approval access',
        role_class: 'manager',
        is_super_admin: false,
        is_manager_admin: true,
      },
      {
        name: 'employee',
        display_name: 'Employee',
        description: 'Demo employee profile',
        role_class: 'employee',
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
      { id: 'surfacing', name: 'Surfacing', code: 'SRF', active: true, timesheet_type: 'civils' },
      { id: 'drainage', name: 'Drainage', code: 'DRN', active: true, timesheet_type: 'civils' },
      { id: 'traffic', name: 'Traffic Management', code: 'TMG', active: true, timesheet_type: 'civils' },
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
        phone_number: user.phoneNumber || `01632 960${String(seededProfiles.length + 101).padStart(3, '0')}`,
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
  const managerByTeam = new Map<string, SeededProfile>();
  for (const profile of seededProfiles) {
    if (profile.roleName === 'manager') managerByTeam.set(profile.teamId, profile);
  }

  if (manager?.id || admin?.id) {
    for (const teamId of ['transport', 'civils', 'plant', 'workshop', 'surfacing', 'drainage', 'traffic']) {
      const primaryManager = managerByTeam.get(teamId) || manager;
      await supabase
        .from('org_teams')
        .update({
          manager_1_profile_id: primaryManager?.id || admin?.id,
          manager_2_profile_id: admin?.id || null,
        })
        .eq('id', teamId);
    }
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
  const timesheetProfiles = profiles.filter((profile) => profile.roleName !== 'admin');
  const regNumbers = ['DM24VAN', 'DM24HGV', 'DM24OPS', 'DM24KIT', 'DM24ART', 'DM24TMP'];
  const statuses = ['submitted', 'approved', 'draft', 'approved', 'submitted', 'rejected'];
  const timesheetRows = timesheetProfiles.flatMap((profile) =>
    Array.from({ length: 26 }, (_, weekOffset) => ({
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
    {
      customer: {
        company_name: 'Demo Rail Access Ltd',
        short_name: 'Demo Rail',
        contact_name: 'Ari Patel',
        city: 'Eastfield',
        postcode: 'DR1 4MO',
      },
      quote: {
        quote_reference: 'DEMO-6004-AS',
        base_quote_reference: 'DEMO-6004',
        subject_line: 'Demo possession support crew',
        project_description: 'Fictional weekend support package for a rail-adjacent works demo.',
        status: 'sent',
        sent_at: dateTime(-14, 10),
        lines: [
          ['Weekend supervisor and crew', 2, 'shifts', 2650],
          ['Small tools and welfare allowance', 1, 'item', 680],
        ],
      },
    },
    {
      customer: {
        company_name: 'Demo Retail Estates',
        short_name: 'Demo Retail',
        contact_name: 'Samira Khan',
        city: 'Westhaven',
        postcode: 'DE9 1MO',
      },
      quote: {
        quote_reference: 'DEMO-6005-RC',
        base_quote_reference: 'DEMO-6005',
        subject_line: 'Demo car park patch repairs',
        project_description: 'Fictional small works quote for patching and lining repairs.',
        status: 'approved',
        sent_at: dateTime(-21, 13),
        lines: [
          ['Patch repair crew', 3, 'days', 1250],
          ['Line marking refresh', 1, 'item', 950],
        ],
      },
    },
    {
      customer: {
        company_name: 'Demo County Council',
        short_name: 'Demo Council',
        contact_name: 'Noah Green',
        city: 'Hillford',
        postcode: 'DC2 5MO',
      },
      quote: {
        quote_reference: 'DEMO-6006-RC',
        base_quote_reference: 'DEMO-6006',
        subject_line: 'Demo footway reconstruction phase 2',
        project_description: 'Fictional follow-on works quote with a won status.',
        status: 'won',
        sent_at: dateTime(-35, 8),
        lines: [
          ['Footway reconstruction', 180, 'm2', 92],
          ['Pedestrian management', 5, 'days', 475],
        ],
      },
    },
    {
      customer: {
        company_name: 'Demo Water Networks',
        short_name: 'Demo Water',
        contact_name: 'Mika Stone',
        city: 'Rivergate',
        postcode: 'DW6 2MO',
      },
      quote: {
        quote_reference: 'DEMO-6007-AS',
        base_quote_reference: 'DEMO-6007',
        subject_line: 'Demo reinstatement framework call-off',
        project_description: 'Fictional framework-style quote for reporting and lifecycle demonstrations.',
        status: 'in_progress',
        sent_at: dateTime(-52, 9),
        lines: [
          ['Reactive reinstatement gang', 10, 'days', 1325],
          ['Plant and materials allowance', 1, 'item', 4200],
        ],
      },
    },
    {
      customer: {
        company_name: 'Demo Housing Group',
        short_name: 'Demo Housing',
        contact_name: 'Devon Clarke',
        city: 'Meadowbank',
        postcode: 'DH3 7MO',
      },
      quote: {
        quote_reference: 'DEMO-6008-RC',
        base_quote_reference: 'DEMO-6008',
        subject_line: 'Demo estate drainage remediation',
        project_description: 'Fictional quote with close-out and invoice-ready states.',
        status: 'ready_to_invoice',
        sent_at: dateTime(-72, 15),
        lines: [
          ['Drainage remediation works', 1, 'item', 18400],
          ['CCTV validation report', 1, 'item', 1250],
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
  const recipients = profiles.filter((profile) => profile.roleName === 'employee');
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
    {
      type: 'TOOLBOX_TALK',
      subject: 'Demo toolbox talk: service strike prevention',
      body: 'Fictional utilities safety briefing with mixed acknowledgement states.',
      priority: 'HIGH',
      sender_id: manager.id,
      created_via: 'demo-seed',
    },
    {
      type: 'NOTIFICATION',
      subject: 'Demo notification: revised depot opening hours',
      body: 'Fictional operational notice for demonstrating notification history.',
      priority: 'LOW',
      sender_id: manager.id,
      created_via: 'demo-seed',
    },
    {
      type: 'REMINDER',
      subject: 'Demo reminder: submit Friday timesheets',
      body: 'Fictional recurring reminder used by managers before payroll close.',
      priority: 'HIGH',
      sender_id: manager.id,
      created_via: 'demo-seed',
    },
    {
      type: 'TOOLBOX_TALK',
      subject: 'Demo toolbox talk: winter working',
      body: 'Fictional seasonal briefing for cold weather and low-light work.',
      priority: 'LOW',
      sender_id: manager.id,
      created_via: 'demo-seed',
    },
    {
      type: 'NOTIFICATION',
      subject: 'Demo notification: PPE audit next week',
      body: 'Fictional audit notice to populate manager and employee inboxes.',
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
  const manager = profiles.find((profile) => profile.key === 'manager') || profiles[0];
  const absenceProfiles = profiles.filter((profile) => profile.roleName === 'employee');

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

  const demoProfiles = [...absenceProfiles, manager].filter(Boolean);
  const { error: deleteAbsenceError } = await supabase
    .from('absences')
    .delete()
    .in('profile_id', demoProfiles.map((profile) => profile.id))
    .gte('date', isoDate(-30));
  if (deleteAbsenceError) throw deleteAbsenceError;

  const absenceRows = absenceProfiles.flatMap((profile, index) => [
    {
      profile_id: profile.id,
      date: isoDate(14 + (index % 8) * 4),
      end_date: isoDate(16 + (index % 8) * 4),
      reason_id: annualLeaveReasonId,
      duration_days: 3,
      status: index % 5 === 0 ? 'pending' : 'approved',
      created_by: profile.id,
      approved_by: index % 5 === 0 ? null : manager.id,
      approved_at: index % 5 === 0 ? null : dateTime(-index, 10),
      notes: 'Fictional demo annual leave request.',
    },
    {
      profile_id: profile.id,
      date: isoDate(60 + index * 3),
      end_date: isoDate(60 + index * 3),
      reason_id: trainingReasonId,
      duration_days: 1,
      status: 'approved',
      created_by: profile.id,
      approved_by: manager.id,
      approved_at: dateTime(-index, 9),
      notes: 'Fictional demo completed training day.',
    },
    {
      profile_id: profile.id,
      date: isoDate(120 + index),
      end_date: isoDate(120 + index),
      reason_id: medicalReasonId,
      duration_days: 0.5,
      status: index % 4 === 0 ? 'rejected' : 'approved',
      created_by: profile.id,
      approved_by: manager.id,
      approved_at: dateTime(-index, 11),
      notes: 'Fictional demo medical appointment request.',
    },
  ]);

  const { error } = await supabase.from('absences').insert([
    ...absenceRows,
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
  console.log(`Ready: ${absenceRows.length + 1} demo absence records`);
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

  await deleteByIds(supabase, 'vehicle_maintenance', seededVehicles.map((vehicle) => vehicle.id), 'van_id');
  await deleteByIds(supabase, 'vehicle_maintenance', seededHgvs.map((hgv) => hgv.id), 'hgv_id');
  await deleteByIds(supabase, 'vehicle_maintenance', seededPlant.map((plant) => plant.id), 'plant_id');

  async function insertInspection(table: string, payload: Record<string, unknown>) {
    const { data, error } = await supabase.from(table).insert(payload).select('id').single();
    if (error) throw error;
    return data?.id ? { table, id: data.id as string } : null;
  }

  const inspectionRequests = [
    ...seededVehicles.map((van, assetIndex) => {
        const monthIndex = assetIndex % 6;
        const index = assetIndex;
        return (
      insertInspection('van_inspections', {
        van_id: van.id,
        user_id: employee.id,
        week_ending: weekEnding(monthIndex * 4),
        inspection_date: isoDate(-1 - monthIndex * 28 - (assetIndex % 6)),
        current_mileage: 48250 + index * 410,
        checked_by: employee.fullName,
        status: index % 11 === 0 ? 'draft' : 'submitted',
        submitted_at: index % 11 === 0 ? null : dateTime(-1 - monthIndex * 28 - (assetIndex % 6), 16),
        reviewed_by: index % 11 === 0 ? null : manager.id,
        reviewed_at: index % 11 === 0 ? null : dateTime(-monthIndex * 28 - (assetIndex % 6), 9),
        manager_comments: index === 0 ? 'Demo review: marker light defect raised for workshop.' : 'Demo review complete.',
        inspector_comments: `Demo seed: van daily check ${index + 1}.`,
        defects_comments: index === 0 ? 'Nearside marker light not illuminating.' : null,
        signature_data: index % 11 === 0 ? null : 'data:image/png;base64,demo',
        signed_at: index % 11 === 0 ? null : dateTime(-1 - monthIndex * 28 - (assetIndex % 6), 16),
      })
        );
      }),
    ...seededHgvs.map((hgv, assetIndex) => {
        const monthIndex = assetIndex % 6;
        const index = seededVehicles.length + assetIndex;
        return (
      insertInspection('hgv_inspections', {
        hgv_id: hgv.id,
        user_id: employee.id,
        inspection_date: isoDate(-2 - monthIndex * 28 - (assetIndex % 5)),
        current_mileage: 84520 + index * 920,
        status: 'submitted',
        submitted_at: dateTime(-2 - monthIndex * 28 - (assetIndex % 5), 15),
        reviewed_by: manager.id,
        reviewed_at: dateTime(-1 - monthIndex * 28 - (assetIndex % 5), 10),
        manager_comments: index === 0 ? 'Demo review: tyre pressure note monitored.' : 'Demo review complete.',
        inspector_comments: `Demo seed: HGV daily check ${index + 1}.`,
        signature_data: 'data:image/png;base64,demo',
        signed_at: dateTime(-2 - monthIndex * 28 - (assetIndex % 5), 15),
      })
        );
      }),
    ...seededPlant.map((plant, assetIndex) => {
        const monthIndex = assetIndex % 6;
        const index = seededVehicles.length + seededHgvs.length + assetIndex;
        return (
      insertInspection('plant_inspections', {
        plant_id: plant.id,
        user_id: employee.id,
        inspection_date: isoDate(-3 - monthIndex * 28 - (assetIndex % 4)),
        current_mileage: 1848 + index * 55,
        status: 'submitted',
        submitted_at: dateTime(-3 - monthIndex * 28 - (assetIndex % 4), 14),
        reviewed_by: manager.id,
        reviewed_at: dateTime(-2 - monthIndex * 28 - (assetIndex % 4), 8),
        manager_comments: index === 0 ? 'Demo review: hydraulic hose observation logged.' : 'Demo review complete.',
        inspector_comments: `Demo seed: plant daily check ${index + 1}.`,
        signature_data: 'data:image/png;base64,demo',
        signed_at: dateTime(-3 - monthIndex * 28 - (assetIndex % 4), 14),
      })
        );
      }),
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
    ...seededVehicles.slice(3, 12).map((vehicle, index) => ({
      title: `Demo workshop: van fleet service ${index + 1}`,
      description: 'Generated six-month demo service and repair task for the van fleet.',
      priority: index % 3 === 0 ? 'high' : index % 3 === 1 ? 'medium' : 'low',
      status: ['pending', 'in_progress', 'completed'][index % 3],
      action_type: 'workshop_vehicle_task',
      van_id: vehicle.id,
      workshop_category_id: category.id,
      workshop_subcategory_id: index % 2 === 0 ? serviceSubcategoryId : electricalSubcategoryId,
      created_by: manager.id,
      workshop_comments: 'Generated demo workshop history for the approved sales dataset.',
    })),
    ...seededHgvs.slice(2).map((hgv, index) => ({
      title: `Demo workshop: HGV compliance task ${index + 1}`,
      description: 'Generated HGV workshop compliance task for six-month demo history.',
      priority: index % 2 === 0 ? 'medium' : 'high',
      status: index % 2 === 0 ? 'pending' : 'completed',
      action_type: 'workshop_vehicle_task',
      hgv_id: hgv.id,
      workshop_category_id: category.id,
      workshop_subcategory_id: serviceSubcategoryId,
      created_by: manager.id,
      workshop_comments: 'Generated HGV workshop task for demo reports and filtering.',
    })),
    ...seededPlant.slice(2).map((plant, index) => ({
      title: `Demo workshop: plant service task ${index + 1}`,
      description: 'Generated plant maintenance task for six-month demo history.',
      priority: index % 2 === 0 ? 'medium' : 'low',
      status: ['pending', 'in_progress', 'on_hold'][index % 3],
      action_type: 'workshop_vehicle_task',
      plant_id: plant.id,
      workshop_category_id: category.id,
      workshop_subcategory_id: hydraulicSubcategoryId,
      created_by: manager.id,
      workshop_comments: 'Generated plant workshop task for demo reports and history.',
    })),
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
      'Demo Night Works Briefing Pack',
      'Demo Traffic Management Plan',
      'Demo Excavation Permit Pack',
      'Demo Framework Induction Pack',
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
      {
        title: 'Demo Night Works Briefing Pack',
        description: 'Fictional briefing pack for night shift and possession work.',
        file_name: 'demo-night-works-briefing-pack.pdf',
        file_path: 'demo/project-documents/demo-night-works-briefing-pack.pdf',
        file_size: 674000,
        file_type: 'application/pdf',
        uploaded_by: admin.id,
        document_type_id: documentType.id,
        is_active: true,
      },
      {
        title: 'Demo Traffic Management Plan',
        description: 'Fictional traffic management plan for lane closure demonstrations.',
        file_name: 'demo-traffic-management-plan.pdf',
        file_path: 'demo/project-documents/demo-traffic-management-plan.pdf',
        file_size: 782000,
        file_type: 'application/pdf',
        uploaded_by: admin.id,
        document_type_id: documentType.id,
        is_active: true,
      },
      {
        title: 'Demo Excavation Permit Pack',
        description: 'Fictional excavation permit pack for utilities and drainage scenarios.',
        file_name: 'demo-excavation-permit-pack.pdf',
        file_path: 'demo/project-documents/demo-excavation-permit-pack.pdf',
        file_size: 594000,
        file_type: 'application/pdf',
        uploaded_by: admin.id,
        document_type_id: documentType.id,
        is_active: true,
      },
      {
        title: 'Demo Framework Induction Pack',
        description: 'Fictional induction document for onboarding and signature workflows.',
        file_name: 'demo-framework-induction-pack.pdf',
        file_path: 'demo/project-documents/demo-framework-induction-pack.pdf',
        file_size: 455000,
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
    { item_number: 'DD-013', name: 'Drainage Laser Tripod', category: 'tools', location_id: yardLocationId },
    { item_number: 'DD-014', name: 'Chapter 8 Cone Set', category: 'signs', location_id: vanLocationId },
    { item_number: 'DD-015', name: 'Portable Welfare Unit Keys', category: 'equipment', location_id: yardLocationId },
    { item_number: 'DD-016', name: 'Vibrating Poker Set', category: 'equipment', location_id: plantLocationId },
    { item_number: 'DD-017', name: 'Temporary Barrier Clips', category: 'signs', location_id: yardLocationId },
    { item_number: 'DD-018', name: 'Cable Avoidance Tool Spare Battery', category: 'tools', location_id: vanLocationId },
    { item_number: 'DD-019', name: 'Manhole Lifting Keys', category: 'tools', location_id: plantLocationId },
    { item_number: 'DD-020', name: 'Road Closure Sign Pack', category: 'signs', location_id: vanLocationId },
    { item_number: 'DD-021', name: 'Portable Pump', category: 'equipment', location_id: plantLocationId },
    { item_number: 'DD-022', name: 'Thermal Lance Guard Kit', category: 'equipment', location_id: yardLocationId },
    { item_number: 'DD-023', name: 'Survey Tablet', category: 'tools', location_id: vanLocationId },
    { item_number: 'DD-024', name: 'Demo Hired Compressor', category: 'hired_plant', location_id: plantLocationId },
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
