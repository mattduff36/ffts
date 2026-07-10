-- Make maintenance categories drive fleet table columns and custom category values.
-- Adds protected system metadata, generic per-asset values, and splits HGV service into
-- Engine Service and Full Service.

BEGIN;

ALTER TABLE public.maintenance_categories
ADD COLUMN IF NOT EXISTS field_key TEXT NULL,
ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS is_delete_protected BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.asset_maintenance_category_values (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  maintenance_category_id UUID NOT NULL REFERENCES public.maintenance_categories(id) ON DELETE CASCADE,
  van_id UUID NULL REFERENCES public.vans(id) ON DELETE CASCADE,
  hgv_id UUID NULL REFERENCES public.hgvs(id) ON DELETE CASCADE,
  plant_id UUID NULL REFERENCES public.plant(id) ON DELETE CASCADE,
  due_date DATE NULL,
  due_mileage INTEGER NULL,
  last_mileage INTEGER NULL,
  due_hours INTEGER NULL,
  last_hours INTEGER NULL,
  notes TEXT NULL,
  last_updated_by UUID NULL REFERENCES public.profiles(id),
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  asset_type TEXT GENERATED ALWAYS AS (
    CASE
      WHEN van_id IS NOT NULL THEN 'van'
      WHEN hgv_id IS NOT NULL THEN 'hgv'
      WHEN plant_id IS NOT NULL THEN 'plant'
      ELSE NULL
    END
  ) STORED,
  asset_id UUID GENERATED ALWAYS AS (COALESCE(van_id, hgv_id, plant_id)) STORED,
  CONSTRAINT asset_maintenance_category_values_one_asset CHECK (
    ((van_id IS NOT NULL)::INTEGER + (hgv_id IS NOT NULL)::INTEGER + (plant_id IS NOT NULL)::INTEGER) = 1
  ),
  CONSTRAINT asset_maintenance_category_values_has_value CHECK (
    due_date IS NOT NULL
    OR due_mileage IS NOT NULL
    OR last_mileage IS NOT NULL
    OR due_hours IS NOT NULL
    OR last_hours IS NOT NULL
    OR notes IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_maintenance_category_values_unique_asset
  ON public.asset_maintenance_category_values(maintenance_category_id, asset_type, asset_id);

CREATE INDEX IF NOT EXISTS idx_asset_maintenance_category_values_category
  ON public.asset_maintenance_category_values(maintenance_category_id);

CREATE INDEX IF NOT EXISTS idx_asset_maintenance_category_values_asset
  ON public.asset_maintenance_category_values(asset_type, asset_id);

DROP TRIGGER IF EXISTS update_asset_maintenance_category_values_updated_at
  ON public.asset_maintenance_category_values;

CREATE TRIGGER update_asset_maintenance_category_values_updated_at
  BEFORE UPDATE ON public.asset_maintenance_category_values
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.asset_maintenance_category_values ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users with permission manage asset maintenance category values"
  ON public.asset_maintenance_category_values;

CREATE POLICY "Users with permission manage asset maintenance category values"
  ON public.asset_maintenance_category_values FOR ALL
  USING (public.has_maintenance_permission())
  WITH CHECK (public.has_maintenance_permission());

UPDATE public.maintenance_categories
SET
  field_key = CASE LOWER(name)
    WHEN 'tax due date' THEN 'tax_due_date'
    WHEN 'mot due date' THEN 'mot_due_date'
    WHEN 'service due' THEN 'next_service_mileage'
    WHEN 'cambelt replacement' THEN 'cambelt_due_mileage'
    WHEN 'first aid kit expiry' THEN 'first_aid_kit_expiry'
    WHEN '6 weekly inspection due' THEN 'six_weekly_inspection_due_date'
    WHEN 'fire extinguisher due' THEN 'fire_extinguisher_due_date'
    WHEN 'taco calibration due' THEN 'taco_calibration_due_date'
    WHEN 'loler due' THEN 'loler_due_date'
    WHEN 'service due (hours)' THEN 'next_service_hours'
    ELSE field_key
  END,
  is_system = TRUE,
  is_delete_protected = TRUE
WHERE LOWER(name) IN (
  'tax due date',
  'mot due date',
  'service due',
  'cambelt replacement',
  'first aid kit expiry',
  '6 weekly inspection due',
  'fire extinguisher due',
  'taco calibration due',
  'loler due',
  'service due (hours)'
);

UPDATE public.maintenance_categories
SET applies_to = ARRAY['van']::TEXT[]
WHERE LOWER(name) = 'service due';

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
  reminder_email_enabled,
  field_key,
  is_system,
  is_delete_protected
)
SELECT *
FROM (
  VALUES
    ('Engine Service', 'HGV engine service interval', 'mileage', 25000, 'miles', NULL::INTEGER, 1000, NULL::INTEGER, ARRAY['hgv']::TEXT[], TRUE, 133, 'workshop', TRUE, FALSE, FALSE, NULL::TEXT, FALSE, FALSE),
    ('Full Service', 'HGV full service interval', 'mileage', 100000, 'miles', NULL::INTEGER, 5000, NULL::INTEGER, ARRAY['hgv']::TEXT[], TRUE, 134, 'workshop', TRUE, FALSE, FALSE, NULL::TEXT, FALSE, FALSE)
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
  reminder_email_enabled,
  field_key,
  is_system,
  is_delete_protected
)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.maintenance_categories existing
  WHERE LOWER(existing.name) = LOWER(seed.name)
);

