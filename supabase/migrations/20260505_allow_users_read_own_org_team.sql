BEGIN;

DROP POLICY IF EXISTS "Users can read own org team" ON public.org_teams;

CREATE POLICY "Users can read own org team"
  ON public.org_teams
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.team_id = org_teams.id
    )
  );

COMMIT;
