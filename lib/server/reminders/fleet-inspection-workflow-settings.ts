import { z } from 'zod';
import type { FleetInspectionWorkflowConfig, ReminderAssetType } from '@/types/reminders';
import { FLEET_INSPECTION_DEFAULT_THRESHOLD_DAYS } from '@/types/reminders';

export { FLEET_INSPECTION_DEFAULT_THRESHOLD_DAYS };
export type { FleetInspectionWorkflowConfig };

export const fleetInspectionAssetTypesSchema = z.object({
  van: z.boolean(),
  plant: z.boolean(),
  hgv: z.boolean(),
});

export const fleetInspectionWorkflowConfigSchema = z.object({
  overdue_days_threshold: z.number().int().min(7).max(365),
  asset_types: fleetInspectionAssetTypesSchema,
});

export const fleetInspectionWorkflowSettingsPatchSchema = z.object({
  is_enabled: z.boolean().optional(),
  config: fleetInspectionWorkflowConfigSchema.partial().optional(),
});

export type FleetInspectionWorkflowSettingsPatch = z.infer<typeof fleetInspectionWorkflowSettingsPatchSchema>;

export interface ReminderWorkflowSettingsRow {
  workflow_key: string;
  is_enabled: boolean;
  config: Record<string, unknown>;
  updated_by: string | null;
  last_generated_at: string | null;
  created_at: string;
  updated_at: string;
}

export function getDefaultFleetInspectionWorkflowConfig(): FleetInspectionWorkflowConfig {
  return {
    overdue_days_threshold: FLEET_INSPECTION_DEFAULT_THRESHOLD_DAYS,
    asset_types: {
      van: true,
      plant: true,
      hgv: true,
    },
  };
}

export function parseFleetInspectionWorkflowConfig(
  config: Record<string, unknown> | null | undefined,
): FleetInspectionWorkflowConfig {
  const defaults = getDefaultFleetInspectionWorkflowConfig();
  const assetTypes =
    config?.asset_types && typeof config.asset_types === 'object'
      ? (config.asset_types as Record<string, unknown>)
      : {};
  const parsed = fleetInspectionWorkflowConfigSchema.safeParse({
    overdue_days_threshold:
      typeof config?.overdue_days_threshold === 'number'
        ? config.overdue_days_threshold
        : defaults.overdue_days_threshold,
    asset_types: {
      van:
        typeof assetTypes.van === 'boolean'
          ? assetTypes.van
          : defaults.asset_types.van,
      plant:
        typeof assetTypes.plant === 'boolean'
          ? assetTypes.plant
          : defaults.asset_types.plant,
      hgv:
        typeof assetTypes.hgv === 'boolean'
          ? assetTypes.hgv
          : defaults.asset_types.hgv,
    },
  });

  if (parsed.success) {
    return parsed.data;
  }

  return defaults;
}

export function mergeFleetInspectionWorkflowConfig(
  current: FleetInspectionWorkflowConfig,
  patch: Partial<FleetInspectionWorkflowConfig>,
): FleetInspectionWorkflowConfig {
  return fleetInspectionWorkflowConfigSchema.parse({
    overdue_days_threshold: patch.overdue_days_threshold ?? current.overdue_days_threshold,
    asset_types: {
      van: patch.asset_types?.van ?? current.asset_types.van,
      plant: patch.asset_types?.plant ?? current.asset_types.plant,
      hgv: patch.asset_types?.hgv ?? current.asset_types.hgv,
    },
  });
}

export function isFleetInspectionAssetTypeEnabled(
  config: FleetInspectionWorkflowConfig,
  assetType: ReminderAssetType,
): boolean {
  return config.asset_types[assetType];
}

type AdminClient = ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>;

export interface ResolvedFleetInspectionWorkflowSettings {
  workflow_key: string;
  is_enabled: boolean;
  config: FleetInspectionWorkflowConfig;
  updated_by: string | null;
  last_generated_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export async function loadFleetInspectionWorkflowSettings(
  admin: AdminClient,
): Promise<ResolvedFleetInspectionWorkflowSettings> {
  const { data, error } = await admin
    .from('reminder_workflow_settings')
    .select('workflow_key, is_enabled, config, updated_by, last_generated_at, created_at, updated_at')
    .eq('workflow_key', 'fleet_inspection_overdue')
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return {
      workflow_key: 'fleet_inspection_overdue',
      is_enabled: true,
      config: getDefaultFleetInspectionWorkflowConfig(),
      updated_by: null,
      last_generated_at: null,
      created_at: null,
      updated_at: null,
    };
  }

  return {
    workflow_key: data.workflow_key,
    is_enabled: data.is_enabled,
    config: parseFleetInspectionWorkflowConfig(data.config as Record<string, unknown>),
    updated_by: data.updated_by,
    last_generated_at: data.last_generated_at,
    created_at: data.created_at,
    updated_at: data.updated_at,
  };
}

export async function updateFleetInspectionWorkflowSettings(
  admin: AdminClient,
  params: {
    patch: FleetInspectionWorkflowSettingsPatch;
    updatedBy: string;
  },
): Promise<ResolvedFleetInspectionWorkflowSettings> {
  const current = await loadFleetInspectionWorkflowSettings(admin);
  const nextConfig = params.patch.config
    ? mergeFleetInspectionWorkflowConfig(current.config, params.patch.config)
    : current.config;

  const payload = {
    workflow_key: 'fleet_inspection_overdue',
    is_enabled: params.patch.is_enabled ?? current.is_enabled,
    config: nextConfig,
    updated_by: params.updatedBy,
  };

  const { data, error } = await admin
    .from('reminder_workflow_settings')
    .upsert(payload, { onConflict: 'workflow_key' })
    .select('workflow_key, is_enabled, config, updated_by, last_generated_at, created_at, updated_at')
    .single();

  if (error) {
    throw error;
  }

  return {
    workflow_key: data.workflow_key,
    is_enabled: data.is_enabled,
    config: parseFleetInspectionWorkflowConfig(data.config as Record<string, unknown>),
    updated_by: data.updated_by,
    last_generated_at: data.last_generated_at,
    created_at: data.created_at,
    updated_at: data.updated_at,
  };
}
