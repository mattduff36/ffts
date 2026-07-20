import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';
import type { UpdateFAQArticleRequest } from '@/types/faq';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/admin/faq/articles/[id]
 * Get a single FAQ article
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
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

    // Note: faq_articles table added by migration - types will update after migration runs
    const { data: article, error } = await supabase
      .from('faq_articles')
      .select(`
        *,
        category:faq_categories(*)
      `)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Article not found' }, { status: 404 });
      }
      throw error;
    }

    return NextResponse.json({
      success: true,
      article,
    });

  } catch (error) {
    console.error('Error in GET /api/admin/faq/articles/[id]:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/faq/articles/[id]',
      additionalData: { endpoint: '/api/admin/faq/articles/[id]' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/faq/articles/[id]
 * Update a FAQ article
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
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

    const body: UpdateFAQArticleRequest = await request.json();

    // Prepare update data
    const updateData: Record<string, unknown> = {
      updated_by: user.id,
    };
    if (body.category_id !== undefined) updateData.category_id = body.category_id;
    if (body.title !== undefined) updateData.title = body.title.trim();
    if (body.slug !== undefined) updateData.slug = body.slug.trim().toLowerCase().replace(/\s+/g, '-');
    if (body.summary !== undefined) updateData.summary = body.summary?.trim() || null;
    if (body.content_md !== undefined) updateData.content_md = body.content_md.trim();
    if (body.is_published !== undefined) updateData.is_published = body.is_published;
    if (body.admin_only !== undefined) updateData.admin_only = body.admin_only;
    if (body.sort_order !== undefined) updateData.sort_order = body.sort_order;

    // Note: faq_articles table added by migration - types will update after migration runs
    const { data: article, error } = await supabase
      .from('faq_articles')
      .update(updateData)
      .eq('id', id)
      .select(`
        *,
        category:faq_categories(*)
      `)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Article not found' }, { status: 404 });
      }
      if (error.code === '23505') {
        return NextResponse.json({ error: 'An article with this slug already exists in this category' }, { status: 409 });
      }
      throw error;
    }

    return NextResponse.json({
      success: true,
      article,
    });

  } catch (error) {
    console.error('Error in PATCH /api/admin/faq/articles/[id]:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/faq/articles/[id]',
      additionalData: { endpoint: '/api/admin/faq/articles/[id]' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/faq/articles/[id]
 * Delete a FAQ article
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
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

    // Note: faq_articles table added by migration - types will update after migration runs
    const { error } = await supabase
      .from('faq_articles')
      .delete()
      .eq('id', id);

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      message: 'Article deleted',
    });

  } catch (error) {
    console.error('Error in DELETE /api/admin/faq/articles/[id]:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/faq/articles/[id]',
      additionalData: { endpoint: '/api/admin/faq/articles/[id]' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}
