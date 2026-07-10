import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/utils/logger';
import type {
  CustomMaintenanceItemUpdate,
  UpdateMaintenanceRequest
} from '@/types/maintenance';

interface CustomCategoryRow {
  id: string;
  name: string;
  type: 'date' | 'mileage' | 'hours';
  field_key: string | null;
}

interface CustomValueRow {
  id: string;
  maintenance_category_id: string;
  due_date: string | null;
  due_mileage: number | null;
  last_mileage: number | null;
  due_hours: number | null;
  last_hours: number | null;
  notes: string | null;
}

function serializeCustomValue(value?: CustomValueRow | CustomMaintenanceItemUpdate | null): string | null {
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

/**
 * PUT /api/maintenance/[id]
 * Update vehicle maintenance record with mandatory comment
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    // Auth check
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    // Get user profile for name
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single();
    
    const userName = profile?.full_name || 'Unknown User';
    
    // Parse request body
    const body: UpdateMaintenanceRequest = await request.json();
    
    // Validate comment (mandatory, min 10 characters)
    if (!body.comment || body.comment.trim().length < 10) {
      return NextResponse.json(
        { error: 'Comment is required and must be at least 10 characters' },
        { status: 400 }
      );
    }
    
    // Get current maintenance record (no asset join needed; FKs are on the row itself)
    const { data: currentRecord, error: fetchError } = await supabase
      .from('vehicle_maintenance')
      .select('*')
      .eq('id', id)
      .single();
    
    if (fetchError || !currentRecord) {
      return NextResponse.json(
        { error: 'Maintenance record not found' },
        { status: 404 }
      );
    }
    
    // Build update object (only include provided fields)
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      last_updated_by: user.id
    };
    
    // Track which fields changed for history
    const changedFields: Array<{
      field_name: string;
      old_value: string | null;
      new_value: string | null;
      value_type: 'date' | 'mileage' | 'boolean' | 'text';
    }> = [];
    
    // Check each possible update field
    // Current mileage (manual override)
    if (body.current_mileage !== undefined) {
      updates.current_mileage = body.current_mileage;
      updates.last_mileage_update = new Date().toISOString(); // Update the last mileage timestamp
      if (currentRecord.current_mileage !== body.current_mileage) {
        changedFields.push({
          field_name: 'current_mileage',
          old_value: currentRecord.current_mileage?.toString() || null,
          new_value: body.current_mileage?.toString() || null,
          value_type: 'mileage'
        });
      }
    }
    
    if (body.tax_due_date !== undefined) {
      updates.tax_due_date = body.tax_due_date;
      if (currentRecord.tax_due_date !== body.tax_due_date) {
        changedFields.push({
          field_name: 'tax_due_date',
          old_value: currentRecord.tax_due_date,
          new_value: body.tax_due_date,
          value_type: 'date'
        });
      }
    }
    
    if (body.mot_due_date !== undefined) {
      updates.mot_due_date = body.mot_due_date;
      if (currentRecord.mot_due_date !== body.mot_due_date) {
        changedFields.push({
          field_name: 'mot_due_date',
          old_value: currentRecord.mot_due_date,
          new_value: body.mot_due_date,
          value_type: 'date'
        });
      }
    }
    
    if (body.first_aid_kit_expiry !== undefined) {
      updates.first_aid_kit_expiry = body.first_aid_kit_expiry;
      if (currentRecord.first_aid_kit_expiry !== body.first_aid_kit_expiry) {
        changedFields.push({
          field_name: 'first_aid_kit_expiry',
          old_value: currentRecord.first_aid_kit_expiry,
          new_value: body.first_aid_kit_expiry,
          value_type: 'date'
        });
      }
    }

    if (body.six_weekly_inspection_due_date !== undefined) {
      updates.six_weekly_inspection_due_date = body.six_weekly_inspection_due_date;
      if (currentRecord.six_weekly_inspection_due_date !== body.six_weekly_inspection_due_date) {
        changedFields.push({
          field_name: 'six_weekly_inspection_due_date',
          old_value: currentRecord.six_weekly_inspection_due_date,
          new_value: body.six_weekly_inspection_due_date,
          value_type: 'date'
        });
      }
    }

    if (body.fire_extinguisher_due_date !== undefined) {
      updates.fire_extinguisher_due_date = body.fire_extinguisher_due_date;
      if (currentRecord.fire_extinguisher_due_date !== body.fire_extinguisher_due_date) {
        changedFields.push({
          field_name: 'fire_extinguisher_due_date',
          old_value: currentRecord.fire_extinguisher_due_date,
          new_value: body.fire_extinguisher_due_date,
          value_type: 'date'
        });
      }
    }

    if (body.taco_calibration_due_date !== undefined) {
      updates.taco_calibration_due_date = body.taco_calibration_due_date;
      if (currentRecord.taco_calibration_due_date !== body.taco_calibration_due_date) {
        changedFields.push({
          field_name: 'taco_calibration_due_date',
          old_value: currentRecord.taco_calibration_due_date,
          new_value: body.taco_calibration_due_date,
          value_type: 'date'
        });
      }
    }
    
    if (body.next_service_mileage !== undefined) {
      updates.next_service_mileage = body.next_service_mileage;
      if (currentRecord.next_service_mileage !== body.next_service_mileage) {
        changedFields.push({
          field_name: 'next_service_mileage',
          old_value: currentRecord.next_service_mileage?.toString() || null,
          new_value: body.next_service_mileage?.toString() || null,
          value_type: 'mileage'
        });
      }
    }
    
    if (body.last_service_mileage !== undefined) {
      updates.last_service_mileage = body.last_service_mileage;
      if (currentRecord.last_service_mileage !== body.last_service_mileage) {
        changedFields.push({
          field_name: 'last_service_mileage',
          old_value: currentRecord.last_service_mileage?.toString() || null,
          new_value: body.last_service_mileage?.toString() || null,
          value_type: 'mileage'
        });
      }
    }
    
    if (body.cambelt_due_mileage !== undefined) {
      updates.cambelt_due_mileage = body.cambelt_due_mileage;
      if (currentRecord.cambelt_due_mileage !== body.cambelt_due_mileage) {
        changedFields.push({
          field_name: 'cambelt_due_mileage',
          old_value: currentRecord.cambelt_due_mileage?.toString() || null,
          new_value: body.cambelt_due_mileage?.toString() || null,
          value_type: 'mileage'
        });
      }
    }
    
    // Hours-based fields for plant machinery
    if (body.current_hours !== undefined) {
      updates.current_hours = body.current_hours;
      updates.last_hours_update = new Date().toISOString();
      if (currentRecord.current_hours !== body.current_hours) {
        changedFields.push({
          field_name: 'current_hours',
          old_value: currentRecord.current_hours?.toString() || null,
          new_value: body.current_hours?.toString() || null,
          value_type: 'text'
        });
      }
    }
    
    if (body.last_service_hours !== undefined) {
      updates.last_service_hours = body.last_service_hours;
      if (currentRecord.last_service_hours !== body.last_service_hours) {
        changedFields.push({
          field_name: 'last_service_hours',
          old_value: currentRecord.last_service_hours?.toString() || null,
          new_value: body.last_service_hours?.toString() || null,
          value_type: 'text'
        });
      }
    }
    
    if (body.next_service_hours !== undefined) {
      updates.next_service_hours = body.next_service_hours;
      if (currentRecord.next_service_hours !== body.next_service_hours) {
        changedFields.push({
          field_name: 'next_service_hours',
          old_value: currentRecord.next_service_hours?.toString() || null,
          new_value: body.next_service_hours?.toString() || null,
          value_type: 'text'
        });
      }
    }
    
    if (body.tracker_id !== undefined) {
      updates.tracker_id = body.tracker_id;
      if (currentRecord.tracker_id !== body.tracker_id) {
        changedFields.push({
          field_name: 'tracker_id',
          old_value: currentRecord.tracker_id,
          new_value: body.tracker_id,
          value_type: 'text'
        });
      }
    }
    
    if (body.notes !== undefined) {
      updates.notes = body.notes;
      if (currentRecord.notes !== body.notes) {
        changedFields.push({
          field_name: 'notes',
          old_value: currentRecord.notes,
          new_value: body.notes,
          value_type: 'text'
        });
      }
    }

    const customItems = body.custom_items || [];
    const customHistoryEntries: Array<{
      van_id: string | null;
      plant_id: string | null;
      hgv_id: string | null;
      maintenance_category_id: string;
      field_name: string;
      old_value: string | null;
      new_value: string | null;
      value_type: 'date' | 'mileage' | 'boolean' | 'text';
      comment: string;
      updated_by: string;
      updated_by_name: string;
    }> = [];

    if (customItems.length > 0) {
      const assetColumn = currentRecord.van_id ? 'van_id' : currentRecord.hgv_id ? 'hgv_id' : currentRecord.plant_id ? 'plant_id' : null;
      const assetId = currentRecord.van_id || currentRecord.hgv_id || currentRecord.plant_id;

      if (!assetColumn || !assetId) {
        return NextResponse.json(
          { error: 'Maintenance record is not linked to an asset' },
          { status: 400 }
        );
      }

      const categoryIds = [...new Set(customItems.map(item => item.category_id))];
      const { data: customCategories, error: customCategoriesError } = await (supabase as never as { from: (table: string) => { select: (columns: string) => { in: (column: string, values: string[]) => Promise<{ data: unknown; error: unknown }> } } })
        .from('maintenance_categories')
        .select('id, name, type, field_key')
        .in('id', categoryIds);

      if (customCategoriesError) {
        logger.error('Failed to fetch custom categories', customCategoriesError);
        throw customCategoriesError;
      }

      const categoriesById = new Map(((customCategories || []) as CustomCategoryRow[]).map(category => [category.id, category]));

      const { data: existingCustomValues, error: existingCustomValuesError } = await (supabase as never as { from: (table: string) => { select: (columns: string) => { in: (column: string, values: string[]) => { eq: (column: string, value: string) => Promise<{ data: unknown; error: unknown }> } } } })
        .from('asset_maintenance_category_values')
        .select('id, maintenance_category_id, due_date, due_mileage, last_mileage, due_hours, last_hours, notes')
        .in('maintenance_category_id', categoryIds)
        .eq(assetColumn, assetId);

      if (existingCustomValuesError) {
        logger.error('Failed to fetch custom category values', existingCustomValuesError);
        throw existingCustomValuesError;
      }

      const existingValuesByCategoryId = new Map(
        ((existingCustomValues || []) as CustomValueRow[]).map(value => [value.maintenance_category_id, value])
      );

      for (const item of customItems) {
        const category = categoriesById.get(item.category_id);
        if (!category || category.field_key) continue;

        const existingValue = existingValuesByCategoryId.get(item.category_id) || null;
        const oldValue = serializeCustomValue(existingValue);
        const newValue = serializeCustomValue(item);
        if (oldValue === newValue) continue;

        if (isEmptyCustomValue(item)) {
          if (existingValue) {
            const { error: deleteValueError } = await (supabase as never as { from: (table: string) => { delete: () => { eq: (column: string, value: string) => Promise<{ error: unknown }> } } })
              .from('asset_maintenance_category_values')
              .delete()
              .eq('id', existingValue.id);

            if (deleteValueError) {
              logger.error('Failed to clear custom category value', deleteValueError);
              throw deleteValueError;
            }
          }
        } else {
          const { error: upsertValueError } = await (supabase as never as { from: (table: string) => { upsert: (row: unknown, options: { onConflict: string }) => Promise<{ error: unknown }> } })
            .from('asset_maintenance_category_values')
            .upsert({
              maintenance_category_id: item.category_id,
              van_id: currentRecord.van_id,
              hgv_id: currentRecord.hgv_id,
              plant_id: currentRecord.plant_id,
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
            logger.error('Failed to upsert custom category value', upsertValueError);
            throw upsertValueError;
          }
        }

        changedFields.push({
          field_name: `category:${category.name}`,
          old_value: oldValue,
          new_value: newValue,
          value_type: category.type === 'date' ? 'date' : category.type === 'mileage' ? 'mileage' : 'text',
        });

        customHistoryEntries.push({
          van_id: currentRecord.van_id,
          plant_id: currentRecord.plant_id,
          hgv_id: currentRecord.hgv_id,
          maintenance_category_id: item.category_id,
          field_name: `category:${category.name}`,
          old_value: oldValue,
          new_value: newValue,
          value_type: category.type === 'date' ? 'date' : category.type === 'mileage' ? 'mileage' : 'text',
          comment: body.comment,
          updated_by: user.id,
          updated_by_name: userName,
        });
      }
    }
    
    // If no fields changed, still create history entry but just return current record
    if (changedFields.length === 0) {
      // Create history entry for the update attempt
      await supabase
        .from('maintenance_history')
        .insert({
          van_id: currentRecord.van_id,
          plant_id: currentRecord.plant_id,
          hgv_id: currentRecord.hgv_id,
          field_name: 'no_changes',
          old_value: null,
          new_value: null,
          value_type: 'text',
          comment: body.comment,
          updated_by: user.id,
          updated_by_name: userName
        });
      
      return NextResponse.json({
        success: true,
        maintenance: currentRecord,
        message: 'No changes detected, but comment saved to history'
      });
    }
    
    // Update maintenance record
    const { data: updatedMaintenance, error: updateError } = await supabase
      .from('vehicle_maintenance')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (updateError) {
      logger.error('Failed to update maintenance', updateError);
      throw updateError;
    }

    if (currentRecord.hgv_id && body.current_mileage !== undefined && body.current_mileage !== null) {
      const { error: updateHgvError } = await supabase
        .from('hgvs')
        .update({ current_mileage: body.current_mileage })
        .eq('id', currentRecord.hgv_id);

      if (updateHgvError) {
        logger.error('Failed to sync hgvs.current_mileage from maintenance update', updateHgvError);
      }
    }
    
    // Create history entries for all changed fields
    const historyEntries = [
      ...changedFields
        .filter(change => !change.field_name.startsWith('category:'))
        .map(change => ({
          van_id: currentRecord.van_id,
          plant_id: currentRecord.plant_id,
          hgv_id: currentRecord.hgv_id,
          field_name: change.field_name,
          old_value: change.old_value,
          new_value: change.new_value,
          value_type: change.value_type,
          comment: body.comment,
          updated_by: user.id,
          updated_by_name: userName
        })),
      ...customHistoryEntries,
    ];
    
    const { data: historyData, error: historyError } = await supabase
      .from('maintenance_history')
      .insert(historyEntries)
      .select();
    
    if (historyError) {
      logger.error('Failed to create history entry', historyError);
      // Don't fail the request if history fails, just log it
    }
    
    const response = {
      success: true,
      maintenance: updatedMaintenance,
      history_entry: historyData
    };
    
    return NextResponse.json(response);
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('PUT /api/maintenance/[id] failed', error, 'MaintenanceAPI');
    return NextResponse.json(
      { error: 'Internal server error', details: errorMessage },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/maintenance/[id]
 * Delete a maintenance record (note: typically we use archive instead)
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    // Auth check
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    // Delete maintenance record (CASCADE will handle history)
    const { error: deleteError } = await supabase
      .from('vehicle_maintenance')
      .delete()
      .eq('id', id);
    
    if (deleteError) {
      logger.error('Failed to delete maintenance', deleteError);
      throw deleteError;
    }
    
    return NextResponse.json({ success: true });
    
  } catch (error: unknown) {
    logger.error('DELETE /api/maintenance/[id] failed', error, 'MaintenanceAPI');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
