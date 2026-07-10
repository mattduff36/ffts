import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/utils/logger';
import type { UpdateCategoryRequest } from '@/types/maintenance';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { normalizePeriodUnit } from '@/lib/utils/maintenancePeriods';

interface CategoryProtectionRow {
  type: 'date' | 'mileage' | 'hours';
  is_system?: boolean;
  is_delete_protected?: boolean;
}

/**
 * PUT /api/maintenance/categories/[id]
 * Update maintenance category (Admin/Manager only)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const canManageMaintenance = await canEffectiveRoleAccessModule('maintenance');
    if (!canManageMaintenance) {
      return NextResponse.json(
        { error: 'Maintenance access required to update categories' },
        { status: 403 }
      );
    }
    
    const body: UpdateCategoryRequest = await request.json();

    const { data: existingCategory, error: existingCategoryError } = await (supabase as never as { from: (table: string) => { select: (columns: string) => { eq: (column: string, value: string) => { single: () => Promise<{ data: CategoryProtectionRow | null; error: unknown }> } } } })
      .from('maintenance_categories')
      .select('type, is_system, is_delete_protected')
      .eq('id', id)
      .single();

    if (existingCategoryError || !existingCategory) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }
    
    // Build update object
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.alert_threshold_days !== undefined) updates.alert_threshold_days = body.alert_threshold_days;
    if (body.alert_threshold_miles !== undefined) updates.alert_threshold_miles = body.alert_threshold_miles;
    if (body.alert_threshold_hours !== undefined) updates.alert_threshold_hours = body.alert_threshold_hours;
    if (body.sort_order !== undefined) updates.sort_order = body.sort_order;
    if (body.responsibility !== undefined) updates.responsibility = body.responsibility;
    if (body.show_on_overview !== undefined) updates.show_on_overview = body.show_on_overview;
    if (body.reminder_in_app_enabled !== undefined) updates.reminder_in_app_enabled = body.reminder_in_app_enabled;
    if (body.reminder_email_enabled !== undefined) updates.reminder_email_enabled = body.reminder_email_enabled;

    if (!existingCategory.is_system && body.period_value !== undefined) updates.period_value = body.period_value;
    if (!existingCategory.is_system && body.applies_to !== undefined) updates.applies_to = body.applies_to;
    if (!existingCategory.is_delete_protected && body.is_active !== undefined) updates.is_active = body.is_active;
    if (!existingCategory.is_system && body.period_unit !== undefined) {
      updates.period_unit = normalizePeriodUnit(existingCategory.type, body.period_unit);
    }
    
    const { data, error } = await supabase
      .from('maintenance_categories')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) {
      logger.error('Failed to update category', error);
      throw error;
    }
    
    return NextResponse.json({ success: true, category: data });
    
  } catch (error: unknown) {
    logger.error('PUT /api/maintenance/categories/[id] failed', error, 'MaintenanceAPI');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/maintenance/categories/[id]
 * Delete maintenance category (Admin/Manager only)
 * Fails if category is in use
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const canManageMaintenance = await canEffectiveRoleAccessModule('maintenance');
    if (!canManageMaintenance) {
      return NextResponse.json(
        { error: 'Maintenance access required to delete categories' },
        { status: 403 }
      );
    }
    
    const { data: category, error: categoryError } = await (supabase as never as { from: (table: string) => { select: (columns: string) => { eq: (column: string, value: string) => { single: () => Promise<{ data: CategoryProtectionRow | null; error: unknown }> } } } })
      .from('maintenance_categories')
      .select('is_delete_protected, is_system')
      .eq('id', id)
      .single();

    if (categoryError || !category) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }

    if (category.is_delete_protected || category.is_system) {
      return NextResponse.json(
        { error: 'System categories are API-backed and cannot be deleted' },
        { status: 409 }
      );
    }
    
    // Hide custom categories instead of physically deleting them so historical values remain auditable.
    const { error } = await supabase
      .from('maintenance_categories')
      .update({ is_active: false })
      .eq('id', id);
    
    if (error) {
      logger.error('Failed to delete category', error);
      throw error;
    }
    
    return NextResponse.json({ success: true });
    
  } catch (error: unknown) {
    logger.error('DELETE /api/maintenance/categories/[id] failed', error, 'MaintenanceAPI');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
