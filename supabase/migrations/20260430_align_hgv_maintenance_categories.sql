-- Align HGV maintenance categories with the maintenance overview.
-- Keeps Service Due as the shared distance-based category; HGV UI displays KM.

BEGIN;

INSERT INTO public.maintenance_categories (
  name,
  description,
  type,
  period_value,
  period_unit,
  alert_threshold_days,
  alert_threshold_miles,
  alert_threshold_hours,
  applies_to,
  is_active,
  sort_order,
  responsibility,
  show_on_overview,
  reminder_in_app_enabled,
  reminder_email_enabled
)
SELECT *
FROM (
  VALUES
    ('Tax Due Date', 'Vehicle tax due date', 'date', 12, 'months', 30, NULL::INTEGER, NULL::INTEGER, ARRAY['van', 'hgv', 'plant']::TEXT[], TRUE, 10, 'office', TRUE, FALSE, FALSE),
    ('MOT Due Date', 'MOT expiry date', 'date', 12, 'months', 30, NULL::INTEGER, NULL::INTEGER, ARRAY['van', 'hgv']::TEXT[], TRUE, 20, 'office', TRUE, FALSE, FALSE),
    ('Service Due', 'Regular vehicle service interval', 'mileage', 10000, 'miles', NULL::INTEGER, 1000, NULL::INTEGER, ARRAY['van', 'hgv']::TEXT[], TRUE, 30, 'workshop', TRUE, FALSE, FALSE),
    ('First Aid Kit Expiry', 'First aid kit expiry date', 'date', 12, 'months', 30, NULL::INTEGER, NULL::INTEGER, ARRAY['van', 'hgv']::TEXT[], TRUE, 50, 'workshop', TRUE, FALSE, FALSE),
    ('6 Weekly Inspection Due', 'HGV six-weekly inspection due date', 'date', 6, 'weeks', 7, NULL::INTEGER, NULL::INTEGER, ARRAY['hgv']::TEXT[], TRUE, 130, 'workshop', TRUE, FALSE, FALSE),
    ('Fire Extinguisher Due', 'Fire extinguisher inspection/expiry due date', 'date', 12, 'months', 30, NULL::INTEGER, NULL::INTEGER, ARRAY['hgv']::TEXT[], TRUE, 131, 'workshop', TRUE, FALSE, FALSE),
    ('Taco Calibration Due', 'Tachograph calibration due date', 'date', 24, 'months', 60, NULL::INTEGER, NULL::INTEGER, ARRAY['hgv']::TEXT[], TRUE, 132, 'workshop', TRUE, FALSE, FALSE)
) AS seed(
  name,
  description,
  type,
  period_value,
  period_unit,
  alert_threshold_days,
  alert_threshold_miles,
  alert_threshold_hours,
  applies_to,
  is_active,
  sort_order,
  responsibility,
  show_on_overview,
  reminder_in_app_enabled,
  reminder_email_enabled
)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.maintenance_categories existing
  WHERE LOWER(existing.name) = LOWER(seed.name)
);

UPDATE public.maintenance_categories
SET
  applies_to = ARRAY(
    SELECT DISTINCT normalized_value
    FROM (
      SELECT CASE WHEN value = 'vehicle' THEN 'van' ELSE value END AS normalized_value
      FROM unnest(COALESCE(applies_to, ARRAY[]::TEXT[]) || ARRAY['hgv']) AS values(value)
    ) normalized
    WHERE normalized_value IN ('van', 'hgv', 'plant')
  ),
  is_active = TRUE,
  show_on_overview = TRUE
WHERE LOWER(name) IN (
  'tax due date',
  'mot due date',
  'service due',
  'first aid kit expiry'
);

UPDATE public.maintenance_categories
SET
  applies_to = ARRAY['van']::TEXT[],
  show_on_overview = TRUE
WHERE LOWER(name) = 'cambelt replacement';

UPDATE public.maintenance_categories
SET
  type = 'date',
  period_value = 6,
  period_unit = 'weeks',
  alert_threshold_days = COALESCE(alert_threshold_days, 7),
  alert_threshold_miles = NULL,
  alert_threshold_hours = NULL,
  applies_to = ARRAY['hgv']::TEXT[],
  is_active = TRUE,
  show_on_overview = TRUE,
  sort_order = COALESCE(sort_order, 130)
WHERE LOWER(name) = '6 weekly inspection due';

UPDATE public.maintenance_categories
SET
  type = 'date',
  period_value = COALESCE(period_value, 12),
  period_unit = 'months',
  alert_threshold_days = COALESCE(alert_threshold_days, 30),
  alert_threshold_miles = NULL,
  alert_threshold_hours = NULL,
  applies_to = ARRAY['hgv']::TEXT[],
  is_active = TRUE,
  show_on_overview = TRUE,
  sort_order = COALESCE(sort_order, 131)
WHERE LOWER(name) = 'fire extinguisher due';

UPDATE public.maintenance_categories
SET
  type = 'date',
  period_value = COALESCE(period_value, 24),
  period_unit = 'months',
  alert_threshold_days = COALESCE(alert_threshold_days, 60),
  alert_threshold_miles = NULL,
  alert_threshold_hours = NULL,
  applies_to = ARRAY['hgv']::TEXT[],
  is_active = TRUE,
  show_on_overview = TRUE,
  sort_order = COALESCE(sort_order, 132)
WHERE LOWER(name) = 'taco calibration due';

COMMIT;
