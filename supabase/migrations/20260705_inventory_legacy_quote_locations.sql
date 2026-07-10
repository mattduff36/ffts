BEGIN;

ALTER TABLE public.inventory_locations
  DROP CONSTRAINT IF EXISTS inventory_locations_source_type_check,
  ADD CONSTRAINT inventory_locations_source_type_check
    CHECK (source_type IS NULL OR source_type IN ('system', 'fleet', 'quote', 'project_number', 'legacy_quote', 'manual'));

WITH legacy_locations AS (
  SELECT *
  FROM (
    SELECT
      legacy.*,
      ROW_NUMBER() OVER (
        PARTITION BY LOWER(BTRIM(legacy.quote_reference))
        ORDER BY legacy.quote_date DESC NULLS LAST, legacy.source_row DESC
      ) AS row_number
    FROM public.legacy_quotes AS legacy
    WHERE legacy.quote_reference IS NOT NULL
      AND BTRIM(legacy.quote_reference) <> ''
  ) AS ranked
  WHERE ranked.row_number = 1
)
UPDATE public.inventory_locations AS location
SET name = 'Legacy Quote - ' || legacy.quote_reference ||
      CASE WHEN BTRIM(legacy.title) <> '' THEN ' - ' || BTRIM(legacy.title) ELSE '' END,
    description = NULLIF(CONCAT_WS(E'\n',
      NULLIF(BTRIM(legacy.customer_name), ''),
      CASE WHEN legacy.quote_date IS NOT NULL THEN 'Quote date: ' || legacy.quote_date::TEXT ELSE NULL END,
      NULLIF(BTRIM(legacy.quote_manager_name), '')
    ), ''),
    is_active = TRUE,
    location_type = 'site',
    source_type = 'legacy_quote',
    external_reference = UPPER(BTRIM(legacy.quote_reference)),
    sync_status = 'synced',
    source_synced_at = NOW(),
    updated_at = NOW()
FROM legacy_locations AS legacy
WHERE location.source_type = 'legacy_quote'
  AND location.source_id = legacy.id
  AND legacy.quote_reference IS NOT NULL
  AND BTRIM(legacy.quote_reference) <> '';

INSERT INTO public.inventory_locations (
  name,
  description,
  is_active,
  linked_van_id,
  linked_hgv_id,
  linked_plant_id,
  location_type,
  source_type,
  source_id,
  external_reference,
  sync_status,
  source_synced_at
)
SELECT
  'Legacy Quote - ' || legacy.quote_reference ||
    CASE WHEN BTRIM(legacy.title) <> '' THEN ' - ' || BTRIM(legacy.title) ELSE '' END AS name,
  NULLIF(CONCAT_WS(E'\n',
    NULLIF(BTRIM(legacy.customer_name), ''),
    CASE WHEN legacy.quote_date IS NOT NULL THEN 'Quote date: ' || legacy.quote_date::TEXT ELSE NULL END,
    NULLIF(BTRIM(legacy.quote_manager_name), '')
  ), '') AS description,
  TRUE,
  NULL,
  NULL,
  NULL,
  'site',
  'legacy_quote',
  legacy.id,
  UPPER(BTRIM(legacy.quote_reference)),
  'synced',
  NOW()
FROM (
  SELECT *
  FROM (
    SELECT
      legacy.*,
      ROW_NUMBER() OVER (
        PARTITION BY LOWER(BTRIM(legacy.quote_reference))
        ORDER BY legacy.quote_date DESC NULLS LAST, legacy.source_row DESC
      ) AS row_number
    FROM public.legacy_quotes AS legacy
    WHERE legacy.quote_reference IS NOT NULL
      AND BTRIM(legacy.quote_reference) <> ''
  ) AS ranked
  WHERE ranked.row_number = 1
) AS legacy
WHERE legacy.quote_reference IS NOT NULL
  AND BTRIM(legacy.quote_reference) <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM public.inventory_locations AS existing
    WHERE existing.location_type = 'site'
      AND existing.is_active = TRUE
      AND existing.external_reference IS NOT NULL
      AND LOWER(BTRIM(existing.external_reference)) = LOWER(BTRIM(legacy.quote_reference))
  );

COMMIT;
