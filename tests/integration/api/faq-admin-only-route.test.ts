import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const {
  articleQuery,
  mockEffectiveRole,
  mockPermissionSet,
} = vi.hoisted(() => {
  const query = {
    eq: vi.fn(),
    in: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };
  query.eq.mockReturnValue(query);
  query.in.mockReturnValue(query);
  query.or.mockReturnValue(query);
  query.order.mockReturnValue(query);
  return {
    articleQuery: query,
    mockEffectiveRole: vi.fn(),
    mockPermissionSet: vi.fn(),
  };
});

const category = {
  id: 'category-1',
  name: 'Admin Settings',
  slug: 'admin-settings',
  description: null,
  sort_order: 20,
  is_active: true,
  module_name: 'admin-settings',
  created_at: '2026-07-20T00:00:00Z',
  updated_at: '2026-07-20T00:00:00Z',
};

const regularArticle = {
  id: 'article-1',
  category_id: 'category-1',
  title: 'Regular article',
  slug: 'regular',
  summary: null,
  content_md: 'Regular help',
  is_published: true,
  admin_only: false,
  sort_order: 1,
  view_count: 0,
  created_at: '2026-07-20T00:00:00Z',
  updated_at: '2026-07-20T00:00:00Z',
  created_by: null,
  updated_by: null,
  category,
};

const adminArticle = {
  ...regularArticle,
  id: 'article-2',
  title: 'Admin scripts',
  slug: 'admin-scripts',
  admin_only: true,
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }),
    },
    from: (table: string) => {
      if (table === 'faq_categories') {
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({ data: [category], error: null }),
            }),
          }),
        };
      }
      if (table === 'faq_articles') return { select: () => articleQuery };
      throw new Error(`Unexpected table ${table}`);
    },
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ name: 'admin-client' }),
}));
vi.mock('@/lib/server/team-permissions', () => ({
  getPermissionSetForUser: mockPermissionSet,
}));
vi.mock('@/lib/utils/view-as', () => ({
  getEffectiveRole: mockEffectiveRole,
}));
vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: vi.fn(),
}));

describe('GET /api/faq admin-only visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    articleQuery.eq.mockReturnValue(articleQuery);
    articleQuery.in.mockReturnValue(articleQuery);
    articleQuery.or.mockReturnValue(articleQuery);
    articleQuery.order.mockReturnValue(articleQuery);
    articleQuery.limit.mockResolvedValue({
      data: [regularArticle, adminArticle],
      error: null,
    });
    mockPermissionSet.mockResolvedValue(new Set(['admin-settings']));
  });

  it('excludes restricted articles for a manager even with category permission', async () => {
    mockEffectiveRole.mockResolvedValue({
      user_id: 'manager-1',
      role_id: 'manager-role',
      role_name: 'manager',
      role_class: 'manager',
      is_super_admin: false,
      is_actual_super_admin: false,
      is_viewing_as: false,
      team_id: null,
    });
    const { GET } = await import('@/app/api/faq/route');
    const response = await GET(new NextRequest('http://localhost/api/faq'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(articleQuery.eq).toHaveBeenCalledWith('admin_only', false);
    expect(payload.articles.map((article: { id: string }) => article.id)).toEqual(['article-1']);
  });

  it('returns restricted articles to an Admin account', async () => {
    mockEffectiveRole.mockResolvedValue({
      user_id: 'admin-1',
      role_id: 'admin-role',
      role_name: 'admin',
      role_class: 'admin',
      is_super_admin: false,
      is_actual_super_admin: false,
      is_viewing_as: false,
      team_id: null,
    });
    const { GET } = await import('@/app/api/faq/route');
    const response = await GET(new NextRequest('http://localhost/api/faq'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(articleQuery.eq).not.toHaveBeenCalledWith('admin_only', false);
    expect(payload.articles).toHaveLength(2);
  });
});
