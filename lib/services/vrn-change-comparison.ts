import { formatRegistrationForApi, formatRegistrationForStorage } from '@/lib/utils/registration';
import type { DVLAApiService } from '@/lib/services/dvla-api';
import type { MotHistoryService } from '@/lib/services/mot-history-api';
import type { VehicleDataResponse } from '@/types/dvla-api';

interface MotRawVehicleData {
  make?: string | null;
  model?: string | null;
  fuelType?: string | null;
  primaryColour?: string | null;
  firstUsedDate?: string | null;
}

interface VrnComparableField {
  key: string;
  label: string;
  source: 'DVLA' | 'MOT';
  oldValue: string | number | boolean | null;
  newValue: string | number | boolean | null;
}

export interface VrnComparisonDifference {
  key: string;
  label: string;
  source: 'DVLA' | 'MOT';
  oldValue: string | null;
  newValue: string | null;
}

export interface VrnLookupWarning {
  registrationNumber: string;
  source: 'DVLA' | 'MOT';
  message: string;
}

export interface VrnLookupSummary {
  registrationNumber: string;
  formattedRegistration: string;
  dvla: {
    make: string | null;
    colour: string | null;
    fuelType: string | null;
    yearOfManufacture: number | null;
    engineSize: number | null;
    taxStatus: string | null;
    taxDueDate: string | null;
    motStatus: string | null;
    monthOfFirstRegistration: string | null;
  } | null;
  mot: {
    make: string | null;
    model: string | null;
    fuelType: string | null;
    primaryColour: string | null;
    firstUsedDate: string | null;
    motExpiryDate: string | null;
    motStatus: string | null;
    lastTestDate: string | null;
    lastTestResult: string | null;
  } | null;
}

export interface VrnChangeComparison {
  oldRegistration: string;
  newRegistration: string;
  hasDifferences: boolean;
  differences: VrnComparisonDifference[];
  warnings: VrnLookupWarning[];
  oldLookup: VrnLookupSummary;
  newLookup: VrnLookupSummary;
}

export interface VrnChangeComparisonServices {
  dvlaService: Pick<DVLAApiService, 'getVehicleData'>;
  motService: Pick<MotHistoryService, 'getMotExpiryData'> | null;
}

interface VrnLookupResult {
  summary: VrnLookupSummary;
  warnings: VrnLookupWarning[];
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown lookup error';
}

function normalizeComparableValue(value: string | number | boolean | null): string {
  if (value === null) return '';
  return String(value).trim().toUpperCase();
}

function formatDisplayValue(value: string | number | boolean | null): string | null {
  if (value === null || value === '') return null;
  return String(value);
}

function getMotRawVehicleData(rawData: unknown): MotRawVehicleData {
  if (!rawData || typeof rawData !== 'object') return {};
  return rawData as MotRawVehicleData;
}

async function lookupRegistration(
  registrationNumber: string,
  services: VrnChangeComparisonServices
): Promise<VrnLookupResult> {
  const formattedRegistration = formatRegistrationForStorage(registrationNumber);
  const apiRegistration = formatRegistrationForApi(registrationNumber);
  const warnings: VrnLookupWarning[] = [];

  const [dvlaResult, motResult] = await Promise.allSettled([
    services.dvlaService.getVehicleData(apiRegistration),
    services.motService?.getMotExpiryData(apiRegistration) ?? Promise.resolve(null),
  ]);

  let dvlaData: VehicleDataResponse | null = null;
  if (dvlaResult.status === 'fulfilled') {
    dvlaData = dvlaResult.value;
  } else {
    warnings.push({
      registrationNumber: formattedRegistration,
      source: 'DVLA',
      message: getErrorMessage(dvlaResult.reason),
    });
  }

  let motExpiryData: Awaited<ReturnType<MotHistoryService['getMotExpiryData']>> | null = null;
  if (!services.motService) {
    warnings.push({
      registrationNumber: formattedRegistration,
      source: 'MOT',
      message: 'MOT History API is not configured',
    });
  } else if (motResult.status === 'fulfilled') {
    motExpiryData = motResult.value;
  } else {
    warnings.push({
      registrationNumber: formattedRegistration,
      source: 'MOT',
      message: getErrorMessage(motResult.reason),
    });
  }

  const motRawData = getMotRawVehicleData(motExpiryData?.rawData);

  return {
    summary: {
      registrationNumber: apiRegistration,
      formattedRegistration,
      dvla: dvlaData
        ? {
          make: dvlaData.make,
          colour: dvlaData.colour,
          fuelType: dvlaData.fuelType,
          yearOfManufacture: dvlaData.yearOfManufacture,
          engineSize: dvlaData.engineSize,
          taxStatus: dvlaData.taxStatus,
          taxDueDate: dvlaData.taxDueDate,
          motStatus: dvlaData.motStatus,
          monthOfFirstRegistration: dvlaData.monthOfFirstRegistration ?? null,
        }
        : null,
      mot: motExpiryData
        ? {
          make: motRawData.make ?? null,
          model: motRawData.model ?? null,
          fuelType: motRawData.fuelType ?? null,
          primaryColour: motRawData.primaryColour ?? null,
          firstUsedDate: motRawData.firstUsedDate ?? null,
          motExpiryDate: motExpiryData.motExpiryDate,
          motStatus: motExpiryData.motStatus,
          lastTestDate: motExpiryData.lastTestDate,
          lastTestResult: motExpiryData.lastTestResult,
        }
        : null,
    },
    warnings,
  };
}

