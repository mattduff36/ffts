BEGIN;

-- Follows 20261028223000_schedule_team_settings_sixteen.sql.
-- Additive plant membership for daily scheduling buckets. Employee membership
-- rules, including the six-person cap, are unchanged.

CREATE TABLE IF NOT EXISTS public.schedule_day_team_plants (
  work_date DATE NOT NULL,
  slot_index SMALLINT NOT NULL,
  plant_id UUID NOT NULL REFERENCES public.plant(id) ON DELETE CASCADE,
  added_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT schedule_day_team_plants_slot_check CHECK (slot_index BETWEEN 1 AND 16),
  CONSTRAINT schedule_day_team_plants_pkey PRIMARY KEY (work_date, slot_index, plant_id),
  CONSTRAINT schedule_day_team_plants_date_plant_unique UNIQUE (work_date, plant_id)
);

CREATE INDEX IF NOT EXISTS schedule_day_team_plants_date_slot_idx
  ON public.schedule_day_team_plants (work_date, slot_index);

ALTER TABLE public.schedule_day_team_plants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.schedule_day_team_plants FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.schedule_day_team_plants TO authenticated;
GRANT ALL ON TABLE public.schedule_day_team_plants TO service_role;

DROP POLICY IF EXISTS schedule_day_team_plants_select ON public.schedule_day_team_plants;
CREATE POLICY schedule_day_team_plants_select ON public.schedule_day_team_plants
  FOR SELECT TO authenticated
  USING (public.effective_module_access_level('scheduling') >= 4);

