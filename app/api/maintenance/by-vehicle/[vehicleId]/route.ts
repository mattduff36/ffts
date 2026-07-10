import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/utils/logger';
import type {
  CustomMaintenanceItemUpdate,
  MaintenanceCategory,
  UpdateMaintenanceRequest,
} from '@/types/maintenance';
import { buildAutomaticMaintenancePlan } from '@/lib/utils/workshopMaintenanceSync';

type AssetType = 'van' | 'hgv' | 'plant';
type FkColumn = 'van_id' | 'hgv_id' | 'plant_id';
type ChangedFieldValueType = 'date' | 'mileage' | 'boolean' | 'text';

type ExtendedUpdateMaintenanceRequest = UpdateMaintenanceRequest & {
  assetType?: AssetType;
  task_id?: string;
  completed_at?: string;
  task_title?: string | null;
  task_description?: string | null;
  task_category_name?: string | null;
  task_subcategory_name?: string | null;
  loler_due_date?: string | null;
};

interface CustomCategoryValueRow {
  id: string;
  maintenance_category_id: string;
  due_date: string | null;
  due_mileage: number | null;
  last_mileage: number | null;
  due_hours: number | null;
  last_hours: number | null;
  notes: string | null;
}

interface TaskMaintenanceContextRow {
  id: string;
  title: string | null;
  description: string | null;
  workshop_comments: string | null;
  actioned_at: string | null;
  status: string | null;
  van_id: string | null;
  hgv_id: string | null;
  plant_id: string | null;
  workshop_task_categories: { name: string | null } | Array<{ name: string | null }> | null;
  workshop_task_subcategories: { name: string | null } | Array<{ name: string | null }> | null;
}

function getRelatedName(
  related: { name: string | null } | Array<{ name: string | null }> | null
): string | null {
  if (Array.isArray(related)) return related[0]?.name ?? null;
  return related?.name ?? null;
}

function fkColumnForAssetType(assetType: AssetType): FkColumn {
  if (assetType === 'hgv') return 'hgv_id';
  if (assetType === 'plant') return 'plant_id';
  return 'van_id';
}

const FIELD_TO_CATEGORY_NAME: Record<string, string> = {
  tax_due_date: 'Tax Due Date',
  mot_due_date: 'MOT Due Date',
  first_aid_kit_expiry: 'First Aid Kit Expiry',
  six_weekly_inspection_due_date: '6 Weekly Inspection Due',
  fire_extinguisher_due_date: 'Fire Extinguisher Due',
  taco_calibration_due_date: 'Taco Calibration Due',
  next_service_mileage: 'Service Due',
  last_service_mileage: 'Service Due',
  cambelt_due_mileage: 'Cambelt Replacement',
  next_service_hours: 'Service Due (Hours)',
  last_service_hours: 'Service Due (Hours)',
  loler_due_date: 'LOLER Due',
};

function serializeCustomValue(value?: CustomCategoryValueRow | CustomMaintenanceItemUpdate | null): string | null {
  if (!value) return null;
  const dueValue = value.due_date ?? value.due_mileage ?? value.due_hours ?? null;
  const lastValue = value.last_mileage ?? value.last_hours ?? null;
  if (lastValue != null && dueValue != null) return `${lastValue} -> ${dueValue}`;
  if (dueValue != null) return String(dueValue);
  if (lastValue != null) return String(lastValue);
  return value.notes ? value.notes.slice(0, 50) : null;
}

function isEmptyCustomValue(value: CustomMaintenanceItemUpdate): boolean {
  return value.due_date == null
    && value.due_mileage == null
    && value.last_mileage == null
    && value.due_hours == null
    && value.last_hours == null
    && !value.notes;
}

