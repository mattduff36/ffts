BEGIN;

CREATE TABLE IF NOT EXISTS public.reminder_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_key TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'system_generated',
  dedupe_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'medium',
  title TEXT NOT NULL,
  description TEXT,
  asset_type TEXT,
  van_id UUID REFERENCES public.vans(id) ON DELETE SET NULL,
  plant_id UUID REFERENCES public.plant(id) ON DELETE SET NULL,
  hgv_id UUID REFERENCES public.hgvs(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  first_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reminder_actions_source_type_check CHECK (
    source_type IN ('system_generated', 'manager_created')
  ),
  CONSTRAINT reminder_actions_status_check CHECK (
    status IN ('open', 'resolved', 'cancelled')
  ),
  CONSTRAINT reminder_actions_priority_check CHECK (
    priority IN ('low', 'medium', 'high', 'urgent')
  ),
  CONSTRAINT reminder_actions_asset_type_check CHECK (
    asset_type IS NULL OR asset_type IN ('van', 'plant', 'hgv')
  ),
  CONSTRAINT reminder_actions_single_asset_check CHECK (
    ((van_id IS NOT NULL)::INT + (plant_id IS NOT NULL)::INT + (hgv_id IS NOT NULL)::INT) <= 1
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS reminder_actions_open_dedupe_key_idx
  ON public.reminder_actions (dedupe_key)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS reminder_actions_workflow_status_idx
  ON public.reminder_actions (workflow_key, status, last_detected_at DESC);

CREATE INDEX IF NOT EXISTS reminder_actions_van_idx
  ON public.reminder_actions (van_id)
  WHERE van_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS reminder_actions_plant_idx
  ON public.reminder_actions (plant_id)
  WHERE plant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS reminder_actions_hgv_idx
  ON public.reminder_actions (hgv_id)
  WHERE hgv_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id UUID NOT NULL REFERENCES public.reminder_actions(id) ON DELETE CASCADE,
  assigned_to UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  action_note TEXT,
  actioned_at TIMESTAMPTZ,
  actioned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reminders_status_check CHECK (
    status IN ('pending', 'actioned', 'cancelled')
  ),
  CONSTRAINT reminders_action_timestamps_check CHECK (
    (status <> 'actioned') OR actioned_at IS NOT NULL
  ),
  CONSTRAINT reminders_cancelled_timestamps_check CHECK (
    (status <> 'cancelled') OR cancelled_at IS NOT NULL
  ),
  CONSTRAINT reminders_unique_assignment UNIQUE (action_id, assigned_to)
);

CREATE INDEX IF NOT EXISTS reminders_assigned_to_status_idx
  ON public.reminders (assigned_to, status, created_at DESC);

CREATE INDEX IF NOT EXISTS reminders_action_id_status_idx
  ON public.reminders (action_id, status, created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at_reminder_actions ON public.reminder_actions;
CREATE TRIGGER set_updated_at_reminder_actions
  BEFORE UPDATE ON public.reminder_actions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at_reminders ON public.reminders;
CREATE TRIGGER set_updated_at_reminders
  BEFORE UPDATE ON public.reminders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.reminder_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reminder_actions_select_managers ON public.reminder_actions;
CREATE POLICY reminder_actions_select_managers ON public.reminder_actions
  FOR SELECT TO authenticated
  USING (
    public.effective_has_module_permission('actions')
    OR (
      public.effective_has_module_permission('reminders')
      AND EXISTS (
        SELECT 1
        FROM public.reminders
        WHERE reminders.action_id = reminder_actions.id
          AND reminders.assigned_to = (SELECT auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS reminder_actions_insert_managers ON public.reminder_actions;
CREATE POLICY reminder_actions_insert_managers ON public.reminder_actions
  FOR INSERT TO authenticated
  WITH CHECK (public.effective_has_module_permission('actions'));

DROP POLICY IF EXISTS reminder_actions_update_managers ON public.reminder_actions;
CREATE POLICY reminder_actions_update_managers ON public.reminder_actions
  FOR UPDATE TO authenticated
  USING (public.effective_has_module_permission('actions'))
  WITH CHECK (public.effective_has_module_permission('actions'));

DROP POLICY IF EXISTS reminders_select_policy ON public.reminders;
CREATE POLICY reminders_select_policy ON public.reminders
  FOR SELECT TO authenticated
  USING (
    public.effective_has_module_permission('actions')
    OR (
      public.effective_has_module_permission('reminders')
      AND assigned_to = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS reminders_insert_managers ON public.reminders;
CREATE POLICY reminders_insert_managers ON public.reminders
  FOR INSERT TO authenticated
  WITH CHECK (public.effective_has_module_permission('actions'));

DROP POLICY IF EXISTS reminders_update_managers ON public.reminders;
CREATE POLICY reminders_update_managers ON public.reminders
  FOR UPDATE TO authenticated
  USING (public.effective_has_module_permission('actions'))
  WITH CHECK (public.effective_has_module_permission('actions'));

DROP POLICY IF EXISTS reminders_update_own ON public.reminders;
CREATE POLICY reminders_update_own ON public.reminders
  FOR UPDATE TO authenticated
  USING (
    public.effective_has_module_permission('reminders')
    AND assigned_to = (SELECT auth.uid())
  )
  WITH CHECK (
    public.effective_has_module_permission('reminders')
    AND assigned_to = (SELECT auth.uid())
  );

INSERT INTO public.permission_modules (module_name, minimum_role_id, sort_order)
SELECT 'reminders', roles.id, 205
FROM public.roles
WHERE roles.name = 'contractor'
ON CONFLICT (module_name) DO UPDATE
SET minimum_role_id = EXCLUDED.minimum_role_id,
    sort_order = EXCLUDED.sort_order,
    updated_at = NOW();

INSERT INTO public.role_permissions (role_id, module_name, enabled)
SELECT
  roles.id,
  'reminders',
  FALSE
FROM public.roles
ON CONFLICT (role_id, module_name) DO NOTHING;

INSERT INTO public.team_module_permissions (team_id, module_name, enabled)
SELECT org_teams.id, 'reminders', TRUE
FROM public.org_teams
WHERE org_teams.active = TRUE
ON CONFLICT (team_id, module_name) DO UPDATE
SET enabled = EXCLUDED.enabled,
    updated_at = NOW();

COMMIT;
