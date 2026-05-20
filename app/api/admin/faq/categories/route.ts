import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';
import type { FAQCategory, CreateFAQCategoryRequest } from '@/types/faq';
import { ALL_MODULES, type ModuleName } from '@/types/roles';

const MODULE_NAMES = new Set<ModuleName>(ALL_MODULES);

function normalizeModuleName(moduleName: CreateFAQCategoryRequest['module_name']): ModuleName | null {
  if (!moduleName) return null;
  if (!MODULE_NAMES.has(moduleName)) {
    throw new Error('Invalid FAQ category module gate');
  }
  return moduleName;
}

/**
 * GET /api/admin/faq/categories
 * Get all FAQ categories (including inactive) for admin management
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAuthorized = await canEffectiveRoleAccessModule('faq-editor');
    if (!isAuthorized) {
      return NextResponse.json({ error: 'Forbidden - faq-editor access required' }, { status: 403 });
    }

    // Fetch all categories with article counts
    // Note: faq_categories table added by migration - types will update after migration runs
    const { data: categories, error } = await supabase
      .from('faq_categories')
      .select(`
        *,
        articles:faq_articles(count)
      `)
      .order('sort_order', { ascending: true });

    if (error) {
      throw error;
    }

    // Format with article counts
    const formattedCategories = categories?.map((cat: { articles?: { count?: number }[]; [key: string]: unknown }) => ({
      ...cat,
      article_count: cat.articles?.[0]?.count || 0,
    }));

    return NextResponse.json({
      success: true,
      categories: formattedCategories as (FAQCategory & { article_count: number })[],
    });

  } catch (error) {
    console.error('Error in GET /api/admin/faq/categories:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/faq/categories',
      additionalData: { endpoint: '/api/admin/faq/categories' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

/**
 * POST /api/admin/faq/categories
 * Create a new FAQ category
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAuthorized = await canEffectiveRoleAccessModule('faq-editor');
    if (!isAuthorized) {
      return NextResponse.json({ error: 'Forbidden - faq-editor access required' }, { status: 403 });
    }

    const body: CreateFAQCategoryRequest = await request.json();
    let moduleName: ModuleName | null;

    // Validate required fields
    if (!body.name?.trim() || !body.slug?.trim()) {
      return NextResponse.json({ 
        error: 'Name and slug are required' 
      }, { status: 400 });
    }

    try {
      moduleName = normalizeModuleName(body.module_name);
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : 'Invalid FAQ category module gate',
      }, { status: 400 });
    }

    // Create category
    // Note: faq_categories table added by migration - types will update after migration runs
    const { data: category, error } = await supabase
      .from('faq_categories')
      .insert({
        name: body.name.trim(),
        slug: body.slug.trim().toLowerCase().replace(/\s+/g, '-'),
        description: body.description?.trim() || null,
        sort_order: body.sort_order || 0,
        module_name: moduleName,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') { // Unique violation
        return NextResponse.json({ error: 'A category with this slug already exists' }, { status: 409 });
      }
      throw error;
    }

    return NextResponse.json({
      success: true,
      category,
    }, { status: 201 });

  } catch (error) {
    console.error('Error in POST /api/admin/faq/categories:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/faq/categories',
      additionalData: { endpoint: '/api/admin/faq/categories' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}