function buildComparableFields(
  oldLookup: VrnLookupSummary,
  newLookup: VrnLookupSummary
): VrnComparableField[] {
  return [
    {
      key: 'dvla.make',
      label: 'Make',
      source: 'DVLA',
      oldValue: oldLookup.dvla?.make ?? null,
      newValue: newLookup.dvla?.make ?? null,
    },
    {
      key: 'dvla.colour',
      label: 'Colour',
      source: 'DVLA',
      oldValue: oldLookup.dvla?.colour ?? null,
      newValue: newLookup.dvla?.colour ?? null,
    },
    {
      key: 'dvla.fuelType',
      label: 'Fuel type',
      source: 'DVLA',
      oldValue: oldLookup.dvla?.fuelType ?? null,
      newValue: newLookup.dvla?.fuelType ?? null,
    },
    {
      key: 'dvla.yearOfManufacture',
      label: 'Year of manufacture',
      source: 'DVLA',
      oldValue: oldLookup.dvla?.yearOfManufacture ?? null,
      newValue: newLookup.dvla?.yearOfManufacture ?? null,
    },
    {
      key: 'dvla.engineSize',
      label: 'Engine size',
      source: 'DVLA',
      oldValue: oldLookup.dvla?.engineSize ?? null,
      newValue: newLookup.dvla?.engineSize ?? null,
    },
    {
      key: 'dvla.taxStatus',
      label: 'Tax status',
      source: 'DVLA',
      oldValue: oldLookup.dvla?.taxStatus ?? null,
      newValue: newLookup.dvla?.taxStatus ?? null,
    },
    {
      key: 'dvla.taxDueDate',
      label: 'Tax due date',
      source: 'DVLA',
      oldValue: oldLookup.dvla?.taxDueDate ?? null,
      newValue: newLookup.dvla?.taxDueDate ?? null,
    },
    {
      key: 'dvla.motStatus',
      label: 'MOT status',
      source: 'DVLA',
      oldValue: oldLookup.dvla?.motStatus ?? null,
      newValue: newLookup.dvla?.motStatus ?? null,
    },
    {
      key: 'dvla.monthOfFirstRegistration',
      label: 'Month of first registration',
      source: 'DVLA',
      oldValue: oldLookup.dvla?.monthOfFirstRegistration ?? null,
      newValue: newLookup.dvla?.monthOfFirstRegistration ?? null,
    },
    {
      key: 'mot.make',
      label: 'Make',
      source: 'MOT',
      oldValue: oldLookup.mot?.make ?? null,
      newValue: newLookup.mot?.make ?? null,
    },
    {
      key: 'mot.model',
      label: 'Model',
      source: 'MOT',
      oldValue: oldLookup.mot?.model ?? null,
      newValue: newLookup.mot?.model ?? null,
    },
    {
      key: 'mot.fuelType',
      label: 'Fuel type',
      source: 'MOT',
      oldValue: oldLookup.mot?.fuelType ?? null,
      newValue: newLookup.mot?.fuelType ?? null,
    },
    {
      key: 'mot.primaryColour',
      label: 'Primary colour',
      source: 'MOT',
      oldValue: oldLookup.mot?.primaryColour ?? null,
      newValue: newLookup.mot?.primaryColour ?? null,
    },
    {
      key: 'mot.firstUsedDate',
      label: 'First used date',
      source: 'MOT',
      oldValue: oldLookup.mot?.firstUsedDate ?? null,
      newValue: newLookup.mot?.firstUsedDate ?? null,
    },
    {
      key: 'mot.motExpiryDate',
      label: 'MOT due date',
      source: 'MOT',
      oldValue: oldLookup.mot?.motExpiryDate ?? null,
      newValue: newLookup.mot?.motExpiryDate ?? null,
    },
    {
      key: 'mot.motStatus',
      label: 'MOT status',
      source: 'MOT',
      oldValue: oldLookup.mot?.motStatus ?? null,
      newValue: newLookup.mot?.motStatus ?? null,
    },
    {
      key: 'mot.lastTestDate',
      label: 'Last MOT test date',
      source: 'MOT',
      oldValue: oldLookup.mot?.lastTestDate ?? null,
      newValue: newLookup.mot?.lastTestDate ?? null,
    },
    {
      key: 'mot.lastTestResult',
      label: 'Last MOT result',
      source: 'MOT',
      oldValue: oldLookup.mot?.lastTestResult ?? null,
      newValue: newLookup.mot?.lastTestResult ?? null,
    },
  ];
}

export async function compareVrnChange(
  oldRegistration: string,
  newRegistration: string,
  services: VrnChangeComparisonServices
): Promise<VrnChangeComparison> {
  const [oldResult, newResult] = await Promise.all([
    lookupRegistration(oldRegistration, services),
    lookupRegistration(newRegistration, services),
  ]);

  const differences = buildComparableFields(oldResult.summary, newResult.summary)
    .filter((field) => normalizeComparableValue(field.oldValue) !== normalizeComparableValue(field.newValue))
    .map((field) => ({
      key: field.key,
      label: field.label,
      source: field.source,
      oldValue: formatDisplayValue(field.oldValue),
      newValue: formatDisplayValue(field.newValue),
    }));

  return {
    oldRegistration: oldResult.summary.formattedRegistration,
    newRegistration: newResult.summary.formattedRegistration,
    hasDifferences: differences.length > 0,
    differences,
    warnings: [...oldResult.warnings, ...newResult.warnings],
    oldLookup: oldResult.summary,
    newLookup: newResult.summary,
  };
}
