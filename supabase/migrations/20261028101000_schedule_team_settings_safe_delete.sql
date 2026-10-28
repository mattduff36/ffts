-- Preserve atomic team settings saves when safeupdate rejects unfiltered DELETE.
-- All valid leader slots are explicitly scoped; existing validation and grants remain unchanged.
BEGIN;

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
    OR p_visible_slot_count < 5
    OR p_visible_slot_count > 10 THEN
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
    IF v_slot IS NULL OR v_slot < 1 OR v_slot > 5 THEN
      RAISE EXCEPTION 'TEAM_SLOT_INVALID'
        USING ERRCODE = 'P0001';
    END IF;
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
  WHERE slot_index BETWEEN 1 AND 10;

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

COMMIT;
