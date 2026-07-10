-- =============================================================================
-- Quotes Workflow Upgrade
-- =============================================================================
-- Adds:
--   - configurable manager numbering/sign-off
--   - quote thread / revision support
--   - quote attachments
--   - invoice history + optional line allocations
--   - richer operational workflow fields
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS quote_manager_series (
  profile_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  initials VARCHAR(10) NOT NULL UNIQUE,
  next_number INTEGER NOT NULL,
  number_start INTEGER NOT NULL,
  signoff_name VARCHAR(255),
  signoff_title VARCHAR(255),
  manager_email VARCHAR(255),
  approver_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (next_number >= 0),
  CHECK (number_start >= 0)
);

COMMENT ON TABLE quote_manager_series IS 'Manager-specific quote numbering and sign-off defaults.';

ALTER TABLE quotes
  DROP CONSTRAINT IF EXISTS quotes_status_check;

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS base_quote_reference VARCHAR(30),
  ADD COLUMN IF NOT EXISTS quote_thread_id UUID REFERENCES quotes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parent_quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revision_number INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revision_type VARCHAR(30) NOT NULL DEFAULT 'original',
  ADD COLUMN IF NOT EXISTS version_label VARCHAR(50),
  ADD COLUMN IF NOT EXISTS version_notes TEXT,
  ADD COLUMN IF NOT EXISTS is_latest_version BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS duplicate_source_quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS site_address TEXT,
  ADD COLUMN IF NOT EXISTS manager_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS manager_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS approver_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS return_comments TEXT,
  ADD COLUMN IF NOT EXISTS customer_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS customer_sent_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS po_received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS po_value NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS start_alert_days INTEGER,
  ADD COLUMN IF NOT EXISTS start_alert_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completion_status VARCHAR(30) NOT NULL DEFAULT 'not_completed',
  ADD COLUMN IF NOT EXISTS completion_comments TEXT,
  ADD COLUMN IF NOT EXISTS commercial_status VARCHAR(20) NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rams_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_invoice_at TIMESTAMPTZ;

UPDATE quotes
SET
  base_quote_reference = COALESCE(base_quote_reference, quote_reference),
  quote_thread_id = COALESCE(quote_thread_id, id),
  manager_name = COALESCE(manager_name, signoff_name),
  version_label = COALESCE(version_label, 'Original')
WHERE
  base_quote_reference IS NULL
  OR quote_thread_id IS NULL
  OR version_label IS NULL;

ALTER TABLE quotes
  ALTER COLUMN base_quote_reference SET NOT NULL,
  ALTER COLUMN quote_thread_id SET NOT NULL;

ALTER TABLE quotes
  ADD CONSTRAINT quotes_status_check
  CHECK (status IN (
    'draft',
    'pending_internal_approval',
    'changes_requested',
    'approved',
    'sent',
    'won',
    'lost',
    'ready_to_invoice',
    'po_received',
    'in_progress',
    'completed_part',
    'completed_full',
    'partially_invoiced',
    'invoiced',
    'closed'
  ));

ALTER TABLE quotes
  DROP CONSTRAINT IF EXISTS quotes_revision_type_check;

ALTER TABLE quotes
  ADD CONSTRAINT quotes_revision_type_check
  CHECK (revision_type IN ('original', 'revision', 'extra', 'variation', 'future_work', 'duplicate'));

ALTER TABLE quotes
  DROP CONSTRAINT IF EXISTS quotes_completion_status_check;

ALTER TABLE quotes
  ADD CONSTRAINT quotes_completion_status_check
  CHECK (completion_status IN ('not_completed', 'approved_in_full', 'approved_in_part'));

ALTER TABLE quotes
  DROP CONSTRAINT IF EXISTS quotes_commercial_status_check;

