-- =============================================================================
-- Customers & Quotes Module Migration
-- =============================================================================
-- Part 1: customers table
-- Part 2: quote_sequences table (per-requester atomic numbering)
-- Part 3: quotes table
-- Part 4: quote_line_items table
-- Part 5: Indexes
-- Part 6: RLS policies
-- Part 7: Triggers
-- Part 8: Seed placeholder customers
-- =============================================================================

BEGIN;

-- =============================================================================
-- Part 1: Customers Table
-- =============================================================================

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  company_name VARCHAR(255) NOT NULL,
  short_name VARCHAR(100),

  -- Primary contact
  contact_name VARCHAR(255),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(50),
  contact_job_title VARCHAR(150),

  -- Address
  address_line_1 VARCHAR(255),
  address_line_2 VARCHAR(255),
  city VARCHAR(100),
  county VARCHAR(100),
  postcode VARCHAR(20),

  -- Billing / default terms
  payment_terms_days INTEGER DEFAULT 30,
  default_validity_days INTEGER DEFAULT 30,

  -- Status
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  notes TEXT,

  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id),
  updated_by UUID REFERENCES profiles(id)
);

COMMENT ON TABLE customers IS 'Customer directory for the quoting module.';

-- =============================================================================
-- Part 2: Quote Sequences Table
-- =============================================================================

CREATE TABLE IF NOT EXISTS quote_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_initials VARCHAR(10) NOT NULL UNIQUE,
  next_number INTEGER NOT NULL DEFAULT 6000,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE quote_sequences IS 'Per-requester atomic sequence counter for quote references (NNNN-XX).';

-- =============================================================================
-- Part 3: Quotes Table
-- =============================================================================

CREATE TABLE IF NOT EXISTS quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Reference
  quote_reference VARCHAR(20) NOT NULL UNIQUE,

  -- Relationships
  customer_id UUID NOT NULL REFERENCES customers(id),
  requester_id UUID REFERENCES profiles(id),
  requester_initials VARCHAR(10),

  -- Quote header
  quote_date DATE NOT NULL DEFAULT CURRENT_DATE,
  attention_name VARCHAR(255),
  attention_email VARCHAR(255),
  subject_line VARCHAR(500),
  project_description TEXT,
  salutation VARCHAR(100),
  validity_days INTEGER DEFAULT 30,

  -- Totals (denormalised for list view performance)
  subtotal NUMERIC(12,2) DEFAULT 0,
  total NUMERIC(12,2) DEFAULT 0,

  -- Workflow
  status VARCHAR(30) DEFAULT 'draft' CHECK (status IN (
    'draft',
    'pending_internal_approval',
    'sent',
    'won',
    'lost',
    'ready_to_invoice',
    'invoiced'
  )),

  -- Acceptance / invoicing
  accepted BOOLEAN DEFAULT FALSE,
  po_number VARCHAR(100),
  started BOOLEAN DEFAULT FALSE,
  invoice_number VARCHAR(100),
  invoice_notes TEXT,

  -- Sign-off
  signoff_name VARCHAR(255),
  signoff_title VARCHAR(255),
  custom_footer_text TEXT,

  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id),
  updated_by UUID REFERENCES profiles(id),
  sent_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  invoiced_at TIMESTAMPTZ
);

COMMENT ON TABLE quotes IS 'Formal customer quotations with line items and lifecycle tracking.';

-- =============================================================================
-- Part 4: Quote Line Items Table
-- =============================================================================

CREATE TABLE IF NOT EXISTS quote_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,

  description VARCHAR(500) NOT NULL,
  quantity NUMERIC(12,2) NOT NULL DEFAULT 1,
  unit VARCHAR(50),
  unit_rate NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE quote_line_items IS 'Individual priced items within a quote.';

