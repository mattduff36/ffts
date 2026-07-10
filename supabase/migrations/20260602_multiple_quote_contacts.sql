BEGIN;

CREATE TABLE IF NOT EXISTS public.customer_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  name VARCHAR(255),
  job_title VARCHAR(150),
  email VARCHAR(255),
  phone VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT customer_contacts_not_blank CHECK (
    NULLIF(BTRIM(COALESCE(name, '')), '') IS NOT NULL
    OR NULLIF(BTRIM(COALESCE(job_title, '')), '') IS NOT NULL
    OR NULLIF(BTRIM(COALESCE(email, '')), '') IS NOT NULL
    OR NULLIF(BTRIM(COALESCE(phone, '')), '') IS NOT NULL
  )
);

COMMENT ON TABLE public.customer_contacts IS 'Secondary customer contacts for the quoting module. Primary contacts remain on customers.';

CREATE TABLE IF NOT EXISTS public.quote_customer_contact_recipients (
  quote_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  customer_contact_id UUID NOT NULL REFERENCES public.customer_contacts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  PRIMARY KEY (quote_id, customer_contact_id)
);

COMMENT ON TABLE public.quote_customer_contact_recipients IS 'Saved secondary customer contacts selected as additional quote To recipients.';

CREATE INDEX IF NOT EXISTS idx_customer_contacts_customer_id
  ON public.customer_contacts(customer_id);

CREATE INDEX IF NOT EXISTS idx_customer_contacts_email
  ON public.customer_contacts(email)
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customer_contacts_name
  ON public.customer_contacts(name)
  WHERE name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_quote_customer_contact_recipients_quote_id
  ON public.quote_customer_contact_recipients(quote_id);

CREATE INDEX IF NOT EXISTS idx_quote_customer_contact_recipients_contact_id
  ON public.quote_customer_contact_recipients(customer_contact_id);

CREATE OR REPLACE FUNCTION public.update_customer_contacts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS customer_contacts_updated_at_trigger ON public.customer_contacts;
CREATE TRIGGER customer_contacts_updated_at_trigger
BEFORE UPDATE ON public.customer_contacts
FOR EACH ROW EXECUTE FUNCTION public.update_customer_contacts_updated_at();

ALTER TABLE public.customer_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_customer_contact_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_contacts_select ON public.customer_contacts;
CREATE POLICY customer_contacts_select ON public.customer_contacts
  FOR SELECT USING (effective_is_manager_admin());

DROP POLICY IF EXISTS customer_contacts_insert ON public.customer_contacts;
CREATE POLICY customer_contacts_insert ON public.customer_contacts
  FOR INSERT WITH CHECK (effective_is_manager_admin());

DROP POLICY IF EXISTS customer_contacts_update ON public.customer_contacts;
CREATE POLICY customer_contacts_update ON public.customer_contacts
  FOR UPDATE USING (effective_is_manager_admin())
  WITH CHECK (effective_is_manager_admin());

DROP POLICY IF EXISTS customer_contacts_delete ON public.customer_contacts;
CREATE POLICY customer_contacts_delete ON public.customer_contacts
  FOR DELETE USING (effective_is_manager_admin());

DROP POLICY IF EXISTS quote_customer_contact_recipients_select ON public.quote_customer_contact_recipients;
CREATE POLICY quote_customer_contact_recipients_select ON public.quote_customer_contact_recipients
  FOR SELECT USING (effective_is_manager_admin());

DROP POLICY IF EXISTS quote_customer_contact_recipients_insert ON public.quote_customer_contact_recipients;
CREATE POLICY quote_customer_contact_recipients_insert ON public.quote_customer_contact_recipients
  FOR INSERT WITH CHECK (effective_is_manager_admin());

DROP POLICY IF EXISTS quote_customer_contact_recipients_delete ON public.quote_customer_contact_recipients;
CREATE POLICY quote_customer_contact_recipients_delete ON public.quote_customer_contact_recipients
  FOR DELETE USING (effective_is_manager_admin());

COMMIT;
