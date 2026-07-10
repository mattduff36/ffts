-- Convert weekly van inspection containers to one row per inspection day.
-- Historical duplicate van/user/day targets are resolved deterministically:
-- keep one daily row, archive duplicate day data, and preserve the daily
-- uniqueness rule for future checks.

BEGIN;

SET LOCAL statement_timeout = 0;

CREATE TABLE IF NOT EXISTS public.van_inspection_daily_split_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  old_inspection_id UUID NOT NULL,
  original_day_of_week INTEGER NOT NULL CHECK (original_day_of_week BETWEEN 1 AND 7),
  new_inspection_id UUID NOT NULL,
  old_item_id UUID,
  new_item_id UUID,
  migrated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.van_inspection_daily_duplicate_archive (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  old_inspection_id UUID NOT NULL,
  original_day_of_week INTEGER NOT NULL CHECK (original_day_of_week BETWEEN 1 AND 7),
  target_date DATE NOT NULL,
  kept_inspection_id UUID NOT NULL,
  inspection_snapshot JSONB NOT NULL,
  items_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  photos_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  actions_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  archived_reason TEXT NOT NULL DEFAULT 'duplicate van/user/date during daily split',
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_van_daily_split_map_old_day
  ON public.van_inspection_daily_split_map(old_inspection_id, original_day_of_week);

CREATE INDEX IF NOT EXISTS idx_van_daily_split_map_new_inspection
  ON public.van_inspection_daily_split_map(new_inspection_id);

CREATE INDEX IF NOT EXISTS idx_van_daily_duplicate_archive_old_day
  ON public.van_inspection_daily_duplicate_archive(old_inspection_id, original_day_of_week);

DO $$
DECLARE
  rec RECORD;
  day_num INTEGER;
  active_days INTEGER[];
  kept_days INTEGER[];
  keep_day INTEGER;
  target_inspection_date DATE;
  target_inspection_id UUID;
  resolution RECORD;
  inspections_processed INTEGER := 0;
  inspections_created INTEGER := 0;
  duplicate_group_count INTEGER := 0;
  duplicate_days_archived INTEGER := 0;
  empty_weekly_count INTEGER := 0;
  relinked_action_count INTEGER := 0;
BEGIN
  WITH weekly AS (
    SELECT vi.id
    FROM public.van_inspections vi
    WHERE vi.inspection_end_date IS NOT NULL
      AND vi.inspection_end_date::date <> vi.inspection_date::date
  )
  SELECT COUNT(*) INTO empty_weekly_count
  FROM weekly w
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.inspection_items ii
    WHERE ii.inspection_id = w.id
      AND ii.day_of_week BETWEEN 1 AND 7
  );

  IF empty_weekly_count > 0 THEN
    RAISE EXCEPTION 'Cannot split % weekly van inspections because they have no day_of_week inspection items', empty_weekly_count;
  END IF;

  CREATE TEMP TABLE van_daily_target_resolution ON COMMIT DROP AS
  WITH weekly_targets AS (
    SELECT
      'weekly-target'::text AS source,
      vi.id AS candidate_inspection_id,
      vi.id AS old_inspection_id,
      vi.van_id,
      vi.user_id,
      (vi.inspection_date::date + (ii.day_of_week - 1))::date AS target_date,
      ii.day_of_week AS original_day_of_week,
      vi.status,
      vi.created_at,
      vi.updated_at,
      COUNT(ii.id) AS item_count
    FROM public.van_inspections vi
    JOIN public.inspection_items ii ON ii.inspection_id = vi.id
    WHERE vi.van_id IS NOT NULL
      AND vi.inspection_end_date IS NOT NULL
      AND vi.inspection_end_date::date <> vi.inspection_date::date
      AND ii.day_of_week BETWEEN 1 AND 7
    GROUP BY vi.id, vi.van_id, vi.user_id, target_date, ii.day_of_week, vi.status, vi.created_at, vi.updated_at
  ),
  existing_daily AS (
    SELECT
      'existing-daily'::text AS source,
      vi.id AS candidate_inspection_id,
      NULL::uuid AS old_inspection_id,
      vi.van_id,
      vi.user_id,
      vi.inspection_date::date AS target_date,
      NULL::integer AS original_day_of_week,
      vi.status,
      vi.created_at,
      vi.updated_at,
      NULL::bigint AS item_count
    FROM public.van_inspections vi
    WHERE vi.van_id IS NOT NULL
      AND (vi.inspection_end_date IS NULL OR vi.inspection_end_date::date = vi.inspection_date::date)
  ),
  combined AS (
    SELECT * FROM weekly_targets
    UNION ALL
    SELECT * FROM existing_daily
  ),
  ranked AS (
    SELECT
      combined.*,
      ROW_NUMBER() OVER (
        PARTITION BY van_id, user_id, target_date
        ORDER BY
          CASE source WHEN 'existing-daily' THEN 0 ELSE 1 END,
          CASE status WHEN 'submitted' THEN 0 ELSE 1 END,
          item_count DESC NULLS LAST,
          created_at ASC NULLS LAST,
          candidate_inspection_id,
          original_day_of_week NULLS LAST
      ) AS rank_in_target,
      COUNT(*) OVER (PARTITION BY van_id, user_id, target_date) AS target_count
    FROM combined
  )
  SELECT
    ranked.*,
    keeper.candidate_inspection_id AS kept_inspection_id,
    keeper.source AS kept_source,
    ranked.rank_in_target = 1 AS is_keeper
  FROM ranked
  JOIN ranked keeper
    ON keeper.van_id = ranked.van_id
   AND keeper.user_id = ranked.user_id
   AND keeper.target_date = ranked.target_date
   AND keeper.rank_in_target = 1;

  SELECT COUNT(*) INTO duplicate_group_count
  FROM (
    SELECT van_id, user_id, target_date
    FROM van_daily_target_resolution
    GROUP BY van_id, user_id, target_date
    HAVING MAX(target_count) > 1
  ) duplicates;

  IF duplicate_group_count > 0 THEN
    RAISE NOTICE 'Resolving % duplicate van/user/date target group(s) by archiving non-keeper days', duplicate_group_count;
  END IF;

  FOR rec IN
    SELECT
      id,
      van_id,
      user_id,
      inspection_date,
      inspection_end_date,
      status,
      submitted_at,
      reviewed_by,
      reviewed_at,
      created_at,
      updated_at,
      manager_comments,
      signature_data,
      signed_at,
      current_mileage,
      inspector_comments,
      plant_id,
      is_hired_plant,
      hired_plant_id_serial,
      hired_plant_description,
      hired_plant_hiring_company
    FROM public.van_inspections
    WHERE inspection_end_date IS NOT NULL
      AND inspection_end_date::date <> inspection_date::date
    ORDER BY
      inspection_date,
      CASE status WHEN 'submitted' THEN 0 ELSE 1 END,
      created_at,
      id
  LOOP
    SELECT ARRAY_AGG(original_day_of_week ORDER BY original_day_of_week)
    INTO active_days
    FROM van_daily_target_resolution
    WHERE source = 'weekly-target'
      AND old_inspection_id = rec.id;

    SELECT ARRAY_AGG(original_day_of_week ORDER BY original_day_of_week)
    INTO kept_days
    FROM van_daily_target_resolution
    WHERE source = 'weekly-target'
      AND old_inspection_id = rec.id
      AND is_keeper;

    keep_day := kept_days[1];
    inspections_processed := inspections_processed + 1;

    FOREACH day_num IN ARRAY active_days LOOP
      SELECT *
      INTO resolution
      FROM van_daily_target_resolution
      WHERE source = 'weekly-target'
        AND old_inspection_id = rec.id
        AND original_day_of_week = day_num;

      target_inspection_date := resolution.target_date;
      target_inspection_id := resolution.kept_inspection_id;

      IF NOT resolution.is_keeper THEN
        INSERT INTO public.van_inspection_daily_duplicate_archive (
          old_inspection_id,
          original_day_of_week,
          target_date,
          kept_inspection_id,
          inspection_snapshot,
          items_snapshot,
          photos_snapshot,
          actions_snapshot
        )
        SELECT
          rec.id,
          day_num,
          target_inspection_date,
          target_inspection_id,
          (SELECT to_jsonb(vi) FROM public.van_inspections vi WHERE vi.id = rec.id),
          COALESCE((
            SELECT jsonb_agg(to_jsonb(ii) ORDER BY ii.item_number)
            FROM public.inspection_items ii
            WHERE ii.inspection_id = rec.id
              AND ii.day_of_week = day_num
          ), '[]'::jsonb),
          COALESCE((
            SELECT jsonb_agg(to_jsonb(ip) ORDER BY ip.created_at, ip.id)
            FROM public.inspection_photos ip
            WHERE ip.inspection_id = rec.id
              AND ip.day_of_week = day_num
          ), '[]'::jsonb),
          COALESCE((
            SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at, a.id)
            FROM public.actions a
            JOIN public.inspection_items ii ON ii.id = a.inspection_item_id
            WHERE ii.inspection_id = rec.id
              AND ii.day_of_week = day_num
          ), '[]'::jsonb);

        INSERT INTO public.van_inspection_daily_split_map (
          old_inspection_id,
          original_day_of_week,
          new_inspection_id,
          old_item_id,
          new_item_id
        )
        SELECT
          rec.id,
          day_num,
          target_inspection_id,
          duplicate_item.id,
          kept_item.id
        FROM public.inspection_items duplicate_item
        LEFT JOIN public.inspection_items kept_item
          ON kept_item.inspection_id = target_inspection_id
         AND kept_item.item_number = duplicate_item.item_number
         AND kept_item.item_description = duplicate_item.item_description
         AND kept_item.day_of_week = day_num
        WHERE duplicate_item.inspection_id = rec.id
          AND duplicate_item.day_of_week = day_num;

        UPDATE public.actions a
        SET inspection_id = target_inspection_id,
            inspection_item_id = mapped.new_item_id,
            updated_at = NOW()
        FROM public.van_inspection_daily_split_map mapped
        WHERE mapped.old_inspection_id = rec.id
          AND mapped.original_day_of_week = day_num
          AND mapped.old_item_id = a.inspection_item_id
          AND mapped.new_item_id IS NOT NULL;

        IF array_length(active_days, 1) = 1 THEN
          UPDATE public.actions a
          SET inspection_id = target_inspection_id,
              updated_at = NOW()
          WHERE a.inspection_id = rec.id
            AND a.inspection_item_id IS NULL;
        END IF;

        DELETE FROM public.inspection_photos
        WHERE inspection_id = rec.id
          AND day_of_week = day_num;

        DELETE FROM public.inspection_items
        WHERE inspection_id = rec.id
          AND day_of_week = day_num;

        duplicate_days_archived := duplicate_days_archived + 1;
        RAISE NOTICE 'Archived duplicate van inspection % day % for %; kept %', rec.id, day_num, target_inspection_date, target_inspection_id;
        CONTINUE;
      END IF;

      IF day_num = keep_day THEN
        target_inspection_id := rec.id;
      ELSE
        INSERT INTO public.van_inspections (
          van_id,
          user_id,
          inspection_date,
          status,
          submitted_at,
          reviewed_by,
          reviewed_at,
          created_at,
          updated_at,
          manager_comments,
          inspection_end_date,
          signature_data,
          signed_at,
          current_mileage,
          inspector_comments,
          plant_id,
          is_hired_plant,
          hired_plant_id_serial,
          hired_plant_description,
          hired_plant_hiring_company
        ) VALUES (
          rec.van_id,
          rec.user_id,
          target_inspection_date,
          rec.status,
          rec.submitted_at,
          rec.reviewed_by,
          rec.reviewed_at,
          rec.created_at,
          rec.updated_at,
          rec.manager_comments,
          target_inspection_date,
          rec.signature_data,
          rec.signed_at,
          rec.current_mileage,
          rec.inspector_comments,
          rec.plant_id,
          rec.is_hired_plant,
          rec.hired_plant_id_serial,
          rec.hired_plant_description,
          rec.hired_plant_hiring_company
        )
        RETURNING id INTO target_inspection_id;

        inspections_created := inspections_created + 1;
      END IF;

      UPDATE public.inspection_items
      SET inspection_id = target_inspection_id
      WHERE inspection_id = rec.id
        AND day_of_week = day_num;

      UPDATE public.inspection_photos
      SET inspection_id = target_inspection_id
      WHERE inspection_id = rec.id
        AND day_of_week = day_num;

      INSERT INTO public.van_inspection_daily_split_map (
        old_inspection_id,
        original_day_of_week,
        new_inspection_id,
        old_item_id,
        new_item_id
      )
      SELECT
        rec.id,
        day_num,
        target_inspection_id,
        ii.id,
        ii.id
      FROM public.inspection_items ii
      WHERE ii.inspection_id = target_inspection_id
        AND ii.day_of_week = day_num;

      UPDATE public.actions a
      SET inspection_id = target_inspection_id,
          updated_at = NOW()
      WHERE a.inspection_item_id IN (
        SELECT ii.id
        FROM public.inspection_items ii
        WHERE ii.inspection_id = target_inspection_id
          AND ii.day_of_week = day_num
      );

      IF array_length(active_days, 1) = 1 THEN
        UPDATE public.actions a
        SET inspection_id = target_inspection_id,
            updated_at = NOW()
        WHERE a.inspection_id = rec.id
          AND a.inspection_item_id IS NULL;
      END IF;

      GET DIAGNOSTICS relinked_action_count = ROW_COUNT;
      RAISE NOTICE 'Van inspection % day % -> %, relinked % action(s)', rec.id, day_num, target_inspection_id, relinked_action_count;
    END LOOP;

    IF keep_day IS NULL THEN
      DELETE FROM public.van_inspections
      WHERE id = rec.id;
    ELSE
      UPDATE public.van_inspections
      SET inspection_date = rec.inspection_date::date + (keep_day - 1),
          inspection_end_date = rec.inspection_date::date + (keep_day - 1),
          updated_at = rec.updated_at
      WHERE id = rec.id;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.actions a
    JOIN public.van_inspection_daily_split_map m
      ON m.new_inspection_id = a.inspection_id
    WHERE a.id = '1579a56c-2baa-4168-a59e-3e921a78588c'::uuid
      AND m.old_inspection_id = 'e26747ef-1ef0-4fef-a6f9-4e6810f9d058'::uuid
      AND m.original_day_of_week = 2
      AND (a.inspection_item_id IS NULL OR m.new_item_id = a.inspection_item_id)
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.actions
    WHERE id = '1579a56c-2baa-4168-a59e-3e921a78588c'::uuid
  ) THEN
    RAISE NOTICE 'Target completed action verification passed or action not present in this environment.';
  ELSE
    RAISE EXCEPTION 'Target completed action was not relinked to the Tuesday daily van inspection/item';
  END IF;

  RAISE NOTICE 'Van daily split complete: % weekly inspections processed, % daily rows created, % duplicate day(s) archived',
    inspections_processed, inspections_created, duplicate_days_archived;