-- =============================================================================
-- Part 5: Indexes
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_customers_company_name ON customers(company_name);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
CREATE INDEX IF NOT EXISTS idx_customers_created_at ON customers(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_quotes_quote_reference ON quotes(quote_reference);
CREATE INDEX IF NOT EXISTS idx_quotes_customer_id ON quotes(customer_id);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
CREATE INDEX IF NOT EXISTS idx_quotes_requester_id ON quotes(requester_id);
CREATE INDEX IF NOT EXISTS idx_quotes_created_at ON quotes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_invoice_number ON quotes(invoice_number) WHERE invoice_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_quote_line_items_quote_id ON quote_line_items(quote_id);
CREATE INDEX IF NOT EXISTS idx_quote_line_items_sort_order ON quote_line_items(quote_id, sort_order);

-- =============================================================================
-- Part 6: RLS Policies
-- =============================================================================

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_line_items ENABLE ROW LEVEL SECURITY;

-- Customers: managers/admins full access
DROP POLICY IF EXISTS "customers_select" ON customers;
CREATE POLICY "customers_select" ON customers
  FOR SELECT USING ( effective_is_manager_admin() );

DROP POLICY IF EXISTS "customers_insert" ON customers;
CREATE POLICY "customers_insert" ON customers
  FOR INSERT WITH CHECK ( effective_is_manager_admin() );

DROP POLICY IF EXISTS "customers_update" ON customers;
CREATE POLICY "customers_update" ON customers
  FOR UPDATE USING ( effective_is_manager_admin() )
  WITH CHECK ( effective_is_manager_admin() );

DROP POLICY IF EXISTS "customers_delete" ON customers;
CREATE POLICY "customers_delete" ON customers
  FOR DELETE USING ( effective_is_super_admin() );

-- Quote sequences: managers/admins full access
DROP POLICY IF EXISTS "quote_sequences_select" ON quote_sequences;
CREATE POLICY "quote_sequences_select" ON quote_sequences
  FOR SELECT USING ( effective_is_manager_admin() );

DROP POLICY IF EXISTS "quote_sequences_insert" ON quote_sequences;
CREATE POLICY "quote_sequences_insert" ON quote_sequences
  FOR INSERT WITH CHECK ( effective_is_manager_admin() );

DROP POLICY IF EXISTS "quote_sequences_update" ON quote_sequences;
CREATE POLICY "quote_sequences_update" ON quote_sequences
  FOR UPDATE USING ( effective_is_manager_admin() )
  WITH CHECK ( effective_is_manager_admin() );

-- Quotes: managers/admins full CRUD
DROP POLICY IF EXISTS "quotes_select" ON quotes;
CREATE POLICY "quotes_select" ON quotes
  FOR SELECT USING ( effective_is_manager_admin() );

DROP POLICY IF EXISTS "quotes_insert" ON quotes;
CREATE POLICY "quotes_insert" ON quotes
  FOR INSERT WITH CHECK ( effective_is_manager_admin() );

DROP POLICY IF EXISTS "quotes_update" ON quotes;
CREATE POLICY "quotes_update" ON quotes
  FOR UPDATE USING ( effective_is_manager_admin() )
  WITH CHECK ( effective_is_manager_admin() );

DROP POLICY IF EXISTS "quotes_delete" ON quotes;
CREATE POLICY "quotes_delete" ON quotes
  FOR DELETE USING ( effective_is_super_admin() );

-- Quote line items: managers/admins full CRUD
DROP POLICY IF EXISTS "quote_line_items_select" ON quote_line_items;
CREATE POLICY "quote_line_items_select" ON quote_line_items
  FOR SELECT USING ( effective_is_manager_admin() );

DROP POLICY IF EXISTS "quote_line_items_insert" ON quote_line_items;
CREATE POLICY "quote_line_items_insert" ON quote_line_items
  FOR INSERT WITH CHECK ( effective_is_manager_admin() );

DROP POLICY IF EXISTS "quote_line_items_update" ON quote_line_items;
CREATE POLICY "quote_line_items_update" ON quote_line_items
  FOR UPDATE USING ( effective_is_manager_admin() )
  WITH CHECK ( effective_is_manager_admin() );

DROP POLICY IF EXISTS "quote_line_items_delete" ON quote_line_items;
CREATE POLICY "quote_line_items_delete" ON quote_line_items
  FOR DELETE USING ( effective_is_manager_admin() );

-- =============================================================================
-- Part 7: Triggers (auto-update updated_at)
-- =============================================================================

CREATE OR REPLACE FUNCTION update_customers_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER customers_updated_at_trigger
BEFORE UPDATE ON customers
FOR EACH ROW EXECUTE FUNCTION update_customers_updated_at();

CREATE OR REPLACE FUNCTION update_quotes_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER quotes_updated_at_trigger
BEFORE UPDATE ON quotes
FOR EACH ROW EXECUTE FUNCTION update_quotes_updated_at();

CREATE OR REPLACE FUNCTION update_quote_line_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER quote_line_items_updated_at_trigger
BEFORE UPDATE ON quote_line_items
FOR EACH ROW EXECUTE FUNCTION update_quote_line_items_updated_at();

-- =============================================================================
-- Verification
-- =============================================================================

DO $$ BEGIN
  RAISE NOTICE 'Migration complete: customers, quotes, quote_line_items, quote_sequences tables created.';
  RAISE NOTICE 'RLS policies applied. No customer records were seeded.';
END $$;

COMMIT;
