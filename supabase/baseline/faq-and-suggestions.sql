-- FAQ and Suggestions tables migration
-- Creates tables for FAQ knowledge base and user suggestions system

-- ============================================
-- FAQ Categories
-- ============================================
CREATE TABLE IF NOT EXISTS faq_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add RLS
ALTER TABLE faq_categories ENABLE ROW LEVEL SECURITY;

-- Everyone authenticated can read categories
CREATE POLICY "Authenticated users can view active FAQ categories"
  ON faq_categories
  FOR SELECT
  TO authenticated
  USING (is_active = TRUE);

-- Admins can manage categories
CREATE POLICY "Admins can manage FAQ categories"
  ON faq_categories
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      LEFT JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
      AND (r.is_manager_admin = TRUE OR r.is_super_admin = TRUE OR p.role IN ('admin'))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      LEFT JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
      AND (r.is_manager_admin = TRUE OR r.is_super_admin = TRUE OR p.role IN ('admin'))
    )
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_faq_categories_slug ON faq_categories(slug);
CREATE INDEX IF NOT EXISTS idx_faq_categories_sort_order ON faq_categories(sort_order);

-- ============================================
-- FAQ Articles
-- ============================================
CREATE TABLE IF NOT EXISTS faq_articles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id UUID NOT NULL REFERENCES faq_categories(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  summary TEXT,
  content_md TEXT NOT NULL,
  is_published BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  view_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  UNIQUE(category_id, slug)
);

-- Add RLS
ALTER TABLE faq_articles ENABLE ROW LEVEL SECURITY;

-- Everyone authenticated can read published articles
CREATE POLICY "Authenticated users can view published FAQ articles"
  ON faq_articles
  FOR SELECT
  TO authenticated
  USING (is_published = TRUE);

-- Admins can manage articles
CREATE POLICY "Admins can manage FAQ articles"
  ON faq_articles
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      LEFT JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
      AND (r.is_manager_admin = TRUE OR r.is_super_admin = TRUE OR p.role IN ('admin'))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      LEFT JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
      AND (r.is_manager_admin = TRUE OR r.is_super_admin = TRUE OR p.role IN ('admin'))
    )
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_faq_articles_category_id ON faq_articles(category_id);
CREATE INDEX IF NOT EXISTS idx_faq_articles_slug ON faq_articles(slug);
CREATE INDEX IF NOT EXISTS idx_faq_articles_published ON faq_articles(is_published);

-- Full text search index for FAQ search
CREATE INDEX IF NOT EXISTS idx_faq_articles_search ON faq_articles 
  USING gin(to_tsvector('english', coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(content_md, '')));

-- ============================================
-- Suggestions
-- ============================================
CREATE TABLE IF NOT EXISTS suggestions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_by UUID NOT NULL REFERENCES auth.users(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  page_hint TEXT, -- Optional: which page/module the suggestion relates to
  status TEXT CHECK (status IN ('new', 'under_review', 'planned', 'completed', 'declined')) DEFAULT 'new',
  admin_notes TEXT, -- Internal notes from managers/admins
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add RLS
ALTER TABLE suggestions ENABLE ROW LEVEL SECURITY;

-- Users can view their own suggestions
CREATE POLICY "Users can view own suggestions"
  ON suggestions
  FOR SELECT
  TO authenticated
  USING (created_by = auth.uid());

-- Users can create suggestions
CREATE POLICY "Authenticated users can create suggestions"
  ON suggestions
  FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

-- Managers/admins can view all suggestions
CREATE POLICY "Managers can view all suggestions"
  ON suggestions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      LEFT JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
      AND (r.is_manager_admin = TRUE OR r.is_super_admin = TRUE OR p.role IN ('admin', 'manager'))
    )
  );

-- Managers/admins can update suggestions (status, admin_notes)
CREATE POLICY "Managers can update suggestions"
  ON suggestions
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      LEFT JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
      AND (r.is_manager_admin = TRUE OR r.is_super_admin = TRUE OR p.role IN ('admin', 'manager'))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      LEFT JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
      AND (r.is_manager_admin = TRUE OR r.is_super_admin = TRUE OR p.role IN ('admin', 'manager'))
    )
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_suggestions_created_by ON suggestions(created_by);
CREATE INDEX IF NOT EXISTS idx_suggestions_status ON suggestions(status);
CREATE INDEX IF NOT EXISTS idx_suggestions_created_at ON suggestions(created_at DESC);

-- ============================================
-- Suggestion Updates (audit trail)
-- ============================================
CREATE TABLE IF NOT EXISTS suggestion_updates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  suggestion_id UUID NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  old_status TEXT,
  new_status TEXT,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add RLS
ALTER TABLE suggestion_updates ENABLE ROW LEVEL SECURITY;

-- Users can see updates on their own suggestions
CREATE POLICY "Users can view updates on own suggestions"
  ON suggestion_updates
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM suggestions s
      WHERE s.id = suggestion_updates.suggestion_id
      AND s.created_by = auth.uid()
    )
  );

-- Managers can see all updates
CREATE POLICY "Managers can view all suggestion updates"
  ON suggestion_updates
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      LEFT JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
      AND (r.is_manager_admin = TRUE OR r.is_super_admin = TRUE OR p.role IN ('admin', 'manager'))
    )
  );

-- Managers can create updates
CREATE POLICY "Managers can create suggestion updates"
  ON suggestion_updates
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      LEFT JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
      AND (r.is_manager_admin = TRUE OR r.is_super_admin = TRUE OR p.role IN ('admin', 'manager'))
    )
  );

-- Index
CREATE INDEX IF NOT EXISTS idx_suggestion_updates_suggestion_id ON suggestion_updates(suggestion_id);

-- ============================================
-- Updated_at triggers
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- FAQ categories trigger
DROP TRIGGER IF EXISTS update_faq_categories_updated_at ON faq_categories;
CREATE TRIGGER update_faq_categories_updated_at
  BEFORE UPDATE ON faq_categories
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- FAQ articles trigger
DROP TRIGGER IF EXISTS update_faq_articles_updated_at ON faq_articles;
CREATE TRIGGER update_faq_articles_updated_at
  BEFORE UPDATE ON faq_articles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Suggestions trigger
DROP TRIGGER IF EXISTS update_suggestions_updated_at ON suggestions;
CREATE TRIGGER update_suggestions_updated_at
  BEFORE UPDATE ON suggestions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Comments
-- ============================================
COMMENT ON TABLE faq_categories IS 'FAQ category groupings for the help system';
COMMENT ON TABLE faq_articles IS 'FAQ articles/help content';
COMMENT ON TABLE suggestions IS 'User suggestions for app improvements';
COMMENT ON TABLE suggestion_updates IS 'Audit trail for suggestion status changes';

COMMENT ON COLUMN faq_categories.slug IS 'URL-friendly identifier';
COMMENT ON COLUMN faq_articles.content_md IS 'Article content in Markdown format';
COMMENT ON COLUMN faq_articles.view_count IS 'Number of times the article has been viewed';
COMMENT ON COLUMN suggestions.page_hint IS 'Optional hint about which page/module the suggestion relates to';
COMMENT ON COLUMN suggestions.admin_notes IS 'Internal notes from managers/admins (not visible to submitter)';
