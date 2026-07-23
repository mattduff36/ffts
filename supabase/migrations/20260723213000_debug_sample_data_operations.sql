BEGIN;

CREATE TABLE IF NOT EXISTS public.sample_data_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_group_id UUID NOT NULL DEFAULT gen_random_uuid(),
  fixture_key TEXT NOT NULL CHECK (
    fixture_key IN (
      'scheduling-sample-v1',
      'fleet-inventory-sample-v1',
      'all-managed'
    )
  ),
  action TEXT NOT NULL CHECK (
    action IN (
      'create-base',
      'create-queue',
      'create-complete',
      'create',
      'remove',
      'clear-all'
    )
  ),
  outcome TEXT NOT NULL CHECK (
    outcome IN ('succeeded', 'failed', 'partial', 'noop')
  ),
  actor_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  preview_fingerprint TEXT,
  before_status JSONB NOT NULL DEFAULT '{}'::jsonb,
  after_status JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  recovery TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sample_data_operations_fixture_created
  ON public.sample_data_operations(fixture_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sample_data_operations_group
  ON public.sample_data_operations(operation_group_id, created_at);

ALTER TABLE public.sample_data_operations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sample_data_operations_deny_authenticated
  ON public.sample_data_operations;
CREATE POLICY sample_data_operations_deny_authenticated
  ON public.sample_data_operations
  FOR ALL
  TO authenticated
  USING (FALSE)
  WITH CHECK (FALSE);

REVOKE ALL ON public.sample_data_operations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.sample_data_operations TO service_role;

CREATE OR REPLACE FUNCTION public.prevent_sample_data_operation_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Sample-data operation records are immutable.';
END;
$$;

DROP TRIGGER IF EXISTS prevent_sample_data_operation_update
  ON public.sample_data_operations;
CREATE TRIGGER prevent_sample_data_operation_update
  BEFORE UPDATE OR DELETE ON public.sample_data_operations
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_sample_data_operation_mutation();

COMMENT ON TABLE public.sample_data_operations IS
  'Immutable actor-attributed audit records for guarded Debug Sample Data operations.';

COMMIT;
