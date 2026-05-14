import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials');
  console.error('Please ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl!, supabaseServiceKey!, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Sample employees
const SAMPLE_EMPLOYEES = [
  {
    email: 'john.smith@digidocs-demo.test',
    password: 'TestPass123!',
    full_name: 'John Smith',
    employee_id: 'EMP101',
    role: 'employee'
  },
  {
    email: 'sarah.jones@digidocs-demo.test',
    password: 'TestPass123!',
    full_name: 'Sarah Jones',
    employee_id: 'EMP102',
    role: 'employee'
  },
  {
    email: 'mike.wilson@digidocs-demo.test',
    password: 'TestPass123!',
    full_name: 'Mike Wilson',
    employee_id: 'EMP103',
    role: 'employee'
  },
  {
    email: 'emma.brown@digidocs-demo.test',
    password: 'TestPass123!',
    full_name: 'Emma Brown',
    employee_id: 'EMP104',
    role: 'employee'
  },
  {
    email: 'david.taylor@digidocs-demo.test',
    password: 'TestPass123!',
    full_name: 'David Taylor',
    employee_id: 'EMP105',
    role: 'employee'
  }
];

// Sample vehicles
const SAMPLE_VEHICLES = [
  { reg_number: 'YX21ABC', vehicle_type: 'Truck', status: 'active' },
  { reg_number: 'YX22DEF', vehicle_type: 'Artic', status: 'active' },
  { reg_number: 'YX23GHI', vehicle_type: 'Trailer', status: 'active' },
  { reg_number: 'YX24JKL', vehicle_type: 'Truck', status: 'active' },
  { reg_number: 'YX25MNO', vehicle_type: 'Van', status: 'active' },
];

// Sample job codes
const JOB_CODES = ['JOB001', 'JOB002', 'JOB003', 'JOB004', 'JOB005', 'YARD'];

// Inspection items (matches official VEHICLE INSPECTION PAD form)
const INSPECTION_ITEMS = [
  'Fuel - and ad-blu',
  'Mirrors - includes Class V & Class VI',
  'Safety Equipment - Cameras & Audible Alerts',
  'Warning Signage - VRU Sign',
  'FORS Stickers',
  'Oil',
  'Water',
  'Battery',
  'Tyres',
  'Brakes',
  'Steering',
  'Lights',
  'Reflectors',
  'Indicators',
  'Wipers',
  'Washers',
  'Horn',
  'Markers',
  'Sheets / Ropes / Chains',
  'Security of Load',
  'Side underbar/Rails',
  'Brake Hoses',
  'Couplings Secure',
  'Electrical Connections',
  'Trailer No. Plate',
  'Nil Defects'
];

// Helper to get date for weeks ago
function getWeekEnding(weeksAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - (weeksAgo * 7));
  // Get the Sunday of that week
  const day = date.getDay();
  const diff = day === 0 ? 0 : 7 - day;
  date.setDate(date.getDate() + diff);
  return date.toISOString().split('T')[0];
}

// Helper to get date range for inspection
function getInspectionDateRange(weeksAgo: number): { start: string; end: string } {
  const endDate = new Date();
  endDate.setDate(endDate.getDate() - (weeksAgo * 7));
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 6); // 7 days including end date
  return {
    start: startDate.toISOString().split('T')[0],
    end: endDate.toISOString().split('T')[0]
  };
}

// Random number generator
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomElement<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

async function createEmployees() {
  console.log('👥 Creating sample employees...\n');
  const createdUsers: Array<{ id: string; email: string; full_name: string; employee_id: string; role: string }> = [];

  for (const employee of SAMPLE_EMPLOYEES) {
    console.log(`📝 Creating: ${employee.full_name} (${employee.employee_id})`);
    
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: employee.email,
      password: employee.password,
      email_confirm: true,
      user_metadata: {
        full_name: employee.full_name,
        employee_id: employee.employee_id
      }
    });

    if (authError) {
      if (authError.message.includes('already registered') || authError.code === 'email_exists') {
        console.log(`   ℹ️  User already exists, fetching ID...`);
        const { data: allUsers } = await supabase.auth.admin.listUsers();
        const foundUser = allUsers?.users.find(u => u.email === employee.email);
        if (foundUser) {
          createdUsers.push({ ...employee, id: foundUser.id });
          console.log(`   ✅ Found existing user`);
        }
      } else {
        console.error(`   ❌ Error:`, authError.message);
      }
    } else if (authData.user) {
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ role: employee.role })
        .eq('id', authData.user.id);
        
      if (updateError) {
        console.error(`   ❌ Error updating profile:`, updateError.message);
      } else {
        createdUsers.push({ ...employee, id: authData.user.id });
        console.log(`   ✅ Created successfully`);
      }
    }
  }

  return createdUsers;
}

