import { Client } from 'pg';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

async function backfillInspectionActions() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;

  if (!connectionString) {
    console.error('❌ Error: POSTGRES_URL_NON_POOLING not found in environment');
    process.exit(1);
  }

  // Parse connection string and rebuild with explicit SSL config
  const url = new URL(connectionString);

  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    console.log('🔌 Connecting to database...');
    await client.connect();
    console.log('✅ Connected successfully\n');

    // Step 1: Find all submitted inspections with attention items (defects)
    console.log('🔍 Finding submitted inspections with defects (attention items)...\n');
    
    const inspectionsQuery = `
      SELECT DISTINCT
        vi.id,
        vi.van_id,
        vi.user_id,
        vi.inspection_date,
        v.reg_number,
        p.full_name as inspector_name,
        COUNT(ii.id) as defect_count
      FROM van_inspections vi
      INNER JOIN inspection_items ii ON vi.id = ii.inspection_id
      INNER JOIN vans v ON vi.van_id = v.id
      LEFT JOIN profiles p ON vi.user_id = p.id
      WHERE vi.status = 'submitted'
        AND ii.status IN ('attention', 'defect')
      GROUP BY vi.id, vi.van_id, vi.user_id, vi.inspection_date, v.reg_number, p.full_name
      ORDER BY vi.inspection_date DESC;
    `;

    const inspectionsResult = await client.query(inspectionsQuery);
    const inspections = inspectionsResult.rows;

    console.log(`📋 Found ${inspections.length} submitted inspections with attention items:\n`);
    
    if (inspections.length === 0) {
      console.log('✅ No inspections need actions created.\n');
      return;
    }

    inspections.forEach((insp, idx) => {
      console.log(`  ${idx + 1}. ${insp.reg_number} - ${insp.inspection_date} (${insp.defect_count} attention items) - Inspector: ${insp.inspector_name || 'Unknown'}`);
    });

    console.log('\n🔍 Checking which inspections already have actions...\n');

    // Step 2: Check which inspections already have actions
    const actionsQuery = `
      SELECT inspection_id 
      FROM actions 
      WHERE inspection_id = ANY($1);
    `;

    const inspectionIds = inspections.map(i => i.id);
    const actionsResult = await client.query(actionsQuery, [inspectionIds]);
    const existingActionInspections = new Set(actionsResult.rows.map(a => a.inspection_id));

    const inspectionsNeedingActions = inspections.filter(i => !existingActionInspections.has(i.id));

    console.log(`✅ ${existingActionInspections.size} inspections already have actions`);
    console.log(`⚠️  ${inspectionsNeedingActions.length} inspections need actions created\n`);

    if (inspectionsNeedingActions.length === 0) {
      console.log('✅ All inspections already have actions. Nothing to do!\n');
      return;
    }

    console.log('📝 Creating actions for inspections without them:\n');

    // Step 3: Create actions for inspections that don't have them
    let createdCount = 0;
    let errorCount = 0;

    for (const inspection of inspectionsNeedingActions) {
      try {
        // Get attention item (defect) details for the description
        const defectsQuery = `
          SELECT id, item_number, item_description, comments, day_of_week
          FROM inspection_items
          WHERE inspection_id = $1 AND status IN ('attention', 'defect')
          ORDER BY item_number, day_of_week;
        `;

        const defectsResult = await client.query(defectsQuery, [inspection.id]);
        const defects = defectsResult.rows;

        // Group defects by item_number and description to consolidate duplicates
        const groupedDefects = new Map<string, { 
          item_number: number; 
          item_description: string; 
          days: number[]; 
          comments: string[];
          item_ids: string[];
        }>();

        defects.forEach(d => {
          const key = `${d.item_number}-${d.item_description}`;
          if (!groupedDefects.has(key)) {
            groupedDefects.set(key, {
              item_number: d.item_number,
              item_description: d.item_description,
              days: [],
              comments: [],
              item_ids: []
            });
          }
          const group = groupedDefects.get(key)!;
          if (d.day_of_week) {
            group.days.push(d.day_of_week);
          }
          group.item_ids.push(d.id);
          if (d.comments) {
            group.comments.push(d.comments);
          }
        });

        // Create ONE action per unique defect (not one action per inspection)
        const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        const uniqueDefectCount = groupedDefects.size;

        for (const group of groupedDefects.values()) {
          // Build day range for this defect
          let dayRange: string;
          if (group.days.length === 1) {
            dayRange = dayNames[group.days[0] - 1] || `Day ${group.days[0]}`;
          } else if (group.days.length > 1) {
            const firstDay = dayNames[group.days[0] - 1] || `Day ${group.days[0]}`;
            const lastDay = dayNames[group.days[group.days.length - 1] - 1] || `Day ${group.days[group.days.length - 1]}`;
            dayRange = `${firstDay.substring(0, 3)}-${lastDay.substring(0, 3)}`;
          } else {
            dayRange = 'Unknown';
          }

          const comment = group.comments.length > 0 ? `\nComment: ${group.comments[0]}` : '';
          const description = `Van inspection defect found:\nItem ${group.item_number} - ${group.item_description} (${dayRange})${comment}`;
          const title = `${inspection.reg_number} - ${group.item_description} (${dayRange})`;

          // Create action for this defect
          const insertQuery = `
            INSERT INTO actions (
              action_type,
              title,
              description,
              inspection_id,
              inspection_item_id,
              van_id,
              status,
              priority,
              created_by,
              created_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
            ) RETURNING id;
          `;
          
          const insertResult = await client.query(insertQuery, [
            'inspection_defect',
            title,
            description,
            inspection.id,
            group.item_ids[0] || null,
            inspection.van_id,
            'pending',
            'high',
            inspection.user_id,
            new Date().toISOString()
          ]);

          void insertResult.rows[0].id;
          createdCount++;
        }

        console.log(`  ✅ Created ${uniqueDefectCount} action${uniqueDefectCount > 1 ? 's' : ''} for ${inspection.reg_number} (${inspection.inspection_date.toISOString().split('T')[0]})`);

      } catch (err: unknown) {
        console.error(`  ❌ Failed to create action for ${inspection.reg_number}:`, err instanceof Error ? err.message : err);
        errorCount++;
      }
    }

    console.log('\n📊 Summary:');
    console.log(`  ✅ Successfully created: ${createdCount} actions`);
    if (errorCount > 0) {
      console.log(`  ❌ Failed: ${errorCount} actions`);
    }
    console.log(`  📋 Total inspections processed: ${inspections.length}`);
    console.log(`  🔄 Already had actions: ${existingActionInspections.size}`);

    console.log('\n✅ Backfill completed successfully!');

  } catch (err: unknown) {
    console.error('❌ Backfill failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n🔌 Database connection closed');
  }
}

backfillInspectionActions();
