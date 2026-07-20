BEGIN;

CREATE TABLE IF NOT EXISTS public.template_migration_runs (
  id BIGSERIAL PRIMARY KEY,
  migration_key TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.template_migration_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.template_migration_runs FROM anon, authenticated;

DROP POLICY IF EXISTS template_migration_runs_deny_client_access
  ON public.template_migration_runs;
CREATE POLICY template_migration_runs_deny_client_access
  ON public.template_migration_runs
  FOR ALL
  TO anon, authenticated
  USING (FALSE)
  WITH CHECK (FALSE);

COMMENT ON TABLE public.template_migration_runs IS
  'Internal migration audit ledger. Direct database migration tooling only; no client API access.';

COMMIT;
