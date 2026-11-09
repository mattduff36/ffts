-- Enable the existing Postgres Changes subscriptions used by FFTS.
-- These tables already have RLS and authenticated SELECT access. Realtime
-- checks RLS for INSERT and UPDATE. DELETE events can expose primary keys
-- without applying row policies.

DO $migration$
DECLARE
  target_table text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    RAISE EXCEPTION 'Required publication supabase_realtime does not exist';
  END IF;

  FOREACH target_table IN ARRAY ARRAY[
    'timesheets',
    'van_inspections',
    'plant_inspections',
    'absences',
    'message_recipients'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = target_table
    ) THEN
      EXECUTE format(
        'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
        target_table
      );
    END IF;
  END LOOP;
END
$migration$;