END $$;

ALTER TABLE public.van_inspections
  DROP CONSTRAINT IF EXISTS check_van_inspection_date_range;

ALTER TABLE public.van_inspections
  DROP CONSTRAINT IF EXISTS check_van_inspection_max_7_days;

ALTER TABLE public.van_inspections
  DROP CONSTRAINT IF EXISTS van_inspections_daily_date_check;

UPDATE public.van_inspections
SET inspection_end_date = inspection_date
WHERE inspection_end_date IS NULL;

ALTER TABLE public.van_inspections
  ADD CONSTRAINT van_inspections_daily_date_check
  CHECK (inspection_end_date = inspection_date);

CREATE TABLE IF NOT EXISTS public.inspection_orphan_children_archive (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_table TEXT NOT NULL CHECK (child_table IN ('inspection_items', 'inspection_photos')),
  child_id UUID NOT NULL,
  inspection_id UUID NOT NULL,
  row_snapshot JSONB NOT NULL,
  archived_reason TEXT NOT NULL DEFAULT 'orphaned inspection child without parent inspection',
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (child_table, child_id)
);

WITH orphan_items AS (
  SELECT ii.*
  FROM public.inspection_items ii
  LEFT JOIN public.van_inspections vi ON vi.id = ii.inspection_id
  LEFT JOIN public.plant_inspections pi ON pi.id = ii.inspection_id
  LEFT JOIN public.hgv_inspections hi ON hi.id = ii.inspection_id
  WHERE vi.id IS NULL
    AND pi.id IS NULL
    AND hi.id IS NULL
)
INSERT INTO public.inspection_orphan_children_archive (
  child_table,
  child_id,
  inspection_id,
  row_snapshot
)
SELECT
  'inspection_items',
  orphan_items.id,
  orphan_items.inspection_id,
  to_jsonb(orphan_items)
