DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;

DROP POLICY IF EXISTS "Admins can manage categories" ON public.van_categories;
DROP POLICY IF EXISTS "Managers can insert van categories" ON public.van_categories;
DROP POLICY IF EXISTS "Managers can update van categories" ON public.van_categories;
DROP POLICY IF EXISTS "Managers can delete van categories" ON public.van_categories;

CREATE POLICY "Managers can insert van categories"
  ON public.van_categories
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT public.effective_is_manager_admin()));

CREATE POLICY "Managers can update van categories"
  ON public.van_categories
  FOR UPDATE
  TO authenticated
  USING ((SELECT public.effective_is_manager_admin()))
  WITH CHECK ((SELECT public.effective_is_manager_admin()));

CREATE POLICY "Managers can delete van categories"
  ON public.van_categories
  FOR DELETE
  TO authenticated
  USING ((SELECT public.effective_is_manager_admin()));
