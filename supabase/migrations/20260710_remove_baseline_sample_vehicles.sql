BEGIN;

DELETE FROM public.vans AS van
WHERE REPLACE(UPPER(van.reg_number), ' ', '') IN ('YX65ABC', 'YX65DEF', 'YX65GHI')
  AND NOT EXISTS (
    SELECT 1 FROM public.van_inspections AS inspection WHERE inspection.van_id = van.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.actions AS action WHERE action.van_id = van.id
  );

DELETE FROM public.hgvs AS hgv
WHERE REPLACE(UPPER(hgv.reg_number), ' ', '') IN ('YX65ABC', 'YX65DEF', 'YX65GHI')
  AND NOT EXISTS (
    SELECT 1 FROM public.hgv_inspections AS inspection WHERE inspection.hgv_id = hgv.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.actions AS action WHERE action.hgv_id = hgv.id
  );

DO $$
BEGIN
  IF to_regclass('public.vehicles') IS NOT NULL THEN
    EXECUTE $sql$
      DELETE FROM public.vehicles
      WHERE REPLACE(UPPER(reg_number), ' ', '') IN ('YX65ABC', 'YX65DEF', 'YX65GHI')
    $sql$;
  END IF;
END $$;

COMMIT;
