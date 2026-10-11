BEGIN;

-- All browser access goes through the API's current module matrix and PIN gates.
-- An assignee-only SELECT policy would otherwise bypass a revoked module grant.
REVOKE ALL ON TABLE public.quote_rams_actions FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS quote_rams_actions_select_assignee ON public.quote_rams_actions;

COMMENT ON TABLE public.quote_rams_actions IS
  'One RAMS action per quote. Browser access is revoked; matrix-authorized server APIs use the pg owner connection.';

COMMIT;
