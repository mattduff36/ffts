ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS super_admin BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.profiles
SET super_admin = TRUE
WHERE role_id IN (
  SELECT id
  FROM public.roles
  WHERE is_super_admin = TRUE
);
