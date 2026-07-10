/**
 * CategoryDialog period_value Validation Tests
 *
 * Tests for the new required period_value field on maintenance categories.
 * period_value represents the due interval:
 *   - Date type: weeks or months (e.g. 6 weeks, 12 months)
 *   - Distance type: miles for vans or kilometres for HGVs
 *   - Hours type: hours (e.g. 250 = every 250 hours)
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Mirror the actual schema from CategoryDialog.tsx
const categorySchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional().nullable(),
  type: z.enum(['date', 'mileage', 'hours'] as const),
  period_unit: z.enum(['weeks', 'months', 'miles', 'hours'] as const),
  period_value: z.coerce.number()
    .int('Period must be a whole number')
    .positive('Period must be a positive number'),
  alert_threshold_days: z.coerce.number().int().positive().optional().nullable(),
  alert_threshold_miles: z.coerce.number().int().positive().optional().nullable(),
  alert_threshold_hours: z.coerce.number().int().positive().optional().nullable(),
  applies_to: z.array(z.enum(['van', 'plant', 'hgv']))
    .min(1, 'Category must apply to at least one asset type')
    .default(['van']),
  is_active: z.boolean().optional(),
  responsibility: z.enum(['workshop', 'office']).default('workshop'),
  show_on_overview: z.boolean().default(true),
  reminder_in_app_enabled: z.boolean().default(false),
  reminder_email_enabled: z.boolean().default(false),
}).superRefine((data, ctx) => {
  if (data.type === 'date') {
    if (data.alert_threshold_days == null || data.alert_threshold_days <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Date-based categories need days threshold',
        path: ['alert_threshold_days']
      });
    }
  } else if (data.type === 'mileage') {
    if (data.alert_threshold_miles == null || data.alert_threshold_miles <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Distance-based categories need a threshold',
        path: ['alert_threshold_miles']
      });
    }
  } else if (data.type === 'hours') {
    if (data.alert_threshold_hours == null || data.alert_threshold_hours <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Hours-based categories need hours threshold',
        path: ['alert_threshold_hours']
      });
    }
  }
});

describe('CategoryDialog period_value validation', () => {
  describe('period_value is required', () => {
    it('should fail when period_value is missing for date type', () => {
      const data = {
        name: 'Tax Due Date',
        type: 'date' as const,
        period_unit: 'months' as const,
        alert_threshold_days: 30,
        applies_to: ['van' as const],
      };

      const result = categorySchema.safeParse(data);
      expect(result.success).toBe(false);
      if (!result.success) {
        const periodIssue = result.error.issues.find(i => i.path.includes('period_value'));
        expect(periodIssue).toBeDefined();
      }
    });

    it('should fail when period_value is missing for mileage type', () => {
      const data = {
        name: 'Service Due',
        type: 'mileage' as const,
        period_unit: 'miles' as const,
        alert_threshold_miles: 1000,
        applies_to: ['van' as const],
      };

      const result = categorySchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should fail when period_value is missing for hours type', () => {
      const data = {
        name: 'Service Due (Hours)',
        type: 'hours' as const,
        period_unit: 'hours' as const,
        alert_threshold_hours: 50,
        applies_to: ['plant' as const],
      };

      const result = categorySchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('period_value must be positive integer', () => {
    it('should fail for zero period', () => {
      const data = {
        name: 'Tax Due Date',
        type: 'date' as const,
        period_unit: 'months' as const,
        period_value: 0,
        alert_threshold_days: 30,
        applies_to: ['van' as const],
      };

      const result = categorySchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should fail for negative period', () => {
      const data = {
        name: 'Tax Due Date',
        type: 'date' as const,
        period_unit: 'months' as const,
        period_value: -6,
        alert_threshold_days: 30,
        applies_to: ['van' as const],
      };

      const result = categorySchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should fail for decimal period (coerced to int check)', () => {
      const data = {
        name: 'Tax Due Date',
        type: 'date' as const,
        period_unit: 'months' as const,
        period_value: 6.5,
        alert_threshold_days: 30,
        applies_to: ['van' as const],
      };

      const result = categorySchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('full valid categories pass with period_value', () => {
    it('should pass for date type with 12-month period', () => {
      const data = {
        name: 'Tax Due Date',
        type: 'date' as const,
        period_unit: 'months' as const,
        period_value: 12,
        alert_threshold_days: 30,
        applies_to: ['van' as const],
      };

      const result = categorySchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should pass for mileage type with 10000-mile period', () => {
      const data = {
        name: 'Service Due',
        type: 'mileage' as const,
        period_unit: 'miles' as const,
        period_value: 10000,
        alert_threshold_miles: 1000,
        applies_to: ['van' as const],
      };

      const result = categorySchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should pass for hours type with 250-hour period', () => {
      const data = {
        name: 'Service Due (Hours)',
        type: 'hours' as const,
        period_unit: 'hours' as const,
        period_value: 250,
        alert_threshold_hours: 50,
        applies_to: ['plant' as const],
      };

      const result = categorySchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe('period_value error path', () => {
    it('should attach error to period_value path when missing', () => {
      const data = {
        name: 'Test Category',
        type: 'date' as const,
        period_unit: 'months' as const,
        alert_threshold_days: 30,
        applies_to: ['van' as const],
      };

      const result = categorySchema.safeParse(data);
      expect(result.success).toBe(false);
      if (!result.success) {
        const errors: Record<string, string> = {};
        result.error.issues.forEach(issue => {
          const path = issue.path[0] as string;
          errors[path] = issue.message;
        });
        expect(errors['period_value']).toBeDefined();
      }
    });

    it('should attach error to period_value path when zero', () => {
      const data = {
        name: 'Test Category',
        type: 'mileage' as const,
        period_unit: 'miles' as const,
        period_value: 0,
        alert_threshold_miles: 1000,
        applies_to: ['van' as const],
      };

      const result = categorySchema.safeParse(data);
      expect(result.success).toBe(false);
      if (!result.success) {
        const periodIssue = result.error.issues.find(i =>
          i.path.includes('period_value')
        );
        expect(periodIssue).toBeDefined();
        expect(periodIssue?.message).toBe('Period must be a positive number');
      }
    });
  });

  describe('both period_value and threshold required together', () => {
    it('should fail when threshold provided but period missing', () => {
      const data = {
        name: 'MOT Due Date',
        type: 'date' as const,
        period_unit: 'months' as const,
        alert_threshold_days: 30,
        applies_to: ['van' as const],
      };

      const result = categorySchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should fail when period provided but threshold missing', () => {
      const data = {
        name: 'MOT Due Date',
        type: 'date' as const,
        period_unit: 'months' as const,
        period_value: 12,
        applies_to: ['van' as const],
      };

      const result = categorySchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should pass when both period and threshold provided', () => {
      const data = {
        name: 'MOT Due Date',
        type: 'date' as const,
        period_unit: 'months' as const,
        period_value: 12,
        alert_threshold_days: 30,
        applies_to: ['van' as const],
      };

      const result = categorySchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe('string coercion for period_value (from form inputs)', () => {
    it('should coerce string "12" to number 12', () => {
      const data = {
        name: 'Tax Due',
        type: 'date' as const,
        period_unit: 'months' as const,
        period_value: '12',
        alert_threshold_days: 30,
        applies_to: ['van' as const],
      };

      const result = categorySchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.period_value).toBe(12);
      }
    });

    it('should coerce string "10000" to number 10000', () => {
      const data = {
        name: 'Service Due',
        type: 'mileage' as const,
        period_unit: 'miles' as const,
        period_value: '10000',
        alert_threshold_miles: 1000,
        applies_to: ['van' as const],
      };

      const result = categorySchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.period_value).toBe(10000);
      }
    });

    it('should reject non-numeric string', () => {
      const data = {
        name: 'Tax Due',
        type: 'date' as const,
        period_unit: 'months' as const,
        period_value: 'abc',
        alert_threshold_days: 30,
        applies_to: ['van' as const],
      };

      const result = categorySchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('date period units', () => {
    it('should accept weekly date periods', () => {
      const data = {
        name: '6 Weekly Inspection Due',
        type: 'date' as const,
        period_unit: 'weeks' as const,
        period_value: 6,
        alert_threshold_days: 7,
        applies_to: ['hgv' as const],
      };

      const result = categorySchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });
});
