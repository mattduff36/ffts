import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/utils/logger';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { normalizePeriodUnit } from '@/lib/utils/maintenancePeriods';
import type {
  CreateCategoryRequest,
  CategoriesListResponse
} from '@/types/maintenance';

/**
 * GET /api/maintenance/categories
 * Returns all maintenance categories
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    // Get all categories ordered alphabetically (RLS handles permission check)
    const { data: categories, error } = await supabase
      .from('maintenance_categories')
      .select('*')
      .order('name');
    
    if (error) {
      logger.error('Failed to fetch categories', error);
      throw error;
    }
    
    const response: CategoriesListResponse = {
      success: true,
      categories: (categories || []).map((category) => ({
        ...category,
        period_unit: normalizePeriodUnit(category.type, category.period_unit),
        is_active: category.is_active ?? true,
        sort_order: category.sort_order ?? 0,
        created_at: category.created_at ?? '',
        updated_at: category.updated_at ?? '',
        responsibility: category.responsibility ?? 'workshop',
        show_on_overview: category.show_on_overview ?? true,
        reminder_in_app_enabled: category.reminder_in_app_enabled ?? false,
        reminder_email_enabled: category.reminder_email_enabled ?? false,
        applies_to: category.applies_to ?? [],
      }))
    };
    
    return NextResponse.json(response);
    
  } catch (error: unknown) {
    logger.error('GET /api/maintenance/categories failed', error, 'MaintenanceAPI');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/maintenance/categories
 * Create new maintenance category (Admin/Manager only)
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const canManageMaintenance = await canEffectiveRoleAccessModule('maintenance');
    if (!canManageMaintenance) {
      return NextResponse.json(
        { error: 'Maintenance access required to create categories' },
        { status: 403 }
      );
    }
    
    // Parse request body
    const body: CreateCategoryRequest = await request.json();
    
    // Validate required fields
    if (!body.name || !body.type) {
      return NextResponse.json(
        { error: 'Name and type are required' },
        { status: 400 }
      );
    }
    
    // Validate period_value
    if (!body.period_value || body.period_value <= 0) {
      return NextResponse.json(
        { error: 'period_value is required and must be a positive number' },
        { status: 400 }
      );
    }
    
    // Validate type
    if (!['date', 'mileage', 'hours'].includes(body.type)) {
      return NextResponse.json(
        { error: 'Type must be either "date", "mileage", or "hours"' },
        { status: 400 }
      );
    }

    const periodUnit = normalizePeriodUnit(body.type, body.period_unit);
    
    // Validate threshold
    if (body.type === 'date' && !body.alert_threshold_days) {
      return NextResponse.json(
        { error: 'alert_threshold_days is required for date-based categories' },
        { status: 400 }
      );
    }
    
    if (body.type === 'mileage' && !body.alert_threshold_miles) {
      return NextResponse.json(
        { error: 'alert_threshold_miles is required for mileage-based categories' },
        { status: 400 }
      );
    }
    
    if (body.type === 'hours' && !body.alert_threshold_hours) {
      return NextResponse.json(
        { error: 'alert_threshold_hours is required for hours-based categories' },
        { status: 400 }
      );
    }
    
    // Create category
    const { data, error } = await supabase
      .from('maintenance_categories')
      .insert({
        name: body.name,
        description: body.description || null,
        type: body.type,
        period_value: body.period_value,
        period_unit: periodUnit,
        alert_threshold_days: body.type === 'date' ? body.alert_threshold_days : null,
        alert_threshold_miles: body.type === 'mileage' ? body.alert_threshold_miles : null,
        alert_threshold_hours: body.type === 'hours' ? body.alert_threshold_hours : null,
        applies_to: body.applies_to || ['van'],
        sort_order: body.sort_order || 999,
        is_active: true,
        responsibility: body.responsibility || 'workshop',
        show_on_overview: body.show_on_overview !== false, // Default true
        reminder_in_app_enabled: body.reminder_in_app_enabled || false,
        reminder_email_enabled: body.reminder_email_enabled || false,
        field_key: null,
        is_system: false,
        is_delete_protected: false,
      })
      .select()
      .single();
    
    if (error) {
      // Check for unique constraint violation
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'A category with this name already exists' },
          { status: 409 }
        );
      }
      logger.error('Failed to create category', error);
      throw error;
    }
    
    return NextResponse.json({ success: true, category: data }, { status: 201 });
    
  } catch (error: unknown) {
    logger.error('POST /api/maintenance/categories failed', error, 'MaintenanceAPI');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