CREATE OR REPLACE FUNCTION public.add_schedule_day_team_plant_v1(
  p_work_date DATE,
  p_slot_index SMALLINT,
  p_plant_id UUID,
  p_actor_user_id UUID
)
RETURNS TABLE (
  work_date DATE,
  slot_index SMALLINT,
  plant_id UUID,
  added_by UUID,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_settings_lock BIGINT;
  v_lock_key BIGINT;
  v_status TEXT;
  v_existing_slot SMALLINT;
  v_existing_added_by UUID;
  v_existing_created_at TIMESTAMPTZ;
  v_visible SMALLINT;
  v_row public.schedule_day_team_plants%ROWTYPE;
BEGIN
  IF p_work_date IS NULL OR p_plant_id IS NULL THEN
    RAISE EXCEPTION 'TEAM_PLANT_INVALID'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_slot_index IS NULL OR p_slot_index < 1 OR p_slot_index > 16 THEN
    RAISE EXCEPTION 'TEAM_SLOT_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  -- ARCH-LOCK-001: shared global settings lock, then exclusive per-date lock.
  v_settings_lock := hashtextextended('schedule-team-settings', 0);
  PERFORM pg_advisory_xact_lock_shared(v_settings_lock);
  v_lock_key := hashtextextended('schedule-day-team:' || p_work_date::TEXT, 0);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT settings.visible_slot_count
  INTO v_visible
  FROM public.schedule_team_settings AS settings
  WHERE settings.id = TRUE;
  IF v_visible IS NULL THEN
    v_visible := 8;
  END IF;
  IF p_slot_index > v_visible THEN
    RAISE EXCEPTION 'TEAM_SLOT_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT plant.status
  INTO v_status
  FROM public.plant AS plant
  WHERE plant.id = p_plant_id;
  IF NOT FOUND OR v_status = 'retired' THEN
    RAISE EXCEPTION 'TEAM_PLANT_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT
    plants.slot_index,
    plants.added_by,
    plants.created_at
  INTO v_existing_slot, v_existing_added_by, v_existing_created_at
  FROM public.schedule_day_team_plants AS plants
  WHERE plants.work_date = p_work_date
    AND plants.plant_id = p_plant_id;

  IF v_existing_slot IS NOT NULL AND v_existing_slot = p_slot_index THEN
    work_date := p_work_date;
    slot_index := v_existing_slot;
    plant_id := p_plant_id;
    added_by := v_existing_added_by;
    created_at := v_existing_created_at;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_existing_slot IS NOT NULL THEN
    UPDATE public.schedule_day_team_plants AS plants
    SET slot_index = p_slot_index
    WHERE plants.work_date = p_work_date
      AND plants.plant_id = p_plant_id
    RETURNING plants.* INTO v_row;
    work_date := v_row.work_date;
    slot_index := v_row.slot_index;
    plant_id := v_row.plant_id;
    added_by := v_row.added_by;
    created_at := v_row.created_at;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.schedule_day_team_plants (
    work_date,
    slot_index,
    plant_id,
    added_by
  )
  VALUES (
    p_work_date,
    p_slot_index,
    p_plant_id,
    p_actor_user_id
  )
  RETURNING * INTO v_row;
  work_date := v_row.work_date;
  slot_index := v_row.slot_index;
  plant_id := v_row.plant_id;
  added_by := v_row.added_by;
  created_at := v_row.created_at;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_schedule_day_team_plant_v1(
  p_work_date DATE,
  p_slot_index SMALLINT,
  p_plant_id UUID,
  p_actor_user_id UUID
)
RETURNS TABLE (
  work_date DATE,
  slot_index SMALLINT,
  plant_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_settings_lock BIGINT;
  v_lock_key BIGINT;
  v_visible SMALLINT;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'TEAM_PLANT_INVALID'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_work_date IS NULL OR p_plant_id IS NULL THEN
    RAISE EXCEPTION 'TEAM_PLANT_INVALID'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_slot_index IS NULL OR p_slot_index < 1 OR p_slot_index > 16 THEN
    RAISE EXCEPTION 'TEAM_SLOT_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  -- ARCH-LOCK-001: shared global settings lock, then exclusive per-date lock.
  v_settings_lock := hashtextextended('schedule-team-settings', 0);
  PERFORM pg_advisory_xact_lock_shared(v_settings_lock);
  v_lock_key := hashtextextended('schedule-day-team:' || p_work_date::TEXT, 0);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT settings.visible_slot_count
  INTO v_visible
  FROM public.schedule_team_settings AS settings
  WHERE settings.id = TRUE;
  IF v_visible IS NULL THEN
    v_visible := 8;
  END IF;
  IF p_slot_index > v_visible THEN
    RAISE EXCEPTION 'TEAM_SLOT_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  DELETE FROM public.schedule_day_team_plants AS plants
  WHERE plants.work_date = p_work_date
    AND plants.slot_index = p_slot_index
    AND plants.plant_id = p_plant_id
  RETURNING plants.work_date, plants.slot_index, plants.plant_id;
END;
$$;

-- Replaces save_schedule_team_settings_v1 from the sixteen-slot migration.
-- Employee occupancy, leader capacity, and the exclusive settings lock stay.
-- Plant occupancy is rejected before the settings row is updated.
CREATE OR REPLACE FUNCTION public.save_schedule_team_settings_v1(
  p_visible_slot_count SMALLINT,
  p_leaders JSONB,
  p_actor_user_id UUID
)
RETURNS TABLE (
  visible_slot_count SMALLINT,
  updated_by UUID,
  updated_at TIMESTAMPTZ,
  leaders JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_settings_lock BIGINT;
  v_leader JSONB;
  v_slot SMALLINT;
  v_profile UUID;
  v_seen UUID[] := ARRAY[]::UUID[];
  v_seen_slots SMALLINT[] := ARRAY[]::SMALLINT[];
  v_leader_slots SMALLINT[] := ARRAY[]::SMALLINT[];
  v_placeholder BOOLEAN;
  v_occupied INTEGER;
  v_row public.schedule_team_settings%ROWTYPE;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'TEAM_PROFILE_INVALID'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_visible_slot_count IS NULL
    OR p_visible_slot_count < 8
    OR p_visible_slot_count > 16 THEN
    RAISE EXCEPTION 'TEAM_SLOT_INVALID'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_leaders IS NULL OR jsonb_typeof(p_leaders) <> 'array' THEN
    RAISE EXCEPTION 'TEAM_PROFILE_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  -- ARCH-LOCK-001: exclusive global settings lock. No per-date lock needed.
  v_settings_lock := hashtextextended('schedule-team-settings', 0);
  PERFORM pg_advisory_xact_lock(v_settings_lock);

  IF EXISTS (
    SELECT 1
    FROM public.schedule_day_team_members AS members
    WHERE members.slot_index > p_visible_slot_count
  ) THEN
    RAISE EXCEPTION 'TEAM_SLOT_IN_USE'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.schedule_day_team_plants AS plants
    WHERE plants.slot_index > p_visible_slot_count
  ) THEN
    RAISE EXCEPTION 'TEAM_SLOT_IN_USE'
      USING ERRCODE = 'P0001';
  END IF;

  FOR v_leader IN
    SELECT value
    FROM jsonb_array_elements(p_leaders)
  LOOP
    v_slot := NULL;
    v_profile := NULL;
    BEGIN
      v_slot := (v_leader ->> 'slot_index')::SMALLINT;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'TEAM_SLOT_INVALID'
        USING ERRCODE = 'P0001';
    END;
    IF v_slot IS NULL OR v_slot < 1 OR v_slot > 16 OR v_slot > p_visible_slot_count THEN
      RAISE EXCEPTION 'TEAM_SLOT_INVALID'
        USING ERRCODE = 'P0001';
    END IF;
    IF v_slot = ANY (v_seen_slots) THEN
      RAISE EXCEPTION 'TEAM_SLOT_INVALID'
        USING ERRCODE = 'P0001';
    END IF;
    v_seen_slots := array_append(v_seen_slots, v_slot);
    IF v_leader ? 'profile_id'
      AND v_leader ->> 'profile_id' IS NOT NULL
      AND btrim(v_leader ->> 'profile_id') <> '' THEN
      BEGIN
        v_profile := (v_leader ->> 'profile_id')::UUID;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'TEAM_PROFILE_INVALID'
          USING ERRCODE = 'P0001';
      END;
    END IF;
    IF v_profile IS NULL THEN
      CONTINUE;
    END IF;
    IF v_profile = ANY (v_seen) THEN
      RAISE EXCEPTION 'TEAM_PROFILE_INVALID'
        USING ERRCODE = 'P0001';
    END IF;
    v_seen := array_append(v_seen, v_profile);
    v_leader_slots := array_append(v_leader_slots, v_slot);

    SELECT profiles.is_placeholder
    INTO v_placeholder
    FROM public.profiles AS profiles
    WHERE profiles.id = v_profile;
    IF NOT FOUND OR v_placeholder IS TRUE THEN
      RAISE EXCEPTION 'TEAM_PROFILE_INVALID'
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- A new standing leader on a slot that already has six daily members
  -- (and is not one of those members) would become seven effective people.
  IF cardinality(v_leader_slots) > 0 AND EXISTS (
    SELECT 1
    FROM public.schedule_day_team_members AS members
    WHERE members.slot_index = ANY (v_leader_slots)
      AND (
        cardinality(v_seen) = 0
        OR NOT (members.profile_id = ANY (v_seen))
      )
    GROUP BY members.work_date, members.slot_index
    HAVING COUNT(*) > 5
  ) THEN
    RAISE EXCEPTION 'TEAM_SLOT_FULL'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.schedule_team_settings (id, visible_slot_count, updated_by, updated_at)
  VALUES (TRUE, p_visible_slot_count, p_actor_user_id, NOW())
  ON CONFLICT (id) DO UPDATE
  SET
    visible_slot_count = EXCLUDED.visible_slot_count,
    updated_by = EXCLUDED.updated_by,
    updated_at = NOW()
  RETURNING * INTO v_row;

  DELETE FROM public.schedule_team_slot_leaders
  WHERE slot_index BETWEEN 1 AND 16;

  FOR v_leader IN
    SELECT value
    FROM jsonb_array_elements(p_leaders)
  LOOP
    v_slot := (v_leader ->> 'slot_index')::SMALLINT;
    v_profile := NULL;
    IF v_leader ? 'profile_id'
      AND v_leader ->> 'profile_id' IS NOT NULL
      AND btrim(v_leader ->> 'profile_id') <> '' THEN
      v_profile := (v_leader ->> 'profile_id')::UUID;
    END IF;
    IF v_profile IS NULL THEN
      CONTINUE;
    END IF;
    INSERT INTO public.schedule_team_slot_leaders (slot_index, profile_id)
    VALUES (v_slot, v_profile);
  END LOOP;

  IF cardinality(v_seen) > 0 THEN
    DELETE FROM public.schedule_day_team_members AS members
    WHERE members.profile_id = ANY (v_seen);
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_occupied
  FROM public.schedule_day_team_members AS members
  WHERE members.slot_index > v_row.visible_slot_count;
  IF v_occupied > 0 THEN
    RAISE EXCEPTION 'TEAM_SLOT_IN_USE'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_occupied
  FROM public.schedule_day_team_plants AS plants
  WHERE plants.slot_index > v_row.visible_slot_count;
  IF v_occupied > 0 THEN
    RAISE EXCEPTION 'TEAM_SLOT_IN_USE'
      USING ERRCODE = 'P0001';
  END IF;

  visible_slot_count := v_row.visible_slot_count;
  updated_by := v_row.updated_by;
  updated_at := v_row.updated_at;
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'slot_index', leaders.slot_index,
        'profile_id', leaders.profile_id
      )
      ORDER BY leaders.slot_index
    ),
    '[]'::JSONB
  )
  INTO leaders
  FROM public.schedule_team_slot_leaders AS leaders;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.add_schedule_day_team_plant_v1(DATE, SMALLINT, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_schedule_day_team_plant_v1(DATE, SMALLINT, UUID, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION public.remove_schedule_day_team_plant_v1(DATE, SMALLINT, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_schedule_day_team_plant_v1(DATE, SMALLINT, UUID, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION public.save_schedule_team_settings_v1(SMALLINT, JSONB, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_schedule_team_settings_v1(SMALLINT, JSONB, UUID)
  TO service_role;

COMMENT ON TABLE public.schedule_day_team_plants IS
  'Plant membership for organisation-shared daily scheduling buckets (slots 1-16). A plant is on at most one bucket per date. No employee six-person cap applies.';
COMMENT ON FUNCTION public.add_schedule_day_team_plant_v1(DATE, SMALLINT, UUID, UUID) IS
  'Adds or moves a non-retired plant into a visible day-team slot. Shared settings lock then exclusive per-date lock. service_role only.';
COMMENT ON FUNCTION public.remove_schedule_day_team_plant_v1(DATE, SMALLINT, UUID, UUID) IS
  'Removes a plant from a visible day-team slot. Shared settings lock then exclusive per-date lock. service_role only.';
COMMENT ON FUNCTION public.save_schedule_team_settings_v1(SMALLINT, JSONB, UUID) IS
  'Atomically saves visible team count 8-16 and standing leaders. Rejects the save before update when employee or plant membership occupies a bucket that would be hidden. Does not change custom names.';

COMMIT;
