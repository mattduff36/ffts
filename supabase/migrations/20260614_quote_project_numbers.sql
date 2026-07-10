BEGIN;

CREATE TABLE IF NOT EXISTS public.quote_project_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_reference VARCHAR(30) NOT NULL UNIQUE,
  manager_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  requester_initials VARCHAR(10) NOT NULL,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  linked_quote_id UUID REFERENCES public.quotes(id) ON DELETE SET NULL,
  linked_at TIMESTAMPTZ,
  converted_quote_id UUID REFERENCES public.quotes(id) ON DELETE SET NULL,
  converted_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT quote_project_numbers_status_check
    CHECK (status IN ('open', 'linked', 'converted', 'cancelled')),
  CONSTRAINT quote_project_numbers_reference_check
    CHECK (project_reference ~ '^[0-9]{5}-[A-Z]{2}$')
);

COMMENT ON TABLE public.quote_project_numbers IS
  'Reserved quote/job numbers for provisional project cost tracking before a formal customer quote exists.';

CREATE INDEX IF NOT EXISTS idx_quote_project_numbers_status
  ON public.quote_project_numbers(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_quote_project_numbers_manager
  ON public.quote_project_numbers(manager_profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_quote_project_numbers_linked_quote
  ON public.quote_project_numbers(linked_quote_id)
  WHERE linked_quote_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_quote_project_numbers_converted_quote
  ON public.quote_project_numbers(converted_quote_id)
  WHERE converted_quote_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.quote_project_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_number_id UUID NOT NULL REFERENCES public.quote_project_numbers(id) ON DELETE CASCADE,
  cost_date DATE NOT NULL DEFAULT CURRENT_DATE,
  category VARCHAR(30) NOT NULL DEFAULT 'other',
  supplier VARCHAR(255),
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  linked_quote_id UUID REFERENCES public.quotes(id) ON DELETE SET NULL,
  linked_quote_line_item_id UUID REFERENCES public.quote_line_items(id) ON DELETE SET NULL,
  linked_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT quote_project_costs_category_check
    CHECK (category IN ('materials', 'subcontractor', 'plant', 'labour', 'other')),
  CONSTRAINT quote_project_costs_amount_check
    CHECK (amount >= 0)
);

COMMENT ON TABLE public.quote_project_costs IS
  'Manual cost rows tracked against reserved project numbers before linking or conversion to quotes.';

CREATE INDEX IF NOT EXISTS idx_quote_project_costs_project
  ON public.quote_project_costs(project_number_id, cost_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_quote_project_costs_linked_quote
  ON public.quote_project_costs(linked_quote_id)
  WHERE linked_quote_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.update_quote_project_numbers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS quote_project_numbers_updated_at_trigger ON public.quote_project_numbers;
CREATE TRIGGER quote_project_numbers_updated_at_trigger
BEFORE UPDATE ON public.quote_project_numbers
FOR EACH ROW EXECUTE FUNCTION public.update_quote_project_numbers_updated_at();

CREATE OR REPLACE FUNCTION public.update_quote_project_costs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS quote_project_costs_updated_at_trigger ON public.quote_project_costs;
CREATE TRIGGER quote_project_costs_updated_at_trigger
BEFORE UPDATE ON public.quote_project_costs
FOR EACH ROW EXECUTE FUNCTION public.update_quote_project_costs_updated_at();

ALTER TABLE public.quote_project_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_project_costs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quote_project_numbers_select ON public.quote_project_numbers;
CREATE POLICY quote_project_numbers_select ON public.quote_project_numbers
  FOR SELECT USING (effective_is_manager_admin());

DROP POLICY IF EXISTS quote_project_numbers_insert ON public.quote_project_numbers;
CREATE POLICY quote_project_numbers_insert ON public.quote_project_numbers
  FOR INSERT WITH CHECK (effective_is_manager_admin());

DROP POLICY IF EXISTS quote_project_numbers_update ON public.quote_project_numbers;
CREATE POLICY quote_project_numbers_update ON public.quote_project_numbers
  FOR UPDATE USING (effective_is_manager_admin())
  WITH CHECK (effective_is_manager_admin());

DROP POLICY IF EXISTS quote_project_numbers_delete ON public.quote_project_numbers;
CREATE POLICY quote_project_numbers_delete ON public.quote_project_numbers
  FOR DELETE USING (effective_is_super_admin());

DROP POLICY IF EXISTS quote_project_costs_select ON public.quote_project_costs;
CREATE POLICY quote_project_costs_select ON public.quote_project_costs
  FOR SELECT USING (effective_is_manager_admin());

DROP POLICY IF EXISTS quote_project_costs_insert ON public.quote_project_costs;
CREATE POLICY quote_project_costs_insert ON public.quote_project_costs
  FOR INSERT WITH CHECK (effective_is_manager_admin());

DROP POLICY IF EXISTS quote_project_costs_update ON public.quote_project_costs;
CREATE POLICY quote_project_costs_update ON public.quote_project_costs
  FOR UPDATE USING (effective_is_manager_admin())
  WITH CHECK (effective_is_manager_admin());

DROP POLICY IF EXISTS quote_project_costs_delete ON public.quote_project_costs;
CREATE POLICY quote_project_costs_delete ON public.quote_project_costs
  FOR DELETE USING (effective_is_manager_admin());

COMMIT;
