import type {
  CustomMaintenanceItemUpdate,
  MaintenanceCategory,
  UpdateMaintenanceRequest,
} from '@/types/maintenance';
import {
  addDatePeriod,
  normalizePeriodUnit,
  toDateOnlyString,
} from '@/lib/utils/maintenancePeriods';
import {
  categoryAppliesToAsset,
  type MaintenanceAssetType,
} from '@/lib/utils/maintenanceCategoryRules';

type LinkedMaintenanceField =
  | 'tax_due_date'
  | 'mot_due_date'
  | 'first_aid_kit_expiry'
  | 'six_weekly_inspection_due_date'
  | 'fire_extinguisher_due_date'
  | 'taco_calibration_due_date'
  | 'next_service_mileage'
  | 'cambelt_due_mileage'
  | 'loler_due_date'
  | 'next_service_hours'
  | 'custom_mileage';

type DateMaintenanceField =
  | 'tax_due_date'
  | 'mot_due_date'
  | 'first_aid_kit_expiry'
  | 'six_weekly_inspection_due_date'
  | 'fire_extinguisher_due_date'
  | 'taco_calibration_due_date';

export interface MaintenanceLinkMatch {
  categoryName: string;
  fieldName: LinkedMaintenanceField;
}

export interface MaintenanceSyncContext {
  title?: string | null;
  description?: string | null;
  workshopCategoryName?: string | null;
  workshopSubcategoryName?: string | null;
}

export interface AutomaticMaintenanceState {
  currentMileage: number | null;
  currentHours: number | null;
}

export interface AutomaticMaintenancePlan {
  maintenanceUpdates: Partial<UpdateMaintenanceRequest>;
  customItems: CustomMaintenanceItemUpdate[];
  plantUpdates: { loler_due_date?: string | null };
  linkedCategoryId: string | null;
}

const LINK_PATTERNS: Array<MaintenanceLinkMatch & { pattern: RegExp }> = [
  {
    categoryName: 'Full Service',
    fieldName: 'custom_mileage',
    pattern: /\b(major|full)\b.*\bservice\b|\bservice\b.*\b(major|full)\b/,
  },
  {
    categoryName: 'Engine Service',
    fieldName: 'custom_mileage',
    pattern: /\b(engine|basic|small)\b.*\bservice\b|\bservice\b.*\b(engine|basic|small)\b/,
  },
  {
    categoryName: '6 Weekly Inspection Due',
    fieldName: 'six_weekly_inspection_due_date',
    pattern: /\b6[\s-]*weekly\b/,
  },
  {
    categoryName: 'Fire Extinguisher Due',
    fieldName: 'fire_extinguisher_due_date',
    pattern: /\bfire\s+extinguisher\b/,
  },
  {
    categoryName: 'Taco Calibration Due',
    fieldName: 'taco_calibration_due_date',
    pattern: /\b(taco|tachograph)\s+calibration\b/,
  },
  {
    categoryName: 'First Aid Kit Expiry',
    fieldName: 'first_aid_kit_expiry',
    pattern: /\bfirst\s+aid\b/,
  },
  {
    categoryName: 'LOLER Due',
    fieldName: 'loler_due_date',
    pattern: /\blo+l[eo]r\b|\blifting operations\b/,
  },
  {
    categoryName: 'Service Due (Hours)',
    fieldName: 'next_service_hours',
    pattern: /\bservice\b.*\bhours\b|\bhours\b.*\bservice\b/,
  },
  {
    categoryName: 'Cambelt Replacement',
    fieldName: 'cambelt_due_mileage',
    pattern: /\bcambelt\b/,
  },
  {
    categoryName: 'Service Due',
    fieldName: 'next_service_mileage',
    pattern: /\bservice\b/,
  },
  {
    categoryName: 'MOT Due Date',
    fieldName: 'mot_due_date',
    pattern: /\bmot\b/,
  },
  {
    categoryName: 'Tax Due Date',
    fieldName: 'tax_due_date',
    pattern: /\btax\b/,
  },
];

