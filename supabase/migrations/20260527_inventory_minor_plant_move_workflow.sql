BEGIN;

ALTER TABLE public.inventory_minor_plant_details
  ADD COLUMN IF NOT EXISTS serial_number TEXT;

CREATE INDEX IF NOT EXISTS inventory_minor_plant_details_serial_number_idx
  ON public.inventory_minor_plant_details (serial_number)
  WHERE serial_number IS NOT NULL;

COMMENT ON COLUMN public.inventory_minor_plant_details.serial_number
  IS 'Copied Fleet Plant serial number for Minor Plant inventory records';

COMMIT;
