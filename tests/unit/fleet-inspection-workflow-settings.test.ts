import { describe, expect, it } from 'vitest';
import {
  fleetInspectionWorkflowConfigSchema,
  fleetInspectionWorkflowSettingsPatchSchema,
  getDefaultFleetInspectionWorkflowConfig,
  mergeFleetInspectionWorkflowConfig,
  parseFleetInspectionWorkflowConfig,
} from '@/lib/server/reminders/fleet-inspection-workflow-settings';

describe('fleet-inspection-workflow-settings', () => {
  it('returns defaults when config is missing or invalid', () => {
    expect(parseFleetInspectionWorkflowConfig(undefined)).toEqual(getDefaultFleetInspectionWorkflowConfig());
    expect(parseFleetInspectionWorkflowConfig({ overdue_days_threshold: 'bad' })).toEqual(
      getDefaultFleetInspectionWorkflowConfig(),
    );
  });

  it('merges partial config updates', () => {
    const current = getDefaultFleetInspectionWorkflowConfig();
    const merged = mergeFleetInspectionWorkflowConfig(current, {
      overdue_days_threshold: 14,
      asset_types: { van: false },
    });

    expect(merged.overdue_days_threshold).toBe(14);
    expect(merged.asset_types.van).toBe(false);
    expect(merged.asset_types.plant).toBe(true);
  });

  it('validates patch payloads', () => {
    expect(
      fleetInspectionWorkflowSettingsPatchSchema.safeParse({
        config: { overdue_days_threshold: 21 },
      }).success,
    ).toBe(true);

    expect(
      fleetInspectionWorkflowSettingsPatchSchema.safeParse({
        config: { overdue_days_threshold: 3 },
      }).success,
    ).toBe(false);
  });

  it('validates full config bounds', () => {
    expect(
      fleetInspectionWorkflowConfigSchema.safeParse({
        overdue_days_threshold: 365,
        asset_types: { van: true, plant: true, hgv: true },
      }).success,
    ).toBe(true);

    expect(
      fleetInspectionWorkflowConfigSchema.safeParse({
        overdue_days_threshold: 366,
        asset_types: { van: true, plant: true, hgv: true },
      }).success,
    ).toBe(false);
  });
});
