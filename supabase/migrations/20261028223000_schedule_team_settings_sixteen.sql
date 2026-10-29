-- Widen scheduling buckets to 8..16 and store optional slot names.
-- Additive and backward compatible: old migrations are unchanged.
-- save_schedule_team_settings_v1 keeps its signature, extends bounds, and does not
-- overwrite names. Its leader DELETE keeps an explicit slot predicate for safeupdate.
-- save_schedule_team_settings_v2 calls v1 and then writes validated names in the same
-- transaction and settings lock. NULL p_names preserves stored names.
-- Not applied by this change.
BEGIN;

ALTER TABLE public.schedule_team_settings
  ADD COLUMN IF NOT EXISTS names JSONB NOT NULL DEFAULT '{}'::JSONB;

ALTER TABLE public.schedule_team_settings
  DROP CONSTRAINT IF EXISTS schedule_team_settings_names_object_check;

ALTER TABLE public.schedule_team_settings
  ADD CONSTRAINT schedule_team_settings_names_object_check
  CHECK (jsonb_typeof(names) = 'object');

UPDATE public.schedule_team_settings
SET visible_slot_count = 8
WHERE id = TRUE
  AND visible_slot_count < 8;

DO $$
DECLARE
  v_constraint TEXT;
BEGIN
  FOR v_constraint IN
    SELECT con.conname
    FROM pg_constraint AS con
    INNER JOIN pg_class AS rel ON rel.oid = con.conrelid
    INNER JOIN pg_namespace AS nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'schedule_team_settings'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%visible_slot_count%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.schedule_team_settings DROP CONSTRAINT %I',
      v_constraint
    );
  END LOOP;
END $$;

ALTER TABLE public.schedule_team_settings
  ALTER COLUMN visible_slot_count SET DEFAULT 8;

ALTER TABLE public.schedule_team_settings
  ADD CONSTRAINT schedule_team_settings_visible_slot_count_check
  CHECK (visible_slot_count BETWEEN 8 AND 16);

ALTER TABLE public.schedule_day_team_members
  DROP CONSTRAINT IF EXISTS schedule_day_team_members_slot_check;

ALTER TABLE public.schedule_day_team_members
  ADD CONSTRAINT schedule_day_team_members_slot_check
  CHECK (slot_index BETWEEN 1 AND 16);

DO $$
DECLARE
  v_constraint TEXT;
BEGIN
  FOR v_constraint IN
    SELECT con.conname
    FROM pg_constraint AS con
    INNER JOIN pg_class AS rel ON rel.oid = con.conrelid
    INNER JOIN pg_namespace AS nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'schedule_team_slot_leaders'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%slot_index%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.schedule_team_slot_leaders DROP CONSTRAINT %I',
      v_constraint
    );
  END LOOP;
END $$;

ALTER TABLE public.schedule_team_slot_leaders
  ADD CONSTRAINT schedule_team_slot_leaders_slot_index_check
  CHECK (slot_index BETWEEN 1 AND 16);

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
  v_settings_lock BIGINT;
  v_lock_key BIGINT;
  v_placeholder BOOLEAN;
  v_existing_slot SMALLINT;
  v_existing_added_by UUID;
  v_existing_created_at TIMESTAMPTZ;
  v_target_count INTEGER;
  v_visible SMALLINT;
  v_leader_slot SMALLINT;
  v_slot_has_leader BOOLEAN;
  v_effective_count INTEGER;
  v_row public.schedule_day_team_members%ROWTYPE;
BEGIN
  IF p_work_date IS NULL OR p_profile_id IS NULL THEN
    RAISE EXCEPTION 'TEAM_PROFILE_INVALID'
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

  SELECT leaders.slot_index
  INTO v_leader_slot
  FROM public.schedule_team_slot_leaders AS leaders
  WHERE leaders.profile_id = p_profile_id;
  IF v_leader_slot IS NOT NULL THEN
    RAISE EXCEPTION 'TEAM_LEADER_LOCKED'
      USING ERRCODE = 'P0001';
  END IF;

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

  SELECT EXISTS (
    SELECT 1
    FROM public.schedule_team_slot_leaders AS leaders
    WHERE leaders.slot_index = p_slot_index
  )
  INTO v_slot_has_leader;

  v_effective_count := v_target_count + CASE WHEN v_slot_has_leader THEN 1 ELSE 0 END;
  IF v_effective_count >= 6 THEN
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
  v_settings_lock BIGINT;
  v_lock_key BIGINT;
  v_leader_slot SMALLINT;
  v_visible SMALLINT;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'TEAM_PROFILE_INVALID'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_work_date IS NULL OR p_profile_id IS NULL THEN
    RAISE EXCEPTION 'TEAM_PROFILE_INVALID'
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

  SELECT leaders.slot_index
  INTO v_leader_slot
  FROM public.schedule_team_slot_leaders AS leaders
  WHERE leaders.profile_id = p_profile_id;
  IF v_leader_slot IS NOT NULL THEN
    RAISE EXCEPTION 'TEAM_LEADER_LOCKED'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  DELETE FROM public.schedule_day_team_members AS members
  WHERE members.work_date = p_work_date
    AND members.slot_index = p_slot_index
    AND members.profile_id = p_profile_id
  RETURNING members.work_date, members.slot_index, members.profile_id;
END;
$$;

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

