import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';
import type { FAQArticleWithCategory, CreateFAQArticleRequest, FAQCategory } from '@/types/faq';

type FAQArticleRow = Omit<FAQArticleWithCategory, 'category'> & {
  category: Partial<FAQCategory> | Array<Partial<FAQCategory>> | null;
};

function normalizeCategory(category: FAQArticleRow['category']): FAQCategory {
  const raw = Array.isArray(category) ? category[0] || null : category;
  return {
    id: raw?.id || '',
    name: raw?.name || '',
    slug: raw?.slug || '',
    description: raw?.description || null,
    sort_order: raw?.sort_order || 0,
    is_active: raw?.is_active ?? true,
    module_name: raw?.module_name || null,
    created_at: raw?.created_at || '',
    updated_at: raw?.updated_at || '',
  };
}

function normalizeArticle(article: FAQArticleRow): FAQArticleWithCategory {
  return {
    ...article,
    category: normalizeCategory(article.category),
  };
}

/**
 * GET /api/admin/faq/articles
 * Get all FAQ articles (including unpublished) for admin management
 * Query params:
 *  - category_id: Filter by category (optional)
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

    const { searchParams } = new URL(request.url);
    const categoryId = searchParams.get('category_id');

    // Build query
    // Note: faq_articles table added by migration - types will update after migration runs
    let query = supabase
      .from('faq_articles')
      .select(`
        id,
        category_id,
        title,
        slug,
        summary,
        content_md,
        is_published,
        admin_only,
        sort_order,
        view_count,
        created_at,
        updated_at,
        created_by,
        updated_by,
        category:faq_categories(
          id,
          name,
          slug,
          description,
          sort_order,
          is_active,
          module_name,
          created_at,
          updated_at
        )
      `)
      .order('sort_order', { ascending: true });

    if (categoryId) {
      query = query.eq('category_id', categoryId);
    }

    const { data: articles, error } = await query;

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      articles: ((articles || []) as FAQArticleRow[]).map(normalizeArticle),
    });

  } catch (error) {
    console.error('Error in GET /api/admin/faq/articles:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/faq/articles',
      additionalData: { endpoint: '/api/admin/faq/articles' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

/**
 * POST /api/admin/faq/articles
 * Create a new FAQ article
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

    const body: CreateFAQArticleRequest = await request.json();

    // Validate required fields
    if (!body.category_id || !body.title?.trim() || !body.slug?.trim() || !body.content_md?.trim()) {
      return NextResponse.json({ 
        error: 'Category, title, slug, and content are required' 
      }, { status: 400 });
    }

    // Create article
    // Note: faq_articles table added by migration - types will update after migration runs
    const { data: article, error } = await supabase
      .from('faq_articles')
      .insert({
        category_id: body.category_id,
        title: body.title.trim(),
        slug: body.slug.trim().toLowerCase().replace(/\s+/g, '-'),
        summary: body.summary?.trim() || null,
        content_md: body.content_md.trim(),
        is_published: body.is_published ?? true,
        admin_only: body.admin_only ?? false,
        sort_order: body.sort_order || 0,
        created_by: user.id,
        updated_by: user.id,
      })
      .select(`
        id,
        category_id,
        title,
        slug,
        summary,
        content_md,
        is_published,
        admin_only,
        sort_order,
        view_count,
        created_at,
        updated_at,
        created_by,
        updated_by,
        category:faq_categories(
          id,
          name,
          slug,
          description,
          sort_order,
          is_active,
          module_name,
          created_at,
          updated_at
        )
      `)
      .single();

    if (error) {
      if (error.code === '23505') { // Unique violation
        return NextResponse.json({ error: 'An article with this slug already exists in this category' }, { status: 409 });
      }
      throw error;
    }

    return NextResponse.json({
      success: true,
      article: normalizeArticle(article as FAQArticleRow),
    }, { status: 201 });

  } catch (error) {
    console.error('Error in POST /api/admin/faq/articles:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/faq/articles',
      additionalData: { endpoint: '/api/admin/faq/articles' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}