FROM orphan_items
ON CONFLICT (child_table, child_id) DO NOTHING;

WITH orphan_photos AS (
  SELECT ip.*
  FROM public.inspection_photos ip
  LEFT JOIN public.van_inspections vi ON vi.id = ip.inspection_id
  LEFT JOIN public.plant_inspections pi ON pi.id = ip.inspection_id
  LEFT JOIN public.hgv_inspections hi ON hi.id = ip.inspection_id
  WHERE vi.id IS NULL
    AND pi.id IS NULL
    AND hi.id IS NULL
)
INSERT INTO public.inspection_orphan_children_archive (
  child_table,
  child_id,
  inspection_id,
  row_snapshot
)
SELECT
  'inspection_photos',
  orphan_photos.id,
  orphan_photos.inspection_id,
  to_jsonb(orphan_photos)
FROM orphan_photos
ON CONFLICT (child_table, child_id) DO NOTHING;

WITH orphan_photos AS (
  SELECT ip.id
  FROM public.inspection_photos ip
  LEFT JOIN public.van_inspections vi ON vi.id = ip.inspection_id
  LEFT JOIN public.plant_inspections pi ON pi.id = ip.inspection_id
  LEFT JOIN public.hgv_inspections hi ON hi.id = ip.inspection_id
  WHERE vi.id IS NULL
    AND pi.id IS NULL
    AND hi.id IS NULL
)
DELETE FROM public.inspection_photos ip
USING orphan_photos
WHERE ip.id = orphan_photos.id;