ALTER TABLE quotes
  ADD CONSTRAINT quotes_commercial_status_check
  CHECK (commercial_status IN ('open', 'closed'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_quote_manager_series_initials ON quote_manager_series(initials);
CREATE INDEX IF NOT EXISTS idx_quote_manager_series_approver ON quote_manager_series(approver_profile_id);

CREATE INDEX IF NOT EXISTS idx_quotes_quote_thread_id ON quotes(quote_thread_id);
CREATE INDEX IF NOT EXISTS idx_quotes_parent_quote_id ON quotes(parent_quote_id);
CREATE INDEX IF NOT EXISTS idx_quotes_base_reference ON quotes(base_quote_reference);
CREATE INDEX IF NOT EXISTS idx_quotes_latest_version ON quotes(quote_thread_id, is_latest_version);
CREATE INDEX IF NOT EXISTS idx_quotes_approver_profile_id ON quotes(approver_profile_id);
CREATE INDEX IF NOT EXISTS idx_quotes_start_date ON quotes(start_date);
CREATE INDEX IF NOT EXISTS idx_quotes_po_received_at ON quotes(po_received_at);
CREATE INDEX IF NOT EXISTS idx_quotes_completion_status ON quotes(completion_status);
CREATE INDEX IF NOT EXISTS idx_quotes_commercial_status ON quotes(commercial_status);

CREATE TABLE IF NOT EXISTS quote_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  file_path TEXT NOT NULL,
  content_type VARCHAR(150),
  file_size BIGINT,
  uploaded_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE quote_attachments IS 'Supporting files attached to quote versions.';

CREATE INDEX IF NOT EXISTS idx_quote_attachments_quote_id ON quote_attachments(quote_id, created_at DESC);

CREATE TABLE IF NOT EXISTS quote_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  invoice_number VARCHAR(100) NOT NULL,
  invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC(12,2) NOT NULL,
  invoice_scope VARCHAR(20) NOT NULL DEFAULT 'partial',
  comments TEXT,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (invoice_scope IN ('full', 'partial'))
);

COMMENT ON TABLE quote_invoices IS 'Invoice history for quote versions.';

CREATE INDEX IF NOT EXISTS idx_quote_invoices_quote_id ON quote_invoices(quote_id, invoice_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quote_invoices_number ON quote_invoices(invoice_number);

CREATE TABLE IF NOT EXISTS quote_invoice_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_invoice_id UUID NOT NULL REFERENCES quote_invoices(id) ON DELETE CASCADE,
  quote_line_item_id UUID REFERENCES quote_line_items(id) ON DELETE SET NULL,
  quantity_invoiced NUMERIC(12,2),
  amount_invoiced NUMERIC(12,2) NOT NULL,
  comments TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE quote_invoice_allocations IS 'Optional line-item allocations for partial quote invoicing.';

CREATE INDEX IF NOT EXISTS idx_quote_invoice_allocations_invoice_id ON quote_invoice_allocations(quote_invoice_id);

CREATE OR REPLACE FUNCTION update_quote_manager_series_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS quote_manager_series_updated_at_trigger ON quote_manager_series;
CREATE TRIGGER quote_manager_series_updated_at_trigger
BEFORE UPDATE ON quote_manager_series
FOR EACH ROW EXECUTE FUNCTION update_quote_manager_series_updated_at();

CREATE OR REPLACE FUNCTION update_quote_invoices_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS quote_invoices_updated_at_trigger ON quote_invoices;
CREATE TRIGGER quote_invoices_updated_at_trigger
BEFORE UPDATE ON quote_invoices
FOR EACH ROW EXECUTE FUNCTION update_quote_invoices_updated_at();

ALTER TABLE quote_manager_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_invoice_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quote_manager_series_select ON quote_manager_series;
CREATE POLICY quote_manager_series_select ON quote_manager_series
  FOR SELECT USING (effective_is_manager_admin());

DROP POLICY IF EXISTS quote_manager_series_insert ON quote_manager_series;
CREATE POLICY quote_manager_series_insert ON quote_manager_series
  FOR INSERT WITH CHECK (effective_is_manager_admin());

DROP POLICY IF EXISTS quote_manager_series_update ON quote_manager_series;
CREATE POLICY quote_manager_series_update ON quote_manager_series
  FOR UPDATE USING (effective_is_manager_admin())
  WITH CHECK (effective_is_manager_admin());

DROP POLICY IF EXISTS quote_attachments_select ON quote_attachments;
CREATE POLICY quote_attachments_select ON quote_attachments
  FOR SELECT USING (effective_is_manager_admin());

DROP POLICY IF EXISTS quote_attachments_insert ON quote_attachments;
CREATE POLICY quote_attachments_insert ON quote_attachments
  FOR INSERT WITH CHECK (effective_is_manager_admin());

DROP POLICY IF EXISTS quote_attachments_delete ON quote_attachments;
CREATE POLICY quote_attachments_delete ON quote_attachments
  FOR DELETE USING (effective_is_manager_admin());

DROP POLICY IF EXISTS quote_invoices_select ON quote_invoices;
CREATE POLICY quote_invoices_select ON quote_invoices
  FOR SELECT USING (effective_is_manager_admin());

DROP POLICY IF EXISTS quote_invoices_insert ON quote_invoices;
CREATE POLICY quote_invoices_insert ON quote_invoices
  FOR INSERT WITH CHECK (effective_is_manager_admin());

DROP POLICY IF EXISTS quote_invoices_update ON quote_invoices;
CREATE POLICY quote_invoices_update ON quote_invoices
  FOR UPDATE USING (effective_is_manager_admin())
  WITH CHECK (effective_is_manager_admin());

DROP POLICY IF EXISTS quote_invoice_allocations_select ON quote_invoice_allocations;
CREATE POLICY quote_invoice_allocations_select ON quote_invoice_allocations
  FOR SELECT USING (effective_is_manager_admin());

DROP POLICY IF EXISTS quote_invoice_allocations_insert ON quote_invoice_allocations;
CREATE POLICY quote_invoice_allocations_insert ON quote_invoice_allocations
  FOR INSERT WITH CHECK (effective_is_manager_admin());

COMMIT;
