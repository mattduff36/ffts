import {
  addDatePeriod,
  formatCategoryPeriod,
  normalizePeriodUnit,
  toDateOnlyString,
} from '@/lib/utils/maintenancePeriods';

export interface LolerMaintenanceCategory {
  name: string | null;
  field_key?: string | null;
  type: 'date' | 'mileage' | 'hours';
  period_value: number;
  period_unit?: string | null;
  is_active?: boolean | null;
}

export const DEFAULT_LOLER_PERIOD_LABEL = '12 months';

function getLolerCategoryRank(category: LolerMaintenanceCategory): number | null {
  const normalizedName = (category.name || '').trim().toLowerCase();

  if (category.type !== 'date') return null;
  if (category.field_key === 'loler_due_date') return 0;
  if (normalizedName === 'loler due') return 1;
  if (normalizedName.includes('loler')) return 2;
  return null;
}

export function findLolerMaintenanceCategory<T extends LolerMaintenanceCategory>(
  categories: T[] | null | undefined
): T | null {
  if (!categories?.length) return null;

  return categories
    .filter((category) => category.is_active !== false)
    .map((category) => ({
      category,
      rank: getLolerCategoryRank(category),
    }))
    .filter((entry): entry is { category: T; rank: number } => entry.rank !== null)
    .sort((left, right) => left.rank - right.rank)[0]?.category ?? null;
}

export function getLolerPeriodLabel(category: LolerMaintenanceCategory | null | undefined): string {
  if (!category || category.type !== 'date') return DEFAULT_LOLER_PERIOD_LABEL;
  return formatCategoryPeriod({
    type: category.type,
    period_value: category.period_value,
    period_unit: normalizePeriodUnit(category.type, category.period_unit),
  });
}

export function calculateLolerExpiryDate(
  completedAt: string | null | undefined,
  category: LolerMaintenanceCategory | null | undefined
): string | null {
  if (!completedAt || !category || category.type !== 'date') return null;

  const completedDate = new Date(completedAt);
  if (Number.isNaN(completedDate.getTime())) return null;

  return toDateOnlyString(
    addDatePeriod(
      completedDate,
      category.period_value,
      normalizePeriodUnit(category.type, category.period_unit)
    )
  );
}
