import { describe, expect, it } from 'vitest';
import type { MaintenanceCategory } from '@/types/maintenance';
import {
  buildAutomaticMaintenancePlan,
  inferMaintenanceLink,
} from '@/lib/utils/workshopMaintenanceSync';

const baseCategory = {
  description: null,
  alert_threshold_days: 30,
  alert_threshold_miles: null,
  alert_threshold_hours: null,
  applies_to: ['van'],
  is_active: true,
  sort_order: 1,
  created_at: '2026-04-01T00:00:00.000Z',
  updated_at: '2026-04-01T00:00:00.000Z',
  responsibility: 'workshop' as const,
  show_on_overview: true,
  reminder_in_app_enabled: false,
  reminder_email_enabled: false,
};

function makeCategory(
  overrides: Partial<MaintenanceCategory> & Pick<MaintenanceCategory, 'id' | 'name' | 'type' | 'period_value' | 'period_unit'>
): MaintenanceCategory {
  return {
    ...baseCategory,
    ...overrides,
  };
}

describe('workshop maintenance sync', () => {
  it('links a 6 weekly inspection task by title', () => {
    const match = inferMaintenanceLink({
      title: '6 Weekly Inspection Due - ZZ99 TMP',
    });

    expect(match).toEqual({
      categoryName: '6 Weekly Inspection Due',
      fieldName: 'six_weekly_inspection_due_date',
    });
  });

  it('calculates the next HGV 6 weekly due date using weeks', () => {
    const plan = buildAutomaticMaintenancePlan({
      context: {
        title: '6 weekly inspection',
        workshopSubcategoryName: '6 weekly inspection (HGV)',
      },
      categories: [
        makeCategory({
          id: 'cat-6-week',
          name: '6 Weekly Inspection Due',
          type: 'date',
          period_unit: 'weeks',
          period_value: 6,
          alert_threshold_days: 7,
          applies_to: ['hgv'],
        }),
      ],
      state: {
        currentMileage: 120000,
        currentHours: null,
      },
      completedAt: '2026-04-07T15:15:00.000Z',
    });

    expect(plan).not.toBeNull();
    expect(plan?.maintenanceUpdates).toMatchObject({
      six_weekly_inspection_due_date: '2026-05-19',
    });
  });

  it('updates LOLER on the plant record instead of vehicle maintenance', () => {
    const plan = buildAutomaticMaintenancePlan({
      context: {
        title: 'LOLER inspection completed',
      },
      categories: [
        makeCategory({
          id: 'cat-loler',
          name: 'LOLER Due',
          type: 'date',
          period_unit: 'months',
          period_value: 12,
          alert_threshold_days: 30,
          applies_to: ['plant'],
        }),
      ],
      state: {
        currentMileage: null,
        currentHours: null,
      },
      completedAt: '2026-04-07T15:15:00.000Z',
    });

    expect(plan?.plantUpdates).toMatchObject({
      loler_due_date: '2027-04-07',
    });
    expect(plan?.maintenanceUpdates).toEqual({});
  });

  it('uses the current hours to advance plant service due hours', () => {
    const plan = buildAutomaticMaintenancePlan({
      context: {
        title: 'Plant service completed',
        workshopSubcategoryName: 'Service (Hours)',
      },
      categories: [
        makeCategory({
          id: 'cat-hours',
          name: 'Service Due (Hours)',
          type: 'hours',
          period_unit: 'hours',
          period_value: 250,
          alert_threshold_days: null,
          alert_threshold_hours: 50,
          applies_to: ['plant'],
        }),
      ],
      state: {
        currentMileage: null,
        currentHours: 1200,
      },
      completedAt: '2026-04-07T15:15:00.000Z',
    });

    expect(plan?.maintenanceUpdates).toMatchObject({
      last_service_hours: 1200,
      next_service_hours: 1450,
    });
  });

  it('updates the HGV Full Service custom category for major service tasks', () => {
    const plan = buildAutomaticMaintenancePlan({
      context: {
        title: 'Workshop Task - AB12 CDE',
        description: 'MAJOR SERVICE',
        workshopCategoryName: 'Service (HGV)',
      },
      categories: [
        makeCategory({
          id: 'cat-service-due',
          name: 'Service Due',
          type: 'mileage',
          period_unit: 'miles',
          period_value: 10000,
          alert_threshold_days: null,
          alert_threshold_miles: 1000,
          applies_to: ['van'],
        }),
        makeCategory({
          id: 'cat-engine-service',
          name: 'Engine Service',
          type: 'mileage',
          period_unit: 'miles',
          period_value: 25000,
          alert_threshold_days: null,
          alert_threshold_miles: 1000,
          applies_to: ['hgv'],
        }),
        makeCategory({
          id: 'cat-full-service',
          name: 'Full Service',
          type: 'mileage',
          period_unit: 'miles',
          period_value: 100000,
          alert_threshold_days: null,
          alert_threshold_miles: 5000,
          applies_to: ['hgv'],
        }),
      ],
      state: {
        currentMileage: 275309,
        currentHours: null,
      },
      completedAt: '2026-05-01T14:30:35.000Z',
      assetType: 'hgv',
    });

    expect(plan?.maintenanceUpdates).toEqual({});
    expect(plan?.customItems).toEqual([
      {
        category_id: 'cat-full-service',
        last_mileage: 275309,
        due_mileage: 375309,
      },
      {
        category_id: 'cat-engine-service',
        last_mileage: 275309,
        due_mileage: 300309,
      },
    ]);
    expect(plan?.linkedCategoryId).toBe('cat-full-service');
  });

  it('does not apply HGV-only service categories to van service tasks', () => {
    const plan = buildAutomaticMaintenancePlan({
      context: {
        title: 'Full service',
      },
      categories: [
        makeCategory({
          id: 'cat-full-service',
          name: 'Full Service',
          type: 'mileage',
          period_unit: 'miles',
          period_value: 100000,
          alert_threshold_days: null,
          alert_threshold_miles: 5000,
          applies_to: ['hgv'],
        }),
      ],
      state: {
        currentMileage: 10000,
        currentHours: null,
      },
      completedAt: '2026-05-01T14:30:35.000Z',
      assetType: 'van',
    });

    expect(plan).toBeNull();
  });
});