function buildCategoryIdByField(categories: MaintenanceCategory[]): Map<string, string> {
  const categoryIdByName = new Map(
    categories.map((category) => [category.name.toLowerCase(), category.id])
  );

  return new Map(
    Object.entries(FIELD_TO_CATEGORY_NAME)
      .map(([fieldName, categoryName]) => [
        fieldName,
        categoryIdByName.get(categoryName.toLowerCase()),
      ])
      .filter((entry): entry is [string, string] => Boolean(entry[1]))
  );
}

/**
 * POST /api/maintenance/by-vehicle/[vehicleId]
 * Create or update maintenance record by vehicle ID
 * This endpoint is used when completing workshop tasks that need to update maintenance fields
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ vehicleId: string }> }
) {
  try {
    const { vehicleId } = await params;

    // Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user profile for name
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single();

    const userName = profile?.full_name || 'Unknown User';

    // Parse request body
    const body: ExtendedUpdateMaintenanceRequest = await request.json();

    // Validate comment (mandatory, min 10 characters)
    if (!body.comment || body.comment.trim().length < 10) {
      return NextResponse.json(
        {
          error: 'Comment is required and must be at least 10 characters',
        },
        { status: 400 }
      );
    }

    // Resolve the FK column: use explicit assetType if provided, otherwise
    // auto-detect by looking up the vehicleId in all three FK columns.
    let fkColumn: FkColumn | null = body.assetType
      ? fkColumnForAssetType(body.assetType)
      : null;

    const selectCols =
      'id, van_id, hgv_id, plant_id, current_mileage, current_hours, tax_due_date, mot_due_date, first_aid_kit_expiry, six_weekly_inspection_due_date, fire_extinguisher_due_date, taco_calibration_due_date, next_service_mileage, last_service_mileage, cambelt_due_mileage, next_service_hours, last_service_hours, tracker_id, notes';

    type ExistingRecord = {
      id: string;
      van_id: string | null;
      hgv_id: string | null;
      plant_id: string | null;
      current_mileage: number | null;
      current_hours: number | null;
      tax_due_date: string | null;
      mot_due_date: string | null;
      first_aid_kit_expiry: string | null;
      six_weekly_inspection_due_date: string | null;
      fire_extinguisher_due_date: string | null;
      taco_calibration_due_date: string | null;
      next_service_mileage: number | null;
      last_service_mileage: number | null;
      cambelt_due_mileage: number | null;
      next_service_hours: number | null;
      last_service_hours: number | null;
      tracker_id: string | null;
      notes: string | null;
    };

    let existingRecord: ExistingRecord | null = null;

    if (fkColumn) {
      const { data, error: fetchError } = await supabase
        .from('vehicle_maintenance')
        .select(selectCols)
        .eq(fkColumn, vehicleId)
        .single();

      if (fetchError && fetchError.code !== 'PGRST116') {
        logger.error('Failed to fetch maintenance record', fetchError);
        throw fetchError;
      }
      existingRecord = data as ExistingRecord | null;
    } else {
      // Auto-detect: try each FK column
      for (const col of ['van_id', 'hgv_id', 'plant_id'] as FkColumn[]) {
        const { data, error: fetchError } = await supabase
          .from('vehicle_maintenance')
          .select(selectCols)
          .eq(col, vehicleId)
          .single();

        if (fetchError && fetchError.code !== 'PGRST116') {
          logger.error('Failed to fetch maintenance record', fetchError);
          throw fetchError;
        }
        if (data) {
          existingRecord = data as ExistingRecord;
          fkColumn = col;
          break;
        }
      }
    }

    // If we still don't know the FK, auto-detect from asset tables
    if (!fkColumn) {
      const [{ data: van }, { data: hgv }, { data: plant }] = await Promise.all([
        supabase.from('vans').select('id').eq('id', vehicleId).maybeSingle(),
        supabase.from('hgvs').select('id').eq('id', vehicleId).maybeSingle(),
        supabase.from('plant').select('id').eq('id', vehicleId).maybeSingle(),
      ]);

      if (hgv) fkColumn = 'hgv_id';
      else if (plant) fkColumn = 'plant_id';
      else if (van) fkColumn = 'van_id';
      else {
        return NextResponse.json(
          { error: 'Vehicle not found in any asset table' },
          { status: 404 }
        );
      }
    }

    const { data: categories, error: categoriesError } = await supabase
      .from('maintenance_categories')
      .select('*')
      .eq('is_active', true);

    if (categoriesError) {
      logger.error('Failed to fetch maintenance categories', categoriesError);
      throw categoriesError;
    }

    const maintenanceCategories = (categories || []) as MaintenanceCategory[];
    const categoryIdByField = buildCategoryIdByField(maintenanceCategories);
    const assetType = fkColumn === 'hgv_id' ? 'hgv' : fkColumn === 'plant_id' ? 'plant' : 'van';
    let verifiedTaskContext: TaskMaintenanceContextRow | null = null;

    if (body.task_id) {
      const admin = createAdminClient();
      const { data: taskContext, error: taskContextError } = await admin
        .from('actions')
        .select(`
          id,
          title,
          description,
          workshop_comments,
          actioned_at,
          status,
          van_id,
          hgv_id,
          plant_id,
          workshop_task_categories (
            name
          ),
          workshop_task_subcategories (
            name
          )
        `)
        .eq('id', body.task_id)
        .maybeSingle();

      if (taskContextError) {
        logger.error('Failed to verify workshop task for maintenance update', taskContextError);
        throw taskContextError;
      }

      verifiedTaskContext = taskContext as TaskMaintenanceContextRow | null;

      if (
        !verifiedTaskContext ||
        verifiedTaskContext.status !== 'completed' ||
        verifiedTaskContext[fkColumn] !== vehicleId
      ) {
        return NextResponse.json(
          { error: 'Workshop task could not be verified for this maintenance update' },
          { status: 400 }
        );
      }
    }

    const automaticContext = verifiedTaskContext
      ? {
          title: verifiedTaskContext.title,
          description: verifiedTaskContext.description,
          workshopCategoryName: getRelatedName(verifiedTaskContext.workshop_task_categories),
          workshopSubcategoryName: getRelatedName(verifiedTaskContext.workshop_task_subcategories),
        }
      : {
          title: body.task_title,
          description: body.task_description,
          workshopCategoryName: body.task_category_name,
          workshopSubcategoryName: body.task_subcategory_name,
        };
    const automaticCompletedAt =
      verifiedTaskContext?.actioned_at || body.completed_at || new Date().toISOString();

    const autoPlan = buildAutomaticMaintenancePlan({
      context: automaticContext,
      categories: maintenanceCategories,
      state: {
        currentMileage: body.current_mileage ?? existingRecord?.current_mileage ?? null,
        currentHours: body.current_hours ?? existingRecord?.current_hours ?? null,
      },
      completedAt: automaticCompletedAt,
      assetType,
    });

    const requestedUpdates: Partial<UpdateMaintenanceRequest> = {
      ...autoPlan?.maintenanceUpdates,
    };

    const requestedCustomItemsByCategoryId = new Map<string, CustomMaintenanceItemUpdate>();
    for (const item of autoPlan?.customItems || []) {
      requestedCustomItemsByCategoryId.set(item.category_id, item);
    }
    for (const item of body.custom_items || []) {
      requestedCustomItemsByCategoryId.set(item.category_id, item);
    }

    const requestedPlantUpdates: { loler_due_date?: string | null } = {
      ...autoPlan?.plantUpdates,
    };

    const maintenanceFields: Array<keyof UpdateMaintenanceRequest> = [
      'current_mileage',
      'tax_due_date',
      'mot_due_date',
      'first_aid_kit_expiry',
      'six_weekly_inspection_due_date',
      'fire_extinguisher_due_date',
      'taco_calibration_due_date',
      'next_service_mileage',
      'last_service_mileage',
      'cambelt_due_mileage',
      'current_hours',
      'last_service_hours',
      'next_service_hours',
      'tracker_id',
      'notes',
    ];

    for (const fieldName of maintenanceFields) {
      const fieldValue = body[fieldName];
      if (fieldValue !== undefined) {
        (requestedUpdates as Record<string, unknown>)[fieldName] = fieldValue;
      }
    }

    if (body.loler_due_date !== undefined) {
      requestedPlantUpdates.loler_due_date = body.loler_due_date;
    }

    const historyAssetKeys = {
      van_id: fkColumn === 'van_id' ? vehicleId : null,
      hgv_id: fkColumn === 'hgv_id' ? vehicleId : null,
      plant_id: fkColumn === 'plant_id' ? vehicleId : null,
    };

    const { data: plantRecord, error: plantRecordError } =
      fkColumn === 'plant_id'
        ? await supabase
            .from('plant')
            .select('id, loler_due_date')
            .eq('id', vehicleId)
            .maybeSingle()
        : { data: null, error: null };

    if (plantRecordError) {
      logger.error('Failed to fetch plant record', plantRecordError);
      throw plantRecordError;
    }

    const isNewRecord = !existingRecord;

    // Track which fields changed for history
    const changedFields: Array<{
      field_name: string;
      old_value: string | null;
      new_value: string | null;
      value_type: ChangedFieldValueType;
      maintenance_category_id: string | null;
    }> = [];

    // Build update payload
    const updates: Record<string, string | number | boolean | null> = {
      last_updated_by: user.id,
      last_updated_at: new Date().toISOString(),
    };

    const assignChangedField = (
      fieldName: string,
      oldValue: string | number | null | undefined,
      newValue: string | number | null | undefined,
      valueType: ChangedFieldValueType
    ) => {
      changedFields.push({
        field_name: fieldName,
        old_value: oldValue != null ? String(oldValue) : null,
        new_value: newValue != null ? String(newValue) : null,
        value_type: valueType,
        maintenance_category_id: categoryIdByField.get(fieldName) || autoPlan?.linkedCategoryId || null,
      });
    };

    // Check each field for changes
    if (requestedUpdates.current_mileage !== undefined) {
      updates.current_mileage = requestedUpdates.current_mileage;
      if (!existingRecord || existingRecord.current_mileage !== requestedUpdates.current_mileage) {
        assignChangedField(
          'current_mileage',
          existingRecord?.current_mileage,
          requestedUpdates.current_mileage,
          'mileage'
        );
      }
    }

    if (requestedUpdates.tax_due_date !== undefined) {
      updates.tax_due_date = requestedUpdates.tax_due_date;
      if (!existingRecord || existingRecord.tax_due_date !== requestedUpdates.tax_due_date) {
        assignChangedField(
          'tax_due_date',
          existingRecord?.tax_due_date,
          requestedUpdates.tax_due_date,
          'date'
        );
      }
    }

    if (requestedUpdates.mot_due_date !== undefined) {
      updates.mot_due_date = requestedUpdates.mot_due_date;
      if (!existingRecord || existingRecord.mot_due_date !== requestedUpdates.mot_due_date) {
        assignChangedField(
          'mot_due_date',
          existingRecord?.mot_due_date,
          requestedUpdates.mot_due_date,
          'date'
        );
      }
    }

    if (requestedUpdates.first_aid_kit_expiry !== undefined) {
      updates.first_aid_kit_expiry = requestedUpdates.first_aid_kit_expiry;
      if (!existingRecord || existingRecord.first_aid_kit_expiry !== requestedUpdates.first_aid_kit_expiry) {
        assignChangedField(
          'first_aid_kit_expiry',
          existingRecord?.first_aid_kit_expiry,
          requestedUpdates.first_aid_kit_expiry,
          'date'
        );
      }
    }

    if (requestedUpdates.six_weekly_inspection_due_date !== undefined) {
      updates.six_weekly_inspection_due_date = requestedUpdates.six_weekly_inspection_due_date;
      if (!existingRecord || existingRecord.six_weekly_inspection_due_date !== requestedUpdates.six_weekly_inspection_due_date) {
        assignChangedField(
          'six_weekly_inspection_due_date',
          existingRecord?.six_weekly_inspection_due_date,
          requestedUpdates.six_weekly_inspection_due_date,
          'date'
        );
      }
    }

    if (requestedUpdates.fire_extinguisher_due_date !== undefined) {
      updates.fire_extinguisher_due_date = requestedUpdates.fire_extinguisher_due_date;
      if (!existingRecord || existingRecord.fire_extinguisher_due_date !== requestedUpdates.fire_extinguisher_due_date) {
        assignChangedField(
          'fire_extinguisher_due_date',
          existingRecord?.fire_extinguisher_due_date,
          requestedUpdates.fire_extinguisher_due_date,
          'date'
        );
      }
    }

    if (requestedUpdates.taco_calibration_due_date !== undefined) {
      updates.taco_calibration_due_date = requestedUpdates.taco_calibration_due_date;
      if (!existingRecord || existingRecord.taco_calibration_due_date !== requestedUpdates.taco_calibration_due_date) {
        assignChangedField(
          'taco_calibration_due_date',
          existingRecord?.taco_calibration_due_date,
          requestedUpdates.taco_calibration_due_date,
          'date'
        );
      }
    }

    if (requestedUpdates.next_service_mileage !== undefined) {
      updates.next_service_mileage = requestedUpdates.next_service_mileage;
      if (!existingRecord || existingRecord.next_service_mileage !== requestedUpdates.next_service_mileage) {
        assignChangedField(
          'next_service_mileage',
          existingRecord?.next_service_mileage,
          requestedUpdates.next_service_mileage,
          'mileage'
        );
      }
    }

    if (requestedUpdates.last_service_mileage !== undefined) {
      updates.last_service_mileage = requestedUpdates.last_service_mileage;
      if (!existingRecord || existingRecord.last_service_mileage !== requestedUpdates.last_service_mileage) {
        assignChangedField(
          'last_service_mileage',
          existingRecord?.last_service_mileage,
          requestedUpdates.last_service_mileage,
          'mileage'
        );
      }
    }

    if (requestedUpdates.cambelt_due_mileage !== undefined) {
      updates.cambelt_due_mileage = requestedUpdates.cambelt_due_mileage;
      if (!existingRecord || existingRecord.cambelt_due_mileage !== requestedUpdates.cambelt_due_mileage) {
        assignChangedField(
          'cambelt_due_mileage',
          existingRecord?.cambelt_due_mileage,
          requestedUpdates.cambelt_due_mileage,
          'mileage'
        );
      }
    }

    if (requestedUpdates.current_hours !== undefined) {
      updates.current_hours = requestedUpdates.current_hours;
      if (!existingRecord || existingRecord.current_hours !== requestedUpdates.current_hours) {
        assignChangedField(
          'current_hours',
          existingRecord?.current_hours,
          requestedUpdates.current_hours,
          'text'
        );
      }
    }

    if (requestedUpdates.last_service_hours !== undefined) {
      updates.last_service_hours = requestedUpdates.last_service_hours;
      if (!existingRecord || existingRecord.last_service_hours !== requestedUpdates.last_service_hours) {
        assignChangedField(
          'last_service_hours',
          existingRecord?.last_service_hours,
          requestedUpdates.last_service_hours,
          'text'
        );
      }
    }

    if (requestedUpdates.next_service_hours !== undefined) {
      updates.next_service_hours = requestedUpdates.next_service_hours;
      if (!existingRecord || existingRecord.next_service_hours !== requestedUpdates.next_service_hours) {
        assignChangedField(
          'next_service_hours',
          existingRecord?.next_service_hours,
          requestedUpdates.next_service_hours,
          'text'
        );
      }
    }

    if (requestedUpdates.tracker_id !== undefined) {
      updates.tracker_id = requestedUpdates.tracker_id;
      if (!existingRecord || existingRecord.tracker_id !== requestedUpdates.tracker_id) {
        assignChangedField(
          'tracker_id',
          existingRecord?.tracker_id,
          requestedUpdates.tracker_id,
          'text'
        );
      }
    }

    if (requestedUpdates.notes !== undefined) {
      updates.notes = requestedUpdates.notes;
      if (!existingRecord || existingRecord.notes !== requestedUpdates.notes) {
        assignChangedField(
          'notes',
          existingRecord?.notes,
          requestedUpdates.notes,
          'text'
        );
      }
    }

    const requestedCustomItems = Array.from(requestedCustomItemsByCategoryId.values());
    if (requestedCustomItems.length > 0) {
      const categoryIds = requestedCustomItems.map((item) => item.category_id);
      const customCategories = maintenanceCategories.filter((category) =>
        categoryIds.includes(category.id)
      );
      const customCategoriesById = new Map(customCategories.map((category) => [category.id, category]));

      const { data: existingCustomValues, error: existingCustomValuesError } = await (supabase as never as {
        from: (table: string) => {
          select: (columns: string) => {
            in: (column: string, values: string[]) => {
              eq: (column: string, value: string) => Promise<{ data: unknown; error: unknown }>;
            };
          };
        };
      })
        .from('asset_maintenance_category_values')
        .select('id, maintenance_category_id, due_date, due_mileage, last_mileage, due_hours, last_hours, notes')
        .in('maintenance_category_id', categoryIds)
        .eq(fkColumn, vehicleId);

      if (existingCustomValuesError) {
        logger.error('Failed to fetch custom maintenance category values', existingCustomValuesError);
        throw existingCustomValuesError;
      }

      const existingValuesByCategoryId = new Map(
        ((existingCustomValues || []) as CustomCategoryValueRow[]).map((value) => [
          value.maintenance_category_id,
          value,
        ])
      );

      for (const item of requestedCustomItems) {
        const category = customCategoriesById.get(item.category_id);
        if (!category || category.field_key) continue;

        const existingValue = existingValuesByCategoryId.get(item.category_id) || null;
        const oldValue = serializeCustomValue(existingValue);
        const newValue = serializeCustomValue(item);
        if (oldValue === newValue) continue;

        if (isEmptyCustomValue(item)) {
          if (existingValue) {
            const { error: deleteValueError } = await (supabase as never as {
              from: (table: string) => {
                delete: () => {
                  eq: (column: string, value: string) => Promise<{ error: unknown }>;
                };
              };
            })
              .from('asset_maintenance_category_values')
              .delete()
              .eq('id', existingValue.id);

            if (deleteValueError) {
              logger.error('Failed to clear custom maintenance category value', deleteValueError);
              throw deleteValueError;
            }
          }
        } else {
          const { error: upsertValueError } = await (supabase as never as {
            from: (table: string) => {
              upsert: (row: unknown, options: { onConflict: string }) => Promise<{ error: unknown }>;
            };
          })
            .from('asset_maintenance_category_values')
            .upsert({
              maintenance_category_id: item.category_id,
              van_id: fkColumn === 'van_id' ? vehicleId : null,
              hgv_id: fkColumn === 'hgv_id' ? vehicleId : null,
              plant_id: fkColumn === 'plant_id' ? vehicleId : null,
              due_date: item.due_date ?? null,
              due_mileage: item.due_mileage ?? null,
              last_mileage: item.last_mileage ?? null,
              due_hours: item.due_hours ?? null,
              last_hours: item.last_hours ?? null,
              notes: item.notes ?? null,
              last_updated_by: user.id,
              last_updated_at: new Date().toISOString(),
            }, { onConflict: 'maintenance_category_id,asset_type,asset_id' });

          if (upsertValueError) {
            logger.error('Failed to upsert custom maintenance category value', upsertValueError);
            throw upsertValueError;
          }
        }

        changedFields.push({
          field_name: `category:${category.name}`,
          old_value: oldValue,
          new_value: newValue,
          value_type: category.type === 'date' ? 'date' : category.type === 'mileage' ? 'mileage' : 'text',
          maintenance_category_id: category.id,
        });
      }
    }

    if (requestedPlantUpdates.loler_due_date !== undefined && plantRecord) {
      if (plantRecord.loler_due_date !== requestedPlantUpdates.loler_due_date) {
        const shouldUseVerifiedAutomaticPlantUpdate =
          Boolean(verifiedTaskContext) &&
          body.loler_due_date === undefined &&
          autoPlan?.plantUpdates.loler_due_date !== undefined;
        const plantUpdateClient = shouldUseVerifiedAutomaticPlantUpdate
          ? createAdminClient()
          : supabase;
        const { data: updatedPlant, error: plantUpdateError } = await plantUpdateClient
          .from('plant')
          .update({ loler_due_date: requestedPlantUpdates.loler_due_date })
          .eq('id', vehicleId)
          .select('id')
          .maybeSingle();

        if (plantUpdateError) {
          logger.error('Failed to update plant LOLER due date', plantUpdateError);
          throw plantUpdateError;
        }

        if (!updatedPlant) {
          throw new Error('Plant LOLER due date update was not applied');
        }

        assignChangedField(
          'loler_due_date',
          plantRecord.loler_due_date,
          requestedPlantUpdates.loler_due_date,
          'date'
        );
      }
    }

    // Create or update maintenance record
    let maintenanceRecord = existingRecord;
    const hasMaintenanceUpdates = Object.keys(updates).length > 2;

    if (isNewRecord && hasMaintenanceUpdates) {
      const { data: created, error: createError } = await supabase
        .from('vehicle_maintenance')
        .insert({
          [fkColumn]: vehicleId,
          ...updates,
        })
        .select()
        .single();

      if (createError) {
        logger.error('Failed to create maintenance record', createError);
        throw createError;
      }

      maintenanceRecord = created;
    } else if (!isNewRecord && hasMaintenanceUpdates) {
      // Update existing record
      const { data: updated, error: updateError } = await supabase
        .from('vehicle_maintenance')
        .update(updates)
        .eq('id', existingRecord!.id)
        .select()
        .single();

      if (updateError) {
        logger.error('Failed to update maintenance record', updateError);
        throw updateError;
      }

      maintenanceRecord = updated;
    }

    // Create history entries for all changed fields
    if (changedFields.length > 0) {
      const historyEntries = changedFields.map((change) => ({
        ...historyAssetKeys,
        field_name: change.field_name,
        old_value: change.old_value,
        new_value: change.new_value,
        value_type: change.value_type,
        maintenance_category_id: change.maintenance_category_id,
        comment: body.comment.trim(),
        updated_by: user.id,
        updated_by_name: userName,
      }));

      const { error: historyError } = await supabase
        .from('maintenance_history')
        .insert(historyEntries);

      if (historyError) {
        logger.error('Failed to create history entries', historyError);
      }
    } else {
      await supabase.from('maintenance_history').insert({
        ...historyAssetKeys,
        field_name: 'no_changes',
        old_value: null,
        new_value: null,
        value_type: 'text',
        maintenance_category_id: null,
        comment: body.comment.trim(),
        updated_by: user.id,
        updated_by_name: userName,
      });
    }

    return NextResponse.json({
      success: true,
      maintenance: maintenanceRecord,
      message: isNewRecord && hasMaintenanceUpdates
        ? 'Maintenance record created successfully'
        : 'Maintenance record updated successfully',
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(
      'POST /api/maintenance/by-vehicle/[vehicleId] failed',
      error,
      'MaintenanceAPI'
    );
    return NextResponse.json(
      { error: 'Internal server error', details: errorMessage },
      { status: 500 }
    );
  }
}
