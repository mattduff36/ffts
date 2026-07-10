BEGIN;

WITH live_draft_actions AS (
  SELECT
    ra.id AS action_id,
    vi.id AS draft_id
  FROM public.reminder_actions ra
  JOIN public.van_inspections vi
    ON ra.dedupe_key = 'van_draft_submission:' || vi.id::text
  WHERE ra.workflow_key = 'van_draft_submission'
    AND ra.status = 'open'
    AND vi.status = 'draft'
    AND vi.submitted_at IS NULL
    AND vi.signed_at IS NULL
    AND vi.signature_data IS NULL
),
normalised_live_actions AS (
  UPDATE public.reminder_actions ra
  SET
    metadata = jsonb_set(
      jsonb_set(
        COALESCE(ra.metadata, '{}'::jsonb),
        '{draft_inspection_id}',
        to_jsonb(live_draft_actions.draft_id::text),
        true
      ),
      '{draft_href}',
      to_jsonb('/van-inspections/new?id=' || live_draft_actions.draft_id::text),
      true
    ),
    updated_at = NOW()
  FROM live_draft_actions
  WHERE ra.id = live_draft_actions.action_id
    AND (
      ra.metadata->>'draft_inspection_id' IS DISTINCT FROM live_draft_actions.draft_id::text
      OR ra.metadata->>'draft_href' IS DISTINCT FROM '/van-inspections/new?id=' || live_draft_actions.draft_id::text
    )
  RETURNING ra.id
),
stale_draft_actions AS MATERIALIZED (
  SELECT ra.id
  FROM public.reminder_actions ra
  LEFT JOIN public.van_inspections vi
    ON vi.id::text = ra.metadata->>'draft_inspection_id'
  WHERE ra.workflow_key = 'van_draft_submission'
    AND ra.status = 'open'
    AND (
      vi.id IS NULL
      OR vi.status <> 'draft'
      OR vi.submitted_at IS NOT NULL
      OR vi.signed_at IS NOT NULL
      OR vi.signature_data IS NOT NULL
    )
),
cancelled_stale_reminders AS (
  UPDATE public.reminders r
  SET
    status = 'cancelled',
    action_note = COALESCE(NULLIF(r.action_note, ''), 'Draft van daily check no longer needs submission.'),
    cancelled_at = NOW(),
    updated_at = NOW()
  FROM stale_draft_actions
  WHERE r.action_id = stale_draft_actions.id
    AND r.status = 'pending'
  RETURNING r.action_id
)
UPDATE public.reminder_actions ra
SET
  status = 'cancelled',
  updated_at = NOW()
FROM stale_draft_actions
WHERE ra.id = stale_draft_actions.id;

WITH draft_candidates AS MATERIALIZED (
  SELECT
    vi.id,
    vi.user_id,
    vi.van_id,
    vi.inspection_date::date AS inspection_date,
    COALESCE(NULLIF(v.reg_number, ''), 'Unknown van') AS reg_number,
    NULLIF(v.nickname, '') AS nickname,
    CASE
      WHEN LOWER(COALESCE(vc.name, v.vehicle_type, 'Truck')) = 'van' THEN 15
      ELSE 26
    END AS expected_item_count,
    COUNT(DISTINCT ii.item_number) FILTER (
      WHERE ii.day_of_week = EXTRACT(ISODOW FROM vi.inspection_date)::int
        AND ii.status IN ('ok', 'attention', 'defect', 'na')
    ) AS completed_item_count
  FROM public.van_inspections vi
  JOIN public.vans v ON v.id = vi.van_id
  LEFT JOIN public.van_categories vc ON vc.id = v.category_id
  LEFT JOIN public.inspection_items ii ON ii.inspection_id = vi.id
  WHERE vi.status = 'draft'
    AND vi.van_id IS NOT NULL
    AND vi.submitted_at IS NULL
    AND vi.signed_at IS NULL
    AND vi.signature_data IS NULL
  GROUP BY
    vi.id,
    vi.user_id,
    vi.van_id,
    vi.inspection_date,
    v.reg_number,
    v.nickname,
    vc.name,
    v.vehicle_type
),
draft_reminder_candidates AS MATERIALIZED (
  SELECT
    *,
    CASE
      WHEN nickname IS NULL THEN reg_number
      ELSE reg_number || ' (' || nickname || ')'
    END AS asset_label
  FROM draft_candidates
),
inserted_actions AS (
  INSERT INTO public.reminder_actions (
    workflow_key,
    source_type,
    dedupe_key,
    status,
    priority,
    title,
    description,
    asset_type,
    van_id,
    metadata
  )
  SELECT
    'van_draft_submission',
    'system_generated',
    'van_draft_submission:' || draft_reminder_candidates.id::text,
    'open',
    'high',
    'Finish draft van daily check for ' || draft_reminder_candidates.asset_label,
    'Please click here to submit draft inspection. The 7-day Van Daily Checks have been retired. Van Daily Checks are now to be done daily and submitted each day, to align them with the Plant and HGV Daily Checks.',
    'van',
    draft_reminder_candidates.van_id,
    jsonb_build_object(
      'workflow_kind', 'van_draft_submission',
      'draft_inspection_id', draft_reminder_candidates.id::text,
      'draft_href', '/van-inspections/new?id=' || draft_reminder_candidates.id::text,
      'asset_label', draft_reminder_candidates.asset_label,
      'asset_route', '/fleet/vans/' || draft_reminder_candidates.van_id::text || '/history',
      'inspection_date', draft_reminder_candidates.inspection_date::text,
      'expected_item_count', draft_reminder_candidates.expected_item_count,
      'completed_item_count', draft_reminder_candidates.completed_item_count,
      'reminder_message', 'Please click here to submit draft inspection. The 7-day Van Daily Checks have been retired. Van Daily Checks are now to be done daily and submitted each day, to align them with the Plant and HGV Daily Checks.'
    )
  FROM draft_reminder_candidates
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.reminder_actions existing
    WHERE existing.dedupe_key = 'van_draft_submission:' || draft_reminder_candidates.id::text
      AND existing.status = 'open'
  )
  RETURNING id, dedupe_key
),
open_actions AS MATERIALIZED (
  SELECT inserted_actions.id, inserted_actions.dedupe_key
  FROM inserted_actions
  UNION
  SELECT existing.id, existing.dedupe_key
  FROM public.reminder_actions existing
  JOIN draft_reminder_candidates
    ON existing.dedupe_key = 'van_draft_submission:' || draft_reminder_candidates.id::text
  WHERE existing.workflow_key = 'van_draft_submission'
    AND existing.status = 'open'
)
INSERT INTO public.reminders (
  action_id,
  assigned_to,
  assigned_by,
  status,
  action_note,
  actioned_at,
  actioned_by,
  cancelled_at
)
SELECT
  open_actions.id,
  draft_reminder_candidates.user_id,
  NULL,
  'pending',
  NULL,
  NULL,
  NULL,
  NULL
FROM open_actions
JOIN draft_reminder_candidates
  ON open_actions.dedupe_key = 'van_draft_submission:' || draft_reminder_candidates.id::text
ON CONFLICT (action_id, assigned_to) DO NOTHING;

COMMIT;
