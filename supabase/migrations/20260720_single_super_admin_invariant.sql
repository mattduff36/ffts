BEGIN;

DO $$
DECLARE
  owner_profile_id UUID;
  administrator_role_id UUID;
  super_admin_role_id UUID;
BEGIN
  SELECT profile.id
  INTO owner_profile_id
  FROM public.profiles AS profile
  JOIN auth.users AS auth_user ON auth_user.id = profile.id
  WHERE LOWER(auth_user.email) = 'admin@mpdee.co.uk'
  LIMIT 1;

  SELECT role.id
  INTO administrator_role_id
  FROM public.roles AS role
  WHERE role.name = 'admin'
  LIMIT 1;

  SELECT role.id
  INTO super_admin_role_id
  FROM public.roles AS role
  WHERE role.name = 'superadmin'
  LIMIT 1;

  IF owner_profile_id IS NULL THEN
    RAISE EXCEPTION 'The configured Super Admin owner profile does not exist';
  END IF;

  IF administrator_role_id IS NULL OR super_admin_role_id IS NULL THEN
    RAISE EXCEPTION 'The required admin and superadmin roles do not exist';
  END IF;

  UPDATE public.profiles AS profile
  SET
    role_id = administrator_role_id,
    role = 'admin',
    super_admin = FALSE
  WHERE profile.id <> owner_profile_id
    AND (
      profile.super_admin = TRUE
      OR EXISTS (
        SELECT 1
        FROM public.roles AS assigned_role
        WHERE assigned_role.id = profile.role_id
          AND assigned_role.is_super_admin = TRUE
      )
    );

  UPDATE public.roles
  SET is_super_admin = (id = super_admin_role_id)
  WHERE is_super_admin = TRUE
     OR id = super_admin_role_id;

  UPDATE public.profiles
  SET
    role_id = super_admin_role_id,
    role = 'admin',
    super_admin = TRUE
  WHERE id = owner_profile_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.profile_super_admin_state_is_allowed(
  target_profile_id UUID,
  target_role_id UUID,
  target_super_admin BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  existing_role_id UUID;
  existing_super_admin BOOLEAN;
  existing_role_is_super_admin BOOLEAN;
  target_role_is_super_admin BOOLEAN;
BEGIN
  SELECT
    profile.role_id,
    COALESCE(profile.super_admin, FALSE),
    COALESCE(existing_role.is_super_admin, FALSE)
  INTO
    existing_role_id,
    existing_super_admin,
    existing_role_is_super_admin
  FROM public.profiles AS profile
  LEFT JOIN public.roles AS existing_role ON existing_role.id = profile.role_id
  WHERE profile.id = target_profile_id;

  SELECT COALESCE(role.is_super_admin, FALSE)
  INTO target_role_is_super_admin
  FROM public.roles AS role
  WHERE role.id = target_role_id;

  IF NOT FOUND THEN
    target_role_is_super_admin := FALSE;
  END IF;

  IF existing_role_id IS NULL AND existing_super_admin IS NULL THEN
    RETURN COALESCE(target_super_admin, FALSE) = FALSE
      AND COALESCE(target_role_is_super_admin, FALSE) = FALSE;
  END IF;

  IF existing_super_admin
    OR existing_role_is_super_admin
    OR COALESCE(target_super_admin, FALSE)
    OR COALESCE(target_role_is_super_admin, FALSE)
  THEN
    RETURN existing_role_id IS NOT DISTINCT FROM target_role_id
      AND existing_super_admin IS NOT DISTINCT FROM COALESCE(target_super_admin, FALSE);
  END IF;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.profile_is_protected_super_admin(target_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    LEFT JOIN public.roles AS role ON role.id = profile.role_id
    WHERE profile.id = target_profile_id
      AND (
        COALESCE(profile.super_admin, FALSE)
        OR COALESCE(role.is_super_admin, FALSE)
      )
  );
$$;

DROP POLICY IF EXISTS app_roles_block_super_admin_insert ON public.roles;
CREATE POLICY app_roles_block_super_admin_insert
  ON public.roles
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (COALESCE(is_super_admin, FALSE) = FALSE);

DROP POLICY IF EXISTS app_roles_block_super_admin_update ON public.roles;
CREATE POLICY app_roles_block_super_admin_update
  ON public.roles
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (COALESCE(is_super_admin, FALSE) = FALSE)
  WITH CHECK (COALESCE(is_super_admin, FALSE) = FALSE);

DROP POLICY IF EXISTS app_roles_block_super_admin_delete ON public.roles;
CREATE POLICY app_roles_block_super_admin_delete
  ON public.roles
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated
  USING (COALESCE(is_super_admin, FALSE) = FALSE);

DROP POLICY IF EXISTS app_profiles_block_super_admin_insert ON public.profiles;
CREATE POLICY app_profiles_block_super_admin_insert
  ON public.profiles
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.profile_super_admin_state_is_allowed(id, role_id, super_admin)
  );

DROP POLICY IF EXISTS app_profiles_block_super_admin_update ON public.profiles;
CREATE POLICY app_profiles_block_super_admin_update
  ON public.profiles
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (TRUE)
  WITH CHECK (
    public.profile_super_admin_state_is_allowed(id, role_id, super_admin)
  );

DROP POLICY IF EXISTS app_profiles_block_super_admin_delete ON public.profiles;
CREATE POLICY app_profiles_block_super_admin_delete
  ON public.profiles
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated
  USING (
    public.profile_is_protected_super_admin(id) = FALSE
  );

COMMIT;