UPDATE public.maintenance_categories
SET
  type = 'mileage',
  period_value = 25000,
  period_unit = 'miles',
  alert_threshold_miles = COALESCE(alert_threshold_miles, 1000),
  alert_threshold_days = NULL,
  alert_threshold_hours = NULL,
  applies_to = ARRAY['hgv']::TEXT[],
  is_active = TRUE,
  show_on_overview = TRUE,
  field_key = NULL,
  is_system = FALSE,
  is_delete_protected = FALSE
WHERE LOWER(name) = 'engine service';

UPDATE public.maintenance_categories
SET
  type = 'mileage',
  period_value = 100000,
  period_unit = 'miles',
  alert_threshold_miles = COALESCE(alert_threshold_miles, 5000),
  alert_threshold_days = NULL,
  alert_threshold_hours = NULL,
  applies_to = ARRAY['hgv']::TEXT[],
  is_active = TRUE,
  show_on_overview = TRUE,
  field_key = NULL,
  is_system = FALSE,
  is_delete_protected = FALSE
WHERE LOWER(name) = 'full service';

INSERT INTO public.asset_maintenance_category_values (
  maintenance_category_id,
  hgv_id,
  due_mileage,
  last_mileage,
  last_updated_by,
  last_updated_at
)
SELECT
  engine_service.id,
  vm.hgv_id,
  vm.next_service_mileage,
  vm.last_service_mileage,
  vm.last_updated_by,
  COALESCE(vm.last_updated_at, vm.updated_at, NOW())
FROM public.vehicle_maintenance vm
CROSS JOIN LATERAL (
  SELECT id
  FROM public.maintenance_categories
  WHERE LOWER(name) = 'engine service'
  LIMIT 1
) engine_service
WHERE vm.hgv_id IS NOT NULL
  AND (vm.next_service_mileage IS NOT NULL OR vm.last_service_mileage IS NOT NULL)
ON CONFLICT (maintenance_category_id, asset_type, asset_id)
DO UPDATE SET
  due_mileage = EXCLUDED.due_mileage,
  last_mileage = EXCLUDED.last_mileage,
  last_updated_by = EXCLUDED.last_updated_by,
  last_updated_at = EXCLUDED.last_updated_at,
  updated_at = NOW();

COMMIT;
