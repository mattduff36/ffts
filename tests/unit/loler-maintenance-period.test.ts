import { describe, expect, it } from 'vitest';
import {
  calculateLolerExpiryDate,
  findLolerMaintenanceCategory,
  getLolerPeriodLabel,
  type LolerMaintenanceCategory,
} from '@/lib/utils/lolerMaintenance';

function makeCategory(overrides: Partial<LolerMaintenanceCategory>): LolerMaintenanceCategory {
  return {
    name: 'LOLER Due',
    field_key: 'loler_due_date',
    type: 'date',
    period_value: 12,
    period_unit: 'months',
    is_active: true,
    ...overrides,
  };
}

describe('LOLER maintenance period', () => {
  it('uses the maintenance settings category as the LOLER period source', () => {
    const category = findLolerMaintenanceCategory([
      makeCategory({ name: 'Legacy LOLER', field_key: null, period_value: 3 }),
      makeCategory({ name: 'LOLER Due', field_key: 'loler_due_date', period_value: 12 }),
    ]);

    expect(category?.period_value).toBe(12);
    expect(getLolerPeriodLabel(category)).toBe('12 months');
  });

  it('calculates the report expiry from the report completion date', () => {
    const category = makeCategory({ period_value: 12, period_unit: 'months' });

    expect(calculateLolerExpiryDate('2026-06-10T13:50:43.213Z', category)).toBe('2027-06-10');
  });
});