async function createVehicles() {
  console.log('\n🚗 Creating sample vehicles...\n');
  const createdVehicles: Array<{ id: string; reg_number: string }> = [];

  for (const vehicle of SAMPLE_VEHICLES) {
    console.log(`📝 Creating vehicle: ${vehicle.reg_number}`);
    
    const { data, error } = await supabase
      .from('vans')
      .upsert(vehicle, { onConflict: 'reg_number' })
      .select()
      .single();
      
    if (error) {
      console.error(`   ❌ Error:`, error.message);
    } else {
      createdVehicles.push(data);
      console.log(`   ✅ Created successfully`);
    }
  }

  return createdVehicles;
}

async function createTimesheets(employees: Array<{ id: string; full_name: string }>, managerId: string) {
  console.log('\n📅 Creating timesheets for 4 weeks...\n');
  
  let totalTimesheets = 0;
  let totalEntries = 0;

  // Create timesheets for last 4 weeks
  for (let week = 0; week < 4; week++) {
    const weekEnding = getWeekEnding(week);
    console.log(`Week ${week + 1} ending: ${weekEnding}`);

    for (const employee of employees) {
      // Random vehicle for this week
      const vehicle = randomElement(['YX21ABC', 'YX22DEF', 'YX23GHI', 'YX24JKL', 'YX25MNO']);
      
      // Create timesheet
      const { data: timesheet, error: timesheetError } = await supabase
        .from('timesheets')
        .insert({
          user_id: employee.id,
          reg_number: vehicle,
          week_ending: weekEnding,
          status: randomElement(['approved', 'approved', 'approved', 'submitted']), // Most approved
          submitted_at: new Date(Date.now() - (week * 7 * 24 * 60 * 60 * 1000)).toISOString(),
          reviewed_by: managerId,
          reviewed_at: new Date(Date.now() - (week * 7 * 24 * 60 * 60 * 1000)).toISOString(),
        })
        .select()
        .single();

      if (timesheetError) {
        console.error(`   ❌ Error creating timesheet for ${employee.full_name}:`, timesheetError.message);
        continue;
      }

      totalTimesheets++;

      // Create entries for each day (Monday-Friday typically)
      const daysToWork = randomInt(4, 7); // Work 4-7 days
      for (let day = 1; day <= daysToWork; day++) {
        const workingInYard = Math.random() < 0.2; // 20% chance of yard work
        const didNotWork = day > 5 && Math.random() < 0.5; // 50% chance of not working on weekends
        
        let timeStarted = null;
        let timeFinished = null;
        let dailyTotal = null;
        let jobNumber = null;

        if (!didNotWork) {
          const startHour = randomInt(6, 8); // Start between 6-8 AM
          const duration = randomInt(8, 10); // Work 8-10 hours
          timeStarted = `${String(startHour).padStart(2, '0')}:00:00`;
          timeFinished = `${String(startHour + duration).padStart(2, '0')}:00:00`;
          dailyTotal = duration + (Math.random() < 0.5 ? 0.5 : 0); // Sometimes .5 hours
          jobNumber = workingInYard ? 'YARD' : randomElement(JOB_CODES);
        }

        const { error: entryError } = await supabase
          .from('timesheet_entries')
          .insert({
            timesheet_id: timesheet.id,
            day_of_week: day,
            time_started: timeStarted,
            time_finished: timeFinished,
            working_in_yard: workingInYard,
            did_not_work: didNotWork,
            daily_total: dailyTotal,
            job_number: jobNumber,
            remarks: didNotWork ? 'Day off' : (Math.random() < 0.3 ? 'Long distance delivery' : null)
          });

        if (entryError) {
          console.error(`   ❌ Error creating entry:`, entryError.message);
        } else {
          totalEntries++;
        }
      }
    }
    console.log(`   ✅ Week ${week + 1} completed`);
  }

  console.log(`\n   📊 Total: ${totalTimesheets} timesheets, ${totalEntries} entries`);
}