WITH orphan_items AS (
  SELECT ii.id
  FROM public.inspection_items ii
  LEFT JOIN public.van_inspections vi ON vi.id = ii.inspection_id
  LEFT JOIN public.plant_inspections pi ON pi.id = ii.inspection_id
  LEFT JOIN public.hgv_inspections hi ON hi.id = ii.inspection_id
  WHERE vi.id IS NULL
    AND pi.id IS NULL
    AND hi.id IS NULL
)
DELETE FROM public.inspection_items ii
USING orphan_items
WHERE ii.id = orphan_items.id;

DO $$
DECLARE
  duplicate_count INTEGER := 0;
BEGIN
  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT van_id, user_id, inspection_date
    FROM public.van_inspections
    WHERE van_id IS NOT NULL
    GROUP BY van_id, user_id, inspection_date
    HAVING COUNT(*) > 1
  ) duplicates;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION 'Cannot enforce unique daily van inspections: % van/user/date duplicate groups exist', duplicate_count;
  END IF;
END $$;

DROP INDEX IF EXISTS public.idx_unique_van_inspection_user_date;

CREATE UNIQUE INDEX idx_unique_van_inspection_user_date
  ON public.van_inspections(van_id, user_id, inspection_date)
  WHERE van_id IS NOT NULL;

COMMIT;
