BEGIN;

CREATE TABLE IF NOT EXISTS public.schedule_day_team_members (
  work_date DATE NOT NULL,
  slot_index SMALLINT NOT NULL,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  added_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT schedule_day_team_members_slot_check CHECK (slot_index BETWEEN 1 AND 3),
  CONSTRAINT schedule_day_team_members_pkey PRIMARY KEY (work_date, slot_index, profile_id),
  CONSTRAINT schedule_day_team_members_profile_date_unique UNIQUE (work_date, profile_id)
);

CREATE INDEX IF NOT EXISTS schedule_day_team_members_date_slot_idx
  ON public.schedule_day_team_members (work_date, slot_index);

ALTER TABLE public.schedule_day_team_members ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.schedule_day_team_members FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.schedule_day_team_members TO authenticated;
GRANT ALL ON TABLE public.schedule_day_team_members TO service_role;

DROP POLICY IF EXISTS schedule_day_team_members_select ON public.schedule_day_team_members;
CREATE POLICY schedule_day_team_members_select ON public.schedule_day_team_members
  FOR SELECT TO authenticated
  USING (public.effective_module_access_level('scheduling') >= 4);

CREATE OR REPLACE FUNCTION public.add_schedule_day_team_member_v1(
  p_work_date DATE,
  p_slot_index SMALLINT,
  p_profile_id UUID,
  p_actor_user_id UUID
)
RETURNS TABLE (
  work_date DATE,
  slot_index SMALLINT,
  profile_id UUID,
  added_by UUID,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_lock_key BIGINT;
  v_placeholder BOOLEAN;
  v_existing_slot SMALLINT;
  v_existing_added_by UUID;
  v_existing_created_at TIMESTAMPTZ;
  v_target_count INTEGER;
  v_row public.schedule_day_team_members%ROWTYPE;
BEGIN
  IF p_work_date IS NULL OR p_profile_id IS NULL THEN
    RAISE EXCEPTION 'TEAM_PROFILE_INVALID'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_slot_index IS NULL OR p_slot_index < 1 OR p_slot_index > 3 THEN
    RAISE EXCEPTION 'TEAM_SLOT_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  v_lock_key := hashtextextended('schedule-day-team:' || p_work_date::TEXT, 0);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT profiles.is_placeholder
  INTO v_placeholder
  FROM public.profiles AS profiles
  WHERE profiles.id = p_profile_id;
  IF NOT FOUND OR v_placeholder IS TRUE THEN
    RAISE EXCEPTION 'TEAM_PROFILE_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT
    members.slot_index,
    members.added_by,
    members.created_at
  INTO v_existing_slot, v_existing_added_by, v_existing_created_at
  FROM public.schedule_day_team_members AS members
  WHERE members.work_date = p_work_date
    AND members.profile_id = p_profile_id;

  IF v_existing_slot IS NOT NULL AND v_existing_slot = p_slot_index THEN
    work_date := p_work_date;
    slot_index := v_existing_slot;
    profile_id := p_profile_id;
    added_by := v_existing_added_by;
    created_at := v_existing_created_at;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_target_count
  FROM public.schedule_day_team_members AS members
  WHERE members.work_date = p_work_date
    AND members.slot_index = p_slot_index;

  IF v_target_count >= 6 THEN
    RAISE EXCEPTION 'TEAM_SLOT_FULL'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_existing_slot IS NOT NULL THEN
    UPDATE public.schedule_day_team_members AS members
    SET slot_index = p_slot_index
    WHERE members.work_date = p_work_date
      AND members.profile_id = p_profile_id
    RETURNING members.* INTO v_row;
    work_date := v_row.work_date;
    slot_index := v_row.slot_index;
    profile_id := v_row.profile_id;
    added_by := v_row.added_by;
    created_at := v_row.created_at;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.schedule_day_team_members (
    work_date,
    slot_index,
    profile_id,
    added_by
  )
  VALUES (
    p_work_date,
    p_slot_index,
    p_profile_id,
    p_actor_user_id
  )
  RETURNING * INTO v_row;
  work_date := v_row.work_date;
  slot_index := v_row.slot_index;
  profile_id := v_row.profile_id;
  added_by := v_row.added_by;
  created_at := v_row.created_at;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_schedule_day_team_member_v1(
  p_work_date DATE,
  p_slot_index SMALLINT,
  p_profile_id UUID,
  p_actor_user_id UUID
)
RETURNS TABLE (
  work_date DATE,
  slot_index SMALLINT,
  profile_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_lock_key BIGINT;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'TEAM_PROFILE_INVALID'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_work_date IS NULL OR p_profile_id IS NULL THEN
    RAISE EXCEPTION 'TEAM_PROFILE_INVALID'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_slot_index IS NULL OR p_slot_index < 1 OR p_slot_index > 3 THEN
    RAISE EXCEPTION 'TEAM_SLOT_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  v_lock_key := hashtextextended('schedule-day-team:' || p_work_date::TEXT, 0);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  RETURN QUERY
  DELETE FROM public.schedule_day_team_members AS members
  WHERE members.work_date = p_work_date
    AND members.slot_index = p_slot_index
    AND members.profile_id = p_profile_id
  RETURNING members.work_date, members.slot_index, members.profile_id;
END;
$$;

REVOKE ALL ON FUNCTION public.add_schedule_day_team_member_v1(DATE, SMALLINT, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_schedule_day_team_member_v1(DATE, SMALLINT, UUID, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION public.remove_schedule_day_team_member_v1(DATE, SMALLINT, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_schedule_day_team_member_v1(DATE, SMALLINT, UUID, UUID)
  TO service_role;

COMMENT ON TABLE public.schedule_day_team_members IS
  'Organisation-shared daily scheduling crews (three slots, max six employees). Independent of org_teams.';
COMMENT ON FUNCTION public.add_schedule_day_team_member_v1(DATE, SMALLINT, UUID, UUID) IS
  'Adds or moves an employee into a day-team slot under a per-date advisory lock.';
COMMENT ON FUNCTION public.remove_schedule_day_team_member_v1(DATE, SMALLINT, UUID, UUID) IS
  'Removes an employee from a day-team slot under the same per-date advisory lock.';

COMMIT;