async function createInspections(employees: Array<{ id: string }>, vehicles: Array<{ id: string; reg_number: string }>, managerId: string) {
  console.log('\n🔍 Creating van inspections for 4 weeks...\n');
  
  let totalInspections = 0;
  let totalDefects = 0;
  let totalActions = 0;

  // Create inspections for last 4 weeks
  for (let week = 0; week < 4; week++) {
    const dateRange = getInspectionDateRange(week);
    console.log(`Week ${week + 1}: ${dateRange.start} to ${dateRange.end}`);

    // Each employee does 1-2 inspections per week
    for (const employee of employees) {
      const inspectionsThisWeek = randomInt(1, 2);

      for (let i = 0; i < inspectionsThisWeek; i++) {
        const vehicle = randomElement(vehicles);
        const hasDefects = Math.random() < 0.3; // 30% chance of defects
        
        // Create inspection
        const { data: inspection, error: inspectionError } = await supabase
          .from('van_inspections')
          .insert({
            van_id: vehicle.id,
            user_id: employee.id,
            inspection_date: dateRange.start,
            inspection_end_date: dateRange.end,
            current_mileage: randomInt(50000, 150000),
            status: randomElement(['approved', 'approved', 'submitted']), // Most approved
            submitted_at: new Date(Date.now() - (week * 7 * 24 * 60 * 60 * 1000)).toISOString(),
            reviewed_by: managerId,
            reviewed_at: new Date(Date.now() - (week * 7 * 24 * 60 * 60 * 1000)).toISOString(),
          })
          .select()
          .single();

        if (inspectionError) {
          console.error(`   ❌ Error creating inspection:`, inspectionError.message);
          continue;
        }

        totalInspections++;

        // Create inspection items (26 items for the week)
        const defectItems = hasDefects ? 
          Array.from({ length: randomInt(1, 3) }, () => randomInt(1, 26)) : 
          [];

        for (let itemNum = 1; itemNum <= 26; itemNum++) {
          const isDefect = defectItems.includes(itemNum);
          
          // Create item for each day of the week
          for (let dayOfWeek = 1; dayOfWeek <= 7; dayOfWeek++) {
            const { data: item, error: itemError} = await supabase
              .from('inspection_items')
              .insert({
                inspection_id: inspection.id,
                item_number: itemNum,
                day_of_week: dayOfWeek,
                status: isDefect ? 'attention' : 'ok',
              })
              .select()
              .single();

            if (itemError) {
              console.error(`   ❌ Error creating item:`, itemError.message);
              continue;
            }

            // Create action for defect (only for first day of week to avoid duplicates)
            if (isDefect && item && dayOfWeek === 1) {
              totalDefects++;
              
              const priority = randomElement(['low', 'medium', 'high', 'urgent']);
              const actionStatus = randomElement(['pending', 'pending', 'pending', 'in_progress']); // Most pending
              
              const { error: actionError } = await supabase
                .from('actions')
                .insert({
                  inspection_id: inspection.id,
                  inspection_item_id: item.id,
                  title: `${vehicle.reg_number}: ${INSPECTION_ITEMS[itemNum - 1]}`,
                  description: 'Defect found during inspection',
                  priority: priority,
                  status: actionStatus,
                  actioned: false,
                  created_by: managerId,
                });
              
              if (actionError) {
                console.error(`   ❌ Error creating action:`, actionError.message);
              } else {
                totalActions++;
              }
            }
          }
        }
      }
    }
    console.log(`   ✅ Week ${week + 1} completed`);
  }

  console.log(`\n   📊 Total: ${totalInspections} inspections, ${totalDefects} defects, ${totalActions} actions created`);
}

async function seedData() {
  console.log('🌱 Seeding sample data...\n');
  console.log('═══════════════════════════════════════════════════\n');

  try {
    // Create employees
    const employees = await createEmployees();
    
    if (employees.length === 0) {
      console.error('❌ No employees created, aborting...');
      return;
    }

    // Create vehicles
    const vehicles = await createVehicles();
    
    if (vehicles.length === 0) {
      console.error('❌ No vehicles created, aborting...');
      return;
    }

    // Get manager ID for approvals
    const { data: managers } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', 'manager')
      .limit(1);
    
    const managerId = managers?.[0]?.id;
    
    if (!managerId) {
      console.error('❌ No manager found. Please create a manager user first.');
      return;
    }

    // Create timesheets
    await createTimesheets(employees, managerId);

    // Create inspections
    await createInspections(employees, vehicles, managerId);

    console.log('\n═══════════════════════════════════════════════════');
    console.log('✅ Sample data seeded successfully!\n');
    console.log('📊 Summary:');
    console.log(`   • ${employees.length} employees created`);
    console.log(`   • ${vehicles.length} vehicles created`);
    console.log(`   • 4 weeks of timesheet data`);
    console.log(`   • 4 weeks of inspection data`);
    console.log(`   • Actions created for all defects`);
    console.log('\n💡 Login credentials:');
    console.log('   Email: [employee-email]@digidocs-demo.test');
    console.log('   Password: TestPass123!');
    console.log('\n   For manager access, use: manager@digidocs-demo.test');
    console.log('\n📋 Pages to test:');
    console.log('   • Reports - Download Excel reports');
    console.log('   • Approvals - Review timesheets & inspections');
    console.log('   • Actions - Track defects from inspections');
    console.log('═══════════════════════════════════════════════════\n');

  } catch (err: unknown) {
    console.error('❌ Error seeding data:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

seedData();

