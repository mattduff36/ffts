import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getPermissionSetForUser } from '@/lib/server/team-permissions';
import { logServerError } from '@/lib/utils/server-error-logger';
import { hasEffectiveRoleFullAccess } from '@/lib/utils/role-access';
import { getEffectiveRole } from '@/lib/utils/view-as';
import type { FAQArticleWithCategory, FAQCategory } from '@/types/faq';
import type { ModuleName } from '@/types/roles';

function canAccessFAQCategory(category: FAQCategory, allowedModules: Set<ModuleName> | null): boolean {
  if (!category.module_name) return true;
  if (allowedModules === null) return true;
  return allowedModules.has(category.module_name);
}

function getArticleCategory(article: FAQArticleWithCategory): FAQCategory {
  return Array.isArray(article.category) ? article.category[0] : article.category;
}

interface FAQAccess {
  allowedModules: Set<ModuleName> | null;
  canViewAdminOnly: boolean;
}

async function getFAQAccess(): Promise<FAQAccess> {
  const effectiveRole = await getEffectiveRole();
  if (!effectiveRole.user_id || !effectiveRole.role_id) {
    return { allowedModules: new Set(), canViewAdminOnly: false };
  }

  if (hasEffectiveRoleFullAccess(effectiveRole)) {
    return { allowedModules: null, canViewAdminOnly: true };
  }

  return {
    allowedModules: await getPermissionSetForUser(
      effectiveRole.user_id,
      effectiveRole.role_id,
      createAdminClient(),
      effectiveRole.team_id
    ),
    canViewAdminOnly: false,
  };
}

/**
 * GET /api/faq
 * Search and retrieve FAQ articles
 * Query params:
 *  - query: Search text (optional)
 *  - category: Category slug filter (optional)
 *  - limit: Max results (default 50)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query')?.trim() || '';
    const categorySlug = searchParams.get('category');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
    const { allowedModules, canViewAdminOnly } = await getFAQAccess();

    // Fetch categories first so the article query is constrained before the limit is applied.
    const { data: categories, error: categoriesError } = await supabase
      .from('faq_categories')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (categoriesError) {
      throw categoriesError;
    }

    const filteredCategories = ((categories || []) as FAQCategory[])
      .filter((category) => canAccessFAQCategory(category, allowedModules));
    const requestedCategories = categorySlug
      ? filteredCategories.filter((category) => category.slug === categorySlug)
      : filteredCategories;
    const requestedCategoryIds = requestedCategories.map((category) => category.id);

    if (requestedCategoryIds.length === 0) {
      return NextResponse.json({
        success: true,
        articles: [],
        categories: filteredCategories,
        total: 0,
      });
    }

    // Build base query
    // Note: faq_articles/faq_categories tables added by migration - types will update after migration runs
    let articlesQuery = supabase
      .from('faq_articles')
      .select(`
        *,
        category:faq_categories!inner(*)
      `)
      .eq('is_published', true)
      .in('category_id', requestedCategoryIds);

    if (!canViewAdminOnly) {
      articlesQuery = articlesQuery.eq('admin_only', false);
    }

    // Apply search filter using full-text search
    if (query) {
      // Use PostgreSQL full-text search
      articlesQuery = articlesQuery.or(
        `title.ilike.%${query}%,summary.ilike.%${query}%,content_md.ilike.%${query}%`
      );
    }

    // Order by category sort, then article sort
    articlesQuery = articlesQuery
      .order('sort_order', { referencedTable: 'faq_categories', ascending: true })
      .order('sort_order', { ascending: true })
      .limit(limit);

    const { data: articles, error: articlesError } = await articlesQuery;

    if (articlesError) {
      throw articlesError;
    }
    
    const accessibleCategoryIds = new Set(requestedCategoryIds);
    const filteredArticles = ((articles || []) as FAQArticleWithCategory[])
      .filter((article) => {
        if (!accessibleCategoryIds.has(article.category_id)) return false;
        if (article.admin_only && !canViewAdminOnly) return false;
        return canAccessFAQCategory(getArticleCategory(article), allowedModules);
      });

    return NextResponse.json({
      success: true,
      articles: filteredArticles,
      categories: filteredCategories,
      total: filteredArticles.length,
    });

  } catch (error) {
    console.error('Error in GET /api/faq:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/faq',
      additionalData: { endpoint: '/api/faq' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}
