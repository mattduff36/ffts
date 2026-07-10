import type { MaintenanceCategory, MaintenanceItemStatus } from '@/types/maintenance';

export type MaintenanceAssetType = 'van' | 'hgv' | 'plant';

export type MaintenanceCategoryKey =
  | 'tax'
  | 'mot'
  | 'service'
  | 'cambelt'
  | 'firstAid'
  | 'sixWeekly'
  | 'fireExtinguisher'
  | 'tacoCalibration'
  | 'loler'
  | 'serviceHours'
  | 'engineService'
  | 'fullService';

export interface MaintenanceCategoryRule {
  key: MaintenanceCategoryKey;
  categoryName: string;
  assetTypes: MaintenanceAssetType[];
}

export interface MaintenanceStatusForCategory {
  categoryName: string;
  status: MaintenanceItemStatus;
}

export type MaintenanceCategoryConfig = Pick<MaintenanceCategory, 'name'> & Partial<MaintenanceCategory>;

export const MAINTENANCE_CATEGORY_NAMES = {
  tax: 'tax due date',
  mot: 'mot due date',
  service: 'service due',
  cambelt: 'cambelt replacement',
  firstAid: 'first aid kit expiry',
  sixWeekly: '6 weekly inspection due',
  fireExtinguisher: 'fire extinguisher due',
  tacoCalibration: 'taco calibration due',
  loler: 'loler due',
  serviceHours: 'service due (hours)',
  engineService: 'engine service',
  fullService: 'full service',
} as const satisfies Record<MaintenanceCategoryKey, string>;

export const MAINTENANCE_CATEGORY_RULES: MaintenanceCategoryRule[] = [
  { key: 'tax', categoryName: MAINTENANCE_CATEGORY_NAMES.tax, assetTypes: ['van', 'hgv', 'plant'] },
  { key: 'mot', categoryName: MAINTENANCE_CATEGORY_NAMES.mot, assetTypes: ['van', 'hgv'] },
  { key: 'service', categoryName: MAINTENANCE_CATEGORY_NAMES.service, assetTypes: ['van'] },
  { key: 'cambelt', categoryName: MAINTENANCE_CATEGORY_NAMES.cambelt, assetTypes: ['van'] },
  { key: 'firstAid', categoryName: MAINTENANCE_CATEGORY_NAMES.firstAid, assetTypes: ['van', 'hgv'] },
  { key: 'sixWeekly', categoryName: MAINTENANCE_CATEGORY_NAMES.sixWeekly, assetTypes: ['hgv'] },
  { key: 'fireExtinguisher', categoryName: MAINTENANCE_CATEGORY_NAMES.fireExtinguisher, assetTypes: ['hgv'] },
  { key: 'tacoCalibration', categoryName: MAINTENANCE_CATEGORY_NAMES.tacoCalibration, assetTypes: ['hgv'] },
  { key: 'loler', categoryName: MAINTENANCE_CATEGORY_NAMES.loler, assetTypes: ['plant'] },
  { key: 'serviceHours', categoryName: MAINTENANCE_CATEGORY_NAMES.serviceHours, assetTypes: ['plant'] },
  { key: 'engineService', categoryName: MAINTENANCE_CATEGORY_NAMES.engineService, assetTypes: ['hgv'] },
  { key: 'fullService', categoryName: MAINTENANCE_CATEGORY_NAMES.fullService, assetTypes: ['hgv'] },
];

export type MaintenanceCategoryMap = Map<string, MaintenanceCategoryConfig>;

export function normalizeMaintenanceCategoryName(name: string): string {
  return name.trim().toLowerCase();
}

export function createMaintenanceCategoryMap(
  categories: readonly MaintenanceCategoryConfig[] | null | undefined
): MaintenanceCategoryMap {
  return new Map(
    (categories || []).map(category => [
      normalizeMaintenanceCategoryName(category.name),
      category,
    ])
  );
}

export function getMaintenanceCategory(
  categoryMap: MaintenanceCategoryMap,
  categoryName: string
): MaintenanceCategoryConfig | undefined {
  return categoryMap.get(normalizeMaintenanceCategoryName(categoryName));
}

export function normalizeMaintenanceAssetType(assetType: string | null | undefined): MaintenanceAssetType {
  if (assetType === 'hgv' || assetType === 'plant') return assetType;
  return 'van';
}

export function getDefaultCategoryRule(categoryName: string): MaintenanceCategoryRule | undefined {
  const normalizedName = normalizeMaintenanceCategoryName(categoryName);
  return MAINTENANCE_CATEGORY_RULES.find(rule => rule.categoryName === normalizedName);
}

export function categoryAppliesToAsset(
  category: MaintenanceCategoryConfig | undefined,
  assetType: string | null | undefined,
  categoryName: string
): boolean {
  const normalizedAssetType = normalizeMaintenanceAssetType(assetType);
  const appliesTo = category?.applies_to?.map(value => value.toLowerCase()) || [];

  if (appliesTo.length > 0) {
    if (normalizedAssetType === 'van') {
      return appliesTo.includes('van') || appliesTo.includes('vehicle');
    }

    return appliesTo.includes(normalizedAssetType);
  }

  const defaultRule = getDefaultCategoryRule(categoryName);
  return defaultRule ? defaultRule.assetTypes.includes(normalizedAssetType) : true;
}

export function isMaintenanceCategoryVisibleOnOverview(
  category: MaintenanceCategoryConfig | undefined,
  assetType: string | null | undefined,
  categoryName: string
): boolean {
  if (category?.is_active === false) return false;
  if (category?.show_on_overview === false) return false;
  return categoryAppliesToAsset(category, assetType, categoryName);
}

export function getVisibleMaintenanceStatuses(
  assetType: string | null | undefined,
  categoryMap: MaintenanceCategoryMap,
  statuses: readonly MaintenanceStatusForCategory[]
): MaintenanceItemStatus[] {
  return statuses
    .filter(({ categoryName }) => {
      const category = getMaintenanceCategory(categoryMap, categoryName);
      return isMaintenanceCategoryVisibleOnOverview(category, assetType, categoryName);
    })
    .map(({ status }) => status);
}

export function getDistanceUnitLabel(assetType: string | null | undefined): 'miles' | 'km' {
  return normalizeMaintenanceAssetType(assetType) === 'hgv' ? 'km' : 'miles';
}

export function getDistanceTypeLabel(assetTypes: readonly string[] | null | undefined): string {
  const normalized = (assetTypes || []).map(assetType => assetType.toLowerCase());
  const appliesToHgv = normalized.includes('hgv');
  const appliesToVan = normalized.includes('van') || normalized.includes('vehicle');

  if (appliesToHgv && !appliesToVan) return 'Kilometres';
  if (appliesToHgv && appliesToVan) return 'Miles / Kilometres';
  return 'Miles';
}
