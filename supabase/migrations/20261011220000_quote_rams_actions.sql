BEGIN;

CREATE TABLE IF NOT EXISTS public.quote_rams_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL UNIQUE REFERENCES public.quotes(id) ON DELETE CASCADE,
  assignee_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open',
  rams_document_id UUID REFERENCES public.rams_documents(id) ON DELETE SET NULL,
  requested_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  confirmation_note TEXT,
  email_status TEXT NOT NULL DEFAULT 'pending',
  email_error TEXT,
  email_claim_token UUID,
  email_claimed_at TIMESTAMPTZ,
  email_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT quote_rams_actions_status_check
    CHECK (status IN ('open', 'completed', 'cancelled')),
  CONSTRAINT quote_rams_actions_email_status_check
    CHECK (email_status IN ('pending', 'sending', 'sent', 'failed', 'uncertain'))
);

COMMENT ON TABLE public.quote_rams_actions IS
  'One RAMS action per quote. Browser writes are revoked; the server uses the pg owner connection.';

CREATE INDEX IF NOT EXISTS quote_rams_actions_assignee_status_idx
  ON public.quote_rams_actions (assignee_profile_id, status);

ALTER TABLE public.quote_rams_actions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.quote_rams_actions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.quote_rams_actions TO authenticated;
GRANT ALL ON TABLE public.quote_rams_actions TO service_role;

DROP POLICY IF EXISTS quote_rams_actions_select_assignee ON public.quote_rams_actions;
CREATE POLICY quote_rams_actions_select_assignee
  ON public.quote_rams_actions
  FOR SELECT
  TO authenticated
  USING (assignee_profile_id = auth.uid());

COMMIT;
