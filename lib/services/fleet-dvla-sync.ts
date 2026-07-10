import { formatRegistrationForApi } from '@/lib/utils/registration';
import type { DVLAApiService } from '@/lib/services/dvla-api';
import type { MotHistoryService } from '@/lib/services/mot-history-api';
import type { HgvAnnualTestService } from '@/lib/services/hgv-annual-test-api';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

export type FleetAssetType = 'van' | 'hgv' | 'plant';
type MaintenanceForeignKey = 'van_id' | 'hgv_id' | 'plant_id';

export interface FleetSyncTarget {
  assetType: FleetAssetType;
  assetId: string;
  registrationNumber: string;
}

export interface FleetSyncOptions {
  supabase: SupabaseClient<Database>;
  dvlaService: DVLAApiService;
  motService: MotHistoryService | null;
  hgvAnnualTestService?: HgvAnnualTestService | null;
  targets: FleetSyncTarget[];
  triggerType: 'manual' | 'bulk' | 'automatic' | 'auto_on_create';
  triggeredBy: string | null;
  logPrefix?: string;
  delayMsBetweenRequests?: number;
}

export interface FleetSyncResultRow {
  success: boolean;
  assetType: FleetAssetType;
  assetId: string;
  vehicleId: string;
  registrationNumber: string;
  updatedFields?: string[];
  fields_updated?: string[];
  errors?: string[];
  error?: string;
  syncedAt: string;
}

export interface FleetSyncSummary {
  total: number;
  successful: number;
  failed: number;
  results: FleetSyncResultRow[];
}

export const TEST_REGISTRATIONS = new Set(['ZZ99VAN', 'ZZ99HGV']);

export function isExpectedFleetDvlaLookupFailure(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('dvla api error') &&
    (
      normalized.includes('404') ||
      normalized.includes('not found') ||
      normalized.includes('vehicle not found')
    )
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  // Supabase PostgrestError is a plain object with a `message` field
  if (error && typeof error === 'object' && 'message' in error && typeof (error as Record<string, unknown>).message === 'string') {
    const e = error as { message: string; code?: string; details?: string; hint?: string };
    const parts = [e.message];
    if (e.details) parts.push(`(${e.details})`);
    if (e.hint) parts.push(`Hint: ${e.hint}`);
    if (e.code) parts.push(`[${e.code}]`);
    return parts.join(' ');
  }
  return 'Unknown sync error';
}

function fkForAssetType(assetType: FleetAssetType): MaintenanceForeignKey {
  if (assetType === 'hgv') return 'hgv_id';
  if (assetType === 'plant') return 'plant_id';
  return 'van_id';
}

export function isRoadEligibleRegistration(registrationNumber?: string | null): boolean {
  if (!registrationNumber) return false;
  const normalized = registrationNumber.replace(/\s+/g, '').toUpperCase();
  if (!normalized) return false;
  return !TEST_REGISTRATIONS.has(normalized);
}

function toIsoDate(value: Date): string {
  return value.toISOString().split('T')[0];
}

function isPastDate(dateValue: string, now = new Date()): boolean {
  const dueDate = new Date(dateValue);
  dueDate.setHours(0, 0, 0, 0);

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  return dueDate.getTime() < today.getTime();
}

interface GenericMotRawData {
  motTests?: unknown[];
  motTestDueDate?: string | null;
}

export function isStaleHgvGenericMotDueDate(
  assetType: FleetAssetType,
  motExpiryData: Awaited<ReturnType<MotHistoryService['getMotExpiryData']>> | null,
  now = new Date()
): boolean {
  if (assetType !== 'hgv' || !motExpiryData?.motExpiryDate) return false;

  const rawData = motExpiryData.rawData as GenericMotRawData | null;
  const testCount = Array.isArray(rawData?.motTests) ? rawData.motTests.length : 0;
  const isFirstDueDate = rawData?.motTestDueDate === motExpiryData.motExpiryDate;

  return testCount === 0 && isFirstDueDate && isPastDate(motExpiryData.motExpiryDate, now);
}

