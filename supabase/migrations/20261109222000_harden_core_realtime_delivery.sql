BEGIN;

-- Reconcile databases that still have the earlier UUID implementation.
CREATE OR REPLACE FUNCTION public.effective_is_workshop_team()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  effective_team text := public.effective_team_id();
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.org_teams
    WHERE id = effective_team
      AND lower(name) = 'workshop'
  );
END;
$function$;

-- Keep create and update notifications. Supabase does not apply row
-- visibility policies when delivering delete notifications.
ALTER PUBLICATION supabase_realtime SET (publish = 'insert, update, truncate');

COMMIT;