CREATE OR REPLACE FUNCTION public.save_schedule_team_settings_v2(
  p_visible_slot_count SMALLINT,
  p_leaders JSONB,
  p_names JSONB,
  p_actor_user_id UUID
)
RETURNS TABLE (
  visible_slot_count SMALLINT,
  updated_by UUID,
  updated_at TIMESTAMPTZ,
  leaders JSONB,
  names JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_key TEXT;
  v_value JSONB;
  v_slot INTEGER;
  v_name TEXT;
  v_clean JSONB := '{}'::JSONB;
  v_replace_names BOOLEAN := FALSE;
  v_visible SMALLINT;
  v_updated_by UUID;
  v_updated_at TIMESTAMPTZ;
  v_leaders JSONB;
BEGIN
  IF p_names IS NULL THEN
    v_replace_names := FALSE;
  ELSIF jsonb_typeof(p_names) <> 'object' THEN
    RAISE EXCEPTION 'TEAM_SLOT_INVALID'
      USING ERRCODE = 'P0001';
  ELSE
    v_replace_names := TRUE;
    IF p_visible_slot_count IS NULL
      OR p_visible_slot_count < 8
      OR p_visible_slot_count > 16 THEN
      RAISE EXCEPTION 'TEAM_SLOT_INVALID'
        USING ERRCODE = 'P0001';
    END IF;

    FOR v_key, v_value IN
      SELECT entry.key, entry.value
      FROM jsonb_each(p_names) AS entry
    LOOP
      IF v_key !~ '^([1-9]|1[0-6])$' THEN
        RAISE EXCEPTION 'TEAM_SLOT_INVALID'
          USING ERRCODE = 'P0001';
      END IF;
      v_slot := v_key::INTEGER;
      IF v_slot > p_visible_slot_count THEN
        RAISE EXCEPTION 'TEAM_SLOT_INVALID'
          USING ERRCODE = 'P0001';
      END IF;
      IF jsonb_typeof(v_value) <> 'string' THEN
        RAISE EXCEPTION 'TEAM_SLOT_INVALID'
          USING ERRCODE = 'P0001';
      END IF;
      v_name := btrim(v_value #>> '{}');
      IF v_name = '' THEN
        CONTINUE;
      END IF;
      IF char_length(v_name) > 80 THEN
        RAISE EXCEPTION 'TEAM_SLOT_INVALID'
          USING ERRCODE = 'P0001';
      END IF;
      v_clean := v_clean || jsonb_build_object(v_key, v_name);
    END LOOP;
  END IF;

  SELECT
    saved.visible_slot_count,
    saved.updated_by,
    saved.updated_at,
    saved.leaders
  INTO v_visible, v_updated_by, v_updated_at, v_leaders
  FROM public.save_schedule_team_settings_v1(
    p_visible_slot_count,
    p_leaders,
    p_actor_user_id
  ) AS saved;

  IF v_replace_names THEN
    UPDATE public.schedule_team_settings AS settings
    SET names = v_clean
    WHERE settings.id = TRUE;
  ELSE
    SELECT settings.names
    INTO v_clean
    FROM public.schedule_team_settings AS settings
    WHERE settings.id = TRUE;
    v_clean := COALESCE(v_clean, '{}'::JSONB);
  END IF;

  visible_slot_count := v_visible;
  updated_by := v_updated_by;
  updated_at := v_updated_at;
  leaders := v_leaders;
  names := v_clean;
  RETURN NEXT;
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

REVOKE ALL ON FUNCTION public.save_schedule_team_settings_v1(SMALLINT, JSONB, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_schedule_team_settings_v1(SMALLINT, JSONB, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION public.save_schedule_team_settings_v2(SMALLINT, JSONB, JSONB, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_schedule_team_settings_v2(SMALLINT, JSONB, JSONB, UUID)
  TO service_role;

COMMENT ON COLUMN public.schedule_team_settings.names IS
  'Optional custom bucket names keyed by slot index text ("1".."16"). Empty object falls back to leader or member names.';
COMMENT ON TABLE public.schedule_day_team_members IS
  'Organisation-shared daily scheduling crews (up to sixteen slots, max six employees including a standing leader). Independent of org_teams.';
COMMENT ON TABLE public.schedule_team_slot_leaders IS
  'Standing scheduling team leaders for any visible slot from 1 to 16. Cascade deletes the leader row if the profile is removed.';
COMMENT ON FUNCTION public.add_schedule_day_team_member_v1(DATE, SMALLINT, UUID, UUID) IS
  'Adds or moves an employee into a visible day-team slot (1-16). Shared settings lock then exclusive per-date lock. Six-employee capacity and leader locks unchanged.';
COMMENT ON FUNCTION public.remove_schedule_day_team_member_v1(DATE, SMALLINT, UUID, UUID) IS
  'Removes a non-leader employee from a visible day-team slot (1-16). Shared settings lock then exclusive per-date lock.';
COMMENT ON FUNCTION public.save_schedule_team_settings_v1(SMALLINT, JSONB, UUID) IS
  'Atomically saves visible team count 8-16 and standing leaders on visible slots. Does not change custom names. Leader DELETE is explicitly predicated for safeupdate.';
COMMENT ON FUNCTION public.save_schedule_team_settings_v2(SMALLINT, JSONB, JSONB, UUID) IS
  'Calls save_schedule_team_settings_v1 and updates validated custom names in the same transaction and settings lock. NULL p_names preserves stored names. service_role only.';

COMMIT;