/**
 * HGVs, PSVs, buses and trailers require annual tests from year 1.
 * Cars/vans get their first MOT after 3 years.
 */
function firstTestIntervalYears(assetType: FleetAssetType): number {
  return assetType === 'hgv' ? 1 : 3;
}

type VehicleMaintenanceUpsert = Database['public']['Tables']['vehicle_maintenance']['Insert'] & Record<string, unknown>;
type DvlaSyncLogInsert = Database['public']['Tables']['dvla_sync_log']['Insert'];
type MaintenanceHistoryInsert = Database['public']['Tables']['maintenance_history']['Insert'];

export async function runFleetDvlaSync(options: FleetSyncOptions): Promise<FleetSyncSummary> {
  const {
    supabase,
    dvlaService,
    motService,
    hgvAnnualTestService = null,
    targets,
    triggerType,
    triggeredBy,
    logPrefix = '',
    delayMsBetweenRequests = 0,
  } = options;

  const results: FleetSyncResultRow[] = [];
  let successCount = 0;
  let failCount = 0;
  let triggeredByProfileName: string | null = null;

  if (triggeredBy) {
    const { data: userProfile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', triggeredBy)
      .single();
    const typedProfile = userProfile as { full_name: string | null } | null;
    triggeredByProfileName = typedProfile?.full_name || null;
  }

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const startTime = Date.now();
    const fkField = fkForAssetType(target.assetType);
    const regNumberNoSpaces = formatRegistrationForApi(target.registrationNumber);
    const syncTime = new Date().toISOString();

    try {
      const dvlaData = await dvlaService.getVehicleData(regNumberNoSpaces);
      const dvlaResponseTime = Date.now() - startTime;
      console.log(`${logPrefix}[SYNC] Fetched DVLA for ${target.registrationNumber}`);

      type MotExpiryData =
        | Awaited<ReturnType<MotHistoryService['getMotExpiryData']>>
        | Awaited<ReturnType<HgvAnnualTestService['getMotExpiryData']>>;
      let motExpiryData: MotExpiryData | null = null;
      let motApiError: string | null = null;
      let motDataSource: 'MOT' | 'HGV_ANNUAL_TEST' | null = null;
      const selectedMotService = target.assetType === 'hgv' && hgvAnnualTestService
        ? hgvAnnualTestService
        : motService;

      if (selectedMotService) {
        motDataSource = target.assetType === 'hgv' && hgvAnnualTestService ? 'HGV_ANNUAL_TEST' : 'MOT';
        try {
          motExpiryData = await selectedMotService.getMotExpiryData(regNumberNoSpaces);
          console.log(
            `${logPrefix}[SYNC] ${motDataSource} API for ${target.registrationNumber} (${target.assetType}): ` +
            `status=${motExpiryData.motStatus}, expiry=${motExpiryData.motExpiryDate ?? 'none'}, ` +
            `tests=${(motExpiryData.rawData?.motTests || []).length}`
          );
        } catch (motError: unknown) {
          motApiError = getErrorMessage(motError);
          console.error(`${logPrefix}[SYNC] ${motDataSource} fetch failed for ${target.registrationNumber} (${target.assetType}):`, motApiError);
        }
      }

      const { data } = await supabase
        .from('vehicle_maintenance')
        .select('tax_due_date, mot_due_date')
        .eq(fkField, target.assetId)
        .single();

      type MaintenanceTaxMot = { tax_due_date?: string | null; mot_due_date?: string | null };
      const existingRecord = data as MaintenanceTaxMot | null;
      const oldTaxDate = existingRecord?.tax_due_date ?? null;
      const oldMotDate = existingRecord?.mot_due_date ?? null;

      const updates: Record<string, unknown> = {
        dvla_sync_status: 'success',
        last_dvla_sync: syncTime,
        dvla_sync_error: null,
        dvla_raw_data: dvlaData.rawData || null,
        ves_make: dvlaData.make || null,
        ves_colour: dvlaData.colour || null,
        ves_fuel_type: dvlaData.fuelType || null,
        ves_year_of_manufacture: dvlaData.yearOfManufacture || null,
        ves_engine_capacity: dvlaData.engineSize || null,
        ves_tax_status: dvlaData.taxStatus || null,
        ves_mot_status: dvlaData.motStatus || null,
        ves_co2_emissions: dvlaData.co2Emissions || null,
        ves_euro_status: dvlaData.euroStatus || null,
        ves_real_driving_emissions: dvlaData.realDrivingEmissions || null,
        ves_type_approval: dvlaData.typeApproval || null,
        ves_wheelplan: dvlaData.wheelplan || null,
        ves_revenue_weight: dvlaData.revenueWeight || null,
        ves_marked_for_export: dvlaData.markedForExport || false,
        ves_month_of_first_registration: dvlaData.monthOfFirstRegistration || null,
        ves_date_of_last_v5c_issued: dvlaData.dateOfLastV5CIssued || null,
      };

      const fieldsUpdated: string[] = [];

      if (dvlaData.taxDueDate) {
        updates.tax_due_date = dvlaData.taxDueDate;
        if (oldTaxDate !== dvlaData.taxDueDate) fieldsUpdated.push('tax_due_date');
      }

      if (selectedMotService) {
        if (motApiError) {
          updates.mot_api_sync_status = 'error';
          updates.last_mot_api_sync = syncTime;
          updates.mot_api_sync_error = motApiError;

          // Fallback: estimate test due date from first registration.
          // HGVs need annual tests from year 1; cars/vans get first MOT after 3 years.
          if (target.assetType !== 'hgv' && motApiError.includes('No MOT history found') && dvlaData.monthOfFirstRegistration) {
            try {
              const [year, month] = dvlaData.monthOfFirstRegistration.split('.');
              if (year && month) {
                const intervalYears = firstTestIntervalYears(target.assetType);
                const firstRegDate = new Date(parseInt(year, 10), parseInt(month, 10) - 1, 1);
                const nextDue = new Date(firstRegDate);
                nextDue.setFullYear(nextDue.getFullYear() + intervalYears);
                const calculatedMotDue = toIsoDate(nextDue);
                updates.mot_due_date = calculatedMotDue;
                updates.mot_expiry_date = calculatedMotDue;
                updates.mot_first_used_date = toIsoDate(firstRegDate);
                if (oldMotDate !== calculatedMotDue) {
                  fieldsUpdated.push('mot_due_date (calculated from DVLA)');
                }
              }
            } catch (error) {
              console.error(`${logPrefix}[SYNC] Failed MOT fallback calculation`, error);
            }
          }
        } else if (motExpiryData?.motExpiryDate || motExpiryData?.rawData) {
          const motRawData = motExpiryData.rawData as unknown as Record<string, unknown> | null;
          const isRejectedStaleHgvDate = motDataSource === 'MOT' && isStaleHgvGenericMotDueDate(
            target.assetType,
            motExpiryData as Awaited<ReturnType<MotHistoryService['getMotExpiryData']>>
          );

          if (motRawData) {
            updates.mot_make = (motRawData.make as string) || null;
            updates.mot_model = (motRawData.model as string) || null;
            updates.mot_fuel_type = (motRawData.fuelType as string) || null;
            updates.mot_primary_colour = (motRawData.primaryColour as string) || null;
            updates.mot_registration = (motRawData.registration as string) || null;
            const manufactureYear = motRawData.manufactureYear as string | undefined;
            if (manufactureYear) {
              updates.mot_year_of_manufacture = parseInt(manufactureYear, 10);
            }
            const firstUsedDate = motRawData.firstUsedDate as string | undefined;
            if (firstUsedDate) {
              updates.mot_first_used_date = firstUsedDate;
            }
          }

          if (isRejectedStaleHgvDate) {
            updates.mot_api_sync_error = 'Generic MOT History API returned a stale HGV first annual-test due date; configure the HGV annual-test API source.';
            if (oldMotDate === motExpiryData.motExpiryDate) {
              updates.mot_due_date = null;
              updates.mot_expiry_date = null;
              fieldsUpdated.push('mot_due_date (cleared stale HGV generic MOT date)');
            }
          } else if (motExpiryData.motExpiryDate) {
            updates.mot_due_date = motExpiryData.motExpiryDate;
            updates.mot_expiry_date = motExpiryData.motExpiryDate;
            if (oldMotDate !== motExpiryData.motExpiryDate) {
              fieldsUpdated.push(motDataSource === 'HGV_ANNUAL_TEST' ? 'mot_due_date (HGV annual test)' : 'mot_due_date');
            }
          } else if (motRawData?.firstUsedDate) {
            const firstUsedRaw = motRawData.firstUsedDate as string | undefined;
            if (target.assetType !== 'hgv' && firstUsedRaw) {
              const intervalYears = firstTestIntervalYears(target.assetType);
              const firstUsedDate = new Date(firstUsedRaw);
              const nextDue = new Date(firstUsedDate);
              nextDue.setFullYear(nextDue.getFullYear() + intervalYears);
              const calculatedMotDue = toIsoDate(nextDue);
              updates.mot_due_date = calculatedMotDue;
              updates.mot_expiry_date = calculatedMotDue;
              if (oldMotDate !== calculatedMotDue) fieldsUpdated.push('mot_due_date (calculated)');
            }
          }

          updates.mot_api_sync_status = 'success';
          updates.last_mot_api_sync = syncTime;
          if (!updates.mot_api_sync_error) updates.mot_api_sync_error = null;
          updates.mot_raw_data = motRawData || null;
        } else {
          updates.mot_api_sync_status = 'success';
          updates.last_mot_api_sync = syncTime;
          updates.mot_api_sync_error = 'No MOT history found';
          updates.mot_raw_data = motExpiryData?.rawData || null;
        }
      }

      const vmTable = supabase.from('vehicle_maintenance') as unknown as {
        upsert: (values: VehicleMaintenanceUpsert, opts?: { onConflict?: string }) => Promise<{ error: { message: string } | null }>;
      };
      const { error: upsertError } = await vmTable.upsert(
        {
          [fkField]: target.assetId,
          ...updates,
          updated_at: syncTime,
        } as VehicleMaintenanceUpsert,
        { onConflict: fkField }
      );
      if (upsertError) throw upsertError;

      const hasMotDueDateUpdate = Object.prototype.hasOwnProperty.call(updates, 'mot_due_date');
      const persistedMotDate = hasMotDueDateUpdate ? (updates.mot_due_date as string | null) : oldMotDate;
      const apiProvider = [
        process.env.DVLA_API_PROVIDER,
        motDataSource,
      ].filter(Boolean).join('+');
      const dslTable = supabase.from('dvla_sync_log') as unknown as {
        insert: (values: DvlaSyncLogInsert) => Promise<{ error: { message: string } | null }>;
      };
      await dslTable.insert({
        [fkField]: target.assetId,
        registration_number: target.registrationNumber,
        sync_status: 'success',
        fields_updated: fieldsUpdated,
        tax_due_date_old: oldTaxDate,
        tax_due_date_new: dvlaData.taxDueDate,
        mot_due_date_old: oldMotDate,
        mot_due_date_new: persistedMotDate,
        api_provider: apiProvider || undefined,
        api_response_time_ms: dvlaResponseTime,
        raw_response: {
          dvla: dvlaData.rawData,
          mot: motExpiryData?.rawData ?? null,
        },
        triggered_by: triggeredBy,
        trigger_type: triggerType,
      } as DvlaSyncLogInsert);

      let updaterName = triggerType === 'automatic' ? 'Scheduled DVLA Sync' : 'DVLA API Sync';
      if (triggeredByProfileName) {
        updaterName = `${triggeredByProfileName} (via DVLA Sync)`;
      }

      const historyEntries: Array<Record<string, unknown>> = [];
      if (dvlaData.taxDueDate && oldTaxDate !== dvlaData.taxDueDate) {
        historyEntries.push({
          [fkField]: target.assetId,
          field_name: 'tax_due_date',
          old_value: oldTaxDate,
          new_value: dvlaData.taxDueDate,
          value_type: 'date',
          comment:
            triggerType === 'automatic'
              ? `Tax due date updated automatically via scheduled DVLA API sync for ${target.registrationNumber}`
              : `Tax due date updated automatically via DVLA API sync for ${target.registrationNumber}`,
          updated_by: triggeredBy,
          updated_by_name: updaterName,
        });
      }

      if (hasMotDueDateUpdate && oldMotDate !== persistedMotDate) {
        const wasCalculated = fieldsUpdated.some((f) => f.includes('calculated'));
        const wasClearedStaleHgvDate = fieldsUpdated.some((f) => f.includes('cleared stale HGV'));
        historyEntries.push({
          [fkField]: target.assetId,
          field_name: 'mot_due_date',
          old_value: oldMotDate,
          new_value: persistedMotDate,
          value_type: 'date',
          comment: wasClearedStaleHgvDate
            ? `Stale HGV MOT due date cleared after generic MOT API returned an out-of-date first annual-test date for ${target.registrationNumber}`
            : wasCalculated
              ? `MOT due date calculated from first registration via DVLA API sync for ${target.registrationNumber}`
              : motDataSource === 'HGV_ANNUAL_TEST'
                ? `MOT due date updated automatically via HGV annual-test API sync for ${target.registrationNumber}`
                : `MOT due date updated automatically via DVLA/MOT API sync for ${target.registrationNumber}`,
          updated_by: triggeredBy,
          updated_by_name: updaterName,
        });
      }

      if (historyEntries.length > 0) {
        const mhTable = supabase.from('maintenance_history') as unknown as {
          insert: (values: MaintenanceHistoryInsert[]) => Promise<{ error: { message: string } | null }>;
        };
        const { error: historyError } = await mhTable.insert(historyEntries as MaintenanceHistoryInsert[]);
        if (historyError) {
          console.error(`${logPrefix}[SYNC] Failed to write maintenance history`, historyError);
        }
      }

      results.push({
        success: true,
        assetType: target.assetType,
        assetId: target.assetId,
        vehicleId: target.assetId,
        registrationNumber: target.registrationNumber,
        updatedFields: fieldsUpdated,
        fields_updated: fieldsUpdated,
        syncedAt: syncTime,
      });
      successCount++;
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      console.error(`${logPrefix}[SYNC] Failed ${target.registrationNumber}:`, errorMessage);

      const vmTableErr = supabase.from('vehicle_maintenance') as unknown as {
        upsert: (values: VehicleMaintenanceUpsert, opts?: { onConflict?: string }) => Promise<{ error: { message: string } | null }>;
      };
      await vmTableErr.upsert(
        {
          [fkField]: target.assetId,
          dvla_sync_status: 'error',
          dvla_sync_error: errorMessage,
          last_dvla_sync: syncTime,
          updated_at: syncTime,
        } as VehicleMaintenanceUpsert,
        { onConflict: fkField }
      );

      const dslTableErr = supabase.from('dvla_sync_log') as unknown as {
        insert: (values: DvlaSyncLogInsert) => Promise<{ error: { message: string } | null }>;
      };
      await dslTableErr.insert({
        [fkField]: target.assetId,
        registration_number: target.registrationNumber,
        sync_status: 'error',
        error_message: errorMessage,
        api_provider: process.env.DVLA_API_PROVIDER ?? undefined,
        triggered_by: triggeredBy,
        trigger_type: triggerType,
      } as DvlaSyncLogInsert);

      results.push({
        success: false,
        assetType: target.assetType,
        assetId: target.assetId,
        vehicleId: target.assetId,
        registrationNumber: target.registrationNumber,
        errors: [errorMessage],
        error: errorMessage,
        syncedAt: syncTime,
      });
      failCount++;
    }

    if (delayMsBetweenRequests > 0 && i < targets.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMsBetweenRequests));
    }
  }

  return {
    total: targets.length,
    successful: successCount,
    failed: failCount,
    results,
  };
}