function collectMatchText(context: MaintenanceSyncContext): string {
  return [
    context.title,
    context.description,
    context.workshopCategoryName,
    context.workshopSubcategoryName,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function inferMaintenanceLink(context: MaintenanceSyncContext): MaintenanceLinkMatch | null {
  const haystack = collectMatchText(context);
  if (!haystack) {
    return null;
  }

  for (const link of LINK_PATTERNS) {
    if (link.pattern.test(haystack)) {
      return {
        categoryName: link.categoryName,
        fieldName: link.fieldName,
      };
    }
  }

  return null;
}

export function buildAutomaticMaintenancePlan(params: {
  context: MaintenanceSyncContext;
  categories: MaintenanceCategory[];
  state: AutomaticMaintenanceState;
  completedAt: string;
  assetType?: MaintenanceAssetType;
}): AutomaticMaintenancePlan | null {
  const link = inferMaintenanceLink(params.context);
  if (!link) {
    return null;
  }

  const findApplicableCategory = (categoryName: string) => params.categories.find(
    (candidate) =>
      candidate.name.toLowerCase() === categoryName.toLowerCase() &&
      (!params.assetType || categoryAppliesToAsset(candidate, params.assetType, candidate.name))
  );
  const category = findApplicableCategory(link.categoryName);
  if (!category) {
    return null;
  }

  const maintenanceUpdates: Partial<UpdateMaintenanceRequest> = {};
  const customItems: CustomMaintenanceItemUpdate[] = [];
  const plantUpdates: { loler_due_date?: string | null } = {};
  const completedAt = new Date(params.completedAt);

  if (Number.isNaN(completedAt.getTime())) {
    return null;
  }

  if (category.type === 'date') {
    const nextDueDate = toDateOnlyString(
      addDatePeriod(completedAt, category.period_value, normalizePeriodUnit(category.type, category.period_unit))
    );

    if (link.fieldName === 'loler_due_date') {
      plantUpdates.loler_due_date = nextDueDate;
    } else {
      maintenanceUpdates[link.fieldName as DateMaintenanceField] = nextDueDate;
    }
  }

  if (category.type === 'mileage' && params.state.currentMileage != null) {
    const nextDueMileage = params.state.currentMileage + category.period_value;

    if (link.fieldName === 'custom_mileage') {
      customItems.push({
        category_id: category.id,
        last_mileage: params.state.currentMileage,
        due_mileage: nextDueMileage,
      });

      const engineServiceCategory = category.name.toLowerCase() === 'full service'
        ? findApplicableCategory('Engine Service')
        : null;

      if (engineServiceCategory && engineServiceCategory.id !== category.id) {
        customItems.push({
          category_id: engineServiceCategory.id,
          last_mileage: params.state.currentMileage,
          due_mileage: params.state.currentMileage + engineServiceCategory.period_value,
        });
      }
    }

    if (link.fieldName === 'next_service_mileage') {
      maintenanceUpdates.last_service_mileage = params.state.currentMileage;
      maintenanceUpdates.next_service_mileage = nextDueMileage;
    }

    if (link.fieldName === 'cambelt_due_mileage') {
      maintenanceUpdates.cambelt_due_mileage = nextDueMileage;
    }
  }

  if (category.type === 'hours' && params.state.currentHours != null) {
    const nextDueHours = params.state.currentHours + category.period_value;

    if (link.fieldName === 'next_service_hours') {
      maintenanceUpdates.last_service_hours = params.state.currentHours;
      maintenanceUpdates.next_service_hours = nextDueHours;
    }
  }

  if (
    Object.keys(maintenanceUpdates).length === 0 &&
    customItems.length === 0 &&
    Object.keys(plantUpdates).length === 0
  ) {
    return null;
  }

  return {
    maintenanceUpdates,
    customItems,
    plantUpdates,
    linkedCategoryId: category.id,
  };
}
