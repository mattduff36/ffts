BEGIN;

INSERT INTO public.permission_modules (
  module_name,
  minimum_role_id,
  sort_order,
  requires_sensitive_pin
)
SELECT
  'debug',
  roles.id,
  999,
  TRUE
FROM public.roles
WHERE roles.name = 'admin'
ON CONFLICT (module_name) DO UPDATE
SET
  requires_sensitive_pin = TRUE,
  updated_at = NOW();

COMMIT;
