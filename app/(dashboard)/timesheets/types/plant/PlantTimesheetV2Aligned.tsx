'use client';

import { Fragment, useEffect, useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { fetchUserDirectory } from '@/lib/client/user-directory';
import { useTimesheetJobCodeOptions } from '@/lib/client/timesheet-job-codes';
import { fetchCurrentWorkShift, fetchEmployeeWorkShift } from '@/lib/client/work-shifts';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DidNotWorkReasonDialog, type DidNotWorkReasonDecision } from '@/components/timesheets/DidNotWorkReasonDialog';
import { JobCodeFields } from '@/components/timesheets/JobCodeFields';
import { MobileNumericTimeInput } from '@/components/timesheets/MobileNumericTimeInput';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageLoader } from '@/components/ui/page-loader';
import { AlertCircle, ArrowLeft, Check, Home, Moon, Save, User, Wrench, XCircle } from 'lucide-react';
import { DAY_NAMES } from '@/types/timesheet';
import { formatHours, roundTimeToNearestQuarterHour } from '@/lib/utils/time-calculations';
import { SignaturePad } from '@/components/forms/SignaturePad';
import { Database } from '@/types/database';
import { isAdminRole } from '@/lib/utils/role-access';
import { getErrorStatus, isAuthErrorStatus, isNetworkFetchError } from '@/lib/utils/http-error';
import { Employee } from '@/types/common';
import { toast } from 'sonner';
import { TrainingDeclineDialog } from '../../components/TrainingDeclineDialog';
import { declineTrainingBookingsClient } from '@/lib/client/training-bookings';
import { notifyTimesheetDidNotWorkExceptions } from '@/lib/client/timesheet-did-not-work-notifications';
import {
  getRecentVehicleIds,
  recordRecentVehicleId,
  splitVehiclesByRecent,
} from '@/lib/utils/recentVehicles';
import { getRecentTextValues, recordRecentTextValue } from '@/lib/utils/recentTextValues';
import {
  type ApprovedAbsenceForTimesheet,
  isWorkWindowOvernight,
  type TimesheetDidNotWorkReason,
  type TimesheetEntryLike,
  type TimesheetOffDayState,
  getTimesheetEntryDateFromWeekEnding,
  getTimesheetWeekIsoBounds,
  isTimeWithinWorkWindow,
  normalizeTimesheetEntriesForOffDays,
  resolveTimesheetOffDayStates,
} from '@/lib/utils/timesheet-off-days';
import { buildLeaveAwareTotals, formatLeaveAwareWeeklyDisplayMultiline } from '@/lib/utils/timesheet-leave-totals';
import {
  formatDidNotWorkReasonRemark,
  getMissingScheduledDidNotWorkReasonException,
  isScheduledWorkingDayDidNotWork,
  parseDidNotWorkReasonRemark,
} from '@/lib/utils/timesheet-did-not-work-exceptions';
import {
  areCataloguedJobNumbers,
  getEntryJobNumbers,
  getNormalizedJobNumbers,
  getPrimaryJobNumber,
  normalizeJobNumberInput,
} from '@/lib/utils/timesheet-job-codes';
import {
  hasWorkedTimesForSubsistence,
  isSubsistencePaymentRequired,
  syncSubsistenceRemark,
} from '@/lib/utils/timesheet-subsistence';
import { isDuplicateTimesheetWeekError } from '@/lib/utils/timesheet-errors';
import {
  applyPendingTrainingBookingsToOffDayStates,
  formatHalfDayTrainingRemark,
  getHalfDayTrainingRemarkForOffDayState,
  getPendingDidNotWorkBookingsPayload,
  getPendingDidNotWorkTrainingBooking,
  isHalfDayTrainingSession,
  type DidNotWorkTrainingSession,
  type PendingDidNotWorkBooking,
  type PendingDidNotWorkBookingMap,
} from '@/lib/utils/timesheet-did-not-work-bookings';
import { commitTimesheetDidNotWorkBookings } from '@/lib/client/timesheet-did-not-work-bookings';
import type { WorkShiftPattern } from '@/types/work-shifts';
import {
  buildValidationErrors,
  createBlankEntry,
  getMachineMirrorUpdates,
  isPlantEntryComplete,
  parseHoursInput,
  recalculateEntry,
  toHoursInput,
  type PlantEntryDraft,
  type RecalculateEntryOptions,
} from './plant-timesheet-v2-utils';

interface PlantTimesheetV2Props {
  weekEnding: string;
  existingId: string | null;
  userId?: string;
  onSelectedEmployeeChange?: (employeeId: string) => void;
}

interface PlantAsset {
  id: string;
  plant_id: string;
  nickname?: string | null;
  van_categories?: { name: string } | null;
  [key: string]: unknown;
}

const HIRED_PLANT_SENTINEL = '__hired_plant__';
const NO_MACHINE_SENTINEL = '__no_machine__';
const HIRER_RECENT_SCOPE = 'timesheet_plant_hirer';
const SITE_ADDRESS_RECENT_SCOPE = 'timesheet_plant_site_address';
const QUARTER_HOUR_TIME_FIELDS: ReadonlySet<keyof PlantEntryDraft> = new Set([
  'time_started',
  'time_finished',
  'machine_start_time',
  'machine_finish_time',
]);

const createBlankPlantWeekEntries = (): PlantEntryDraft[] =>
  Array.from({ length: 7 }, (_, index) => createBlankEntry(index + 1));

function formatLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDerivedHours(value: number | null): string {
  if (value === null) return '';
  return value.toFixed(2);
}

function getLeaveLabelStyle(color: string | null | undefined): CSSProperties | undefined {
  if (!color) return undefined;
  return { color };
}

function getDidNotWorkAutoLabel(dayOffState: TimesheetOffDayState | undefined): string {
  if (dayOffState?.isOnApprovedLeave) {
    return dayOffState.leaveLabels[0]?.label || dayOffState.leaveReasonName || 'Approved Leave';
  }

  if (dayOffState && !dayOffState.isExpectedShiftDay) {
    return 'Not on Shift';
  }

  return 'Did Not Work';
}

function getDidNotWorkAutoStyle(dayOffState: TimesheetOffDayState | undefined): CSSProperties | undefined {
  if (!dayOffState?.isOnApprovedLeave || !dayOffState.leaveReasonColor) return undefined;

  return {
    color: dayOffState.leaveReasonColor,
  };
}

function getTrainingLabel(dayOffState: TimesheetOffDayState | undefined): string {
  return dayOffState?.trainingDisplayRemarks || dayOffState?.trainingLabels[0]?.label || 'Training';
}

function getPendingTrainingLabel(dayOffState: TimesheetOffDayState | undefined): string {
  return dayOffState?.pendingTrainingDisplayRemarks || dayOffState?.pendingTrainingLabels[0]?.label || 'Training pending approval';
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function buildWorkWindowValidationErrors(
  entries: PlantEntryDraft[],
  offDayMap: Map<number, TimesheetOffDayState>
): Record<number, string> {
  const errors: Record<number, string> = {};

  entries.forEach((entry, index) => {
    const offDayState = offDayMap.get(index + 1);
    const workWindow = offDayState?.workWindow;
    if (!workWindow || entry.did_not_work) return;

    const invalidFields: string[] = [];
    if (entry.time_started && !isTimeWithinWorkWindow(entry.time_started, workWindow)) invalidFields.push('Operator start');
    if (entry.time_finished && !isTimeWithinWorkWindow(entry.time_finished, workWindow)) invalidFields.push('Operator finish');
    if (entry.machine_start_time && !isTimeWithinWorkWindow(entry.machine_start_time, workWindow)) invalidFields.push('Machine start');
    if (entry.machine_finish_time && !isTimeWithinWorkWindow(entry.machine_finish_time, workWindow)) invalidFields.push('Machine finish');

    if (invalidFields.length > 0) {
      errors[index] = `${DAY_NAMES[index]}: ${invalidFields.join(', ')} must be between ${workWindow.start} and ${workWindow.end}.`;
    }
  });

  return errors;
}

function buildJobNumberValidationErrors(
  entries: PlantEntryDraft[],
  offDayMap: Map<number, TimesheetOffDayState>,
  cataloguedJobNumbers: ReadonlySet<string>
): Record<number, string> {
  const errors: Record<number, string> = {};

  entries.forEach((entry, index) => {
    const offDay = offDayMap.get(index + 1);
    const hasHours = Boolean(entry.time_started && entry.time_finished);

    if (offDay?.isOnApprovedLeave && !hasHours) return;
    if (offDay?.hasTrainingBooking) return;
    if (entry.did_not_work || entry.working_in_yard || !hasHours) return;

    if (!areCataloguedJobNumbers(entry.job_numbers, cataloguedJobNumbers)) {
      errors[index] = `${DAY_NAMES[index]}: Select at least one valid Job Number from the job-code list and do not repeat the same code on a single day.`;
    }
  });

  return errors;
}

function mergeValidationErrors(...sources: Record<number, string>[]): Record<number, string> {
  const merged: Record<number, string> = {};

  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      const idx = Number(key);
      if (!Number.isFinite(idx)) continue;
      if (!merged[idx]) {
        merged[idx] = value;
        continue;
      }
      merged[idx] = `${merged[idx]} ${value}`;
    }
  }

  return merged;
}

function getRecalculateOptionsForOffDay(
  offDayState: TimesheetOffDayState | undefined,
  options?: { preserveDailyTotal?: boolean }
): RecalculateEntryOptions {
  if (options?.preserveDailyTotal) {
    return { preserveDailyTotal: true };
  }

  if (!offDayState?.isOnApprovedLeave) {
    return {};
  }

  return {
    paidLeaveHours: offDayState.paidLeaveHours,
    isLeaveLocked: offDayState.isLeaveLocked,
  };
}

function applyOffDayDefaults(entries: PlantEntryDraft[], offDayStates: TimesheetOffDayState[]): PlantEntryDraft[] {
  const normalized = normalizeTimesheetEntriesForOffDays(
    entries as unknown as TimesheetEntryLike[],
    offDayStates,
    {
      enforceLeaveOverwrite: true,
      applyNonShiftDefaults: true,
    }
  ) as unknown as PlantEntryDraft[];

  const offDayByDay = new Map(offDayStates.map((state) => [state.day_of_week, state] as const));

  return normalized.map((entry) => {
    const offDayState = offDayByDay.get(entry.day_of_week);
    const options = getRecalculateOptionsForOffDay(offDayState, { preserveDailyTotal: offDayState?.isOnApprovedLeave });
    return recalculateEntry(entry, options);
  });
}

export function PlantTimesheetV2({
  weekEnding: initialWeekEnding,
  existingId: initialExistingId,
  userId: managerSelectedUserId,
  onSelectedEmployeeChange,
}: PlantTimesheetV2Props) {
  const router = useRouter();
  const { user, profile, loading: authLoading, isManager, isAdmin, isSuperAdmin } = useAuth();
  const { options: jobCodeOptions, isLoading: jobCodeOptionsLoading } = useTimesheetJobCodeOptions();
  const cataloguedJobNumbers = useMemo(
    () => new Set(jobCodeOptions.map((option) => option.value)),
    [jobCodeOptions]
  );
  const supabase = useMemo(() => createClient(), []);
  const hasElevatedPermissions = isSuperAdmin || isManager || isAdmin;

  const [existingTimesheetId, setExistingTimesheetId] = useState<string | null>(initialExistingId);
  const [weekEnding, setWeekEnding] = useState(initialWeekEnding || '');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>(managerSelectedUserId || '');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);

  const [plants, setPlants] = useState<PlantAsset[]>([]);
  const [loadingPlants, setLoadingPlants] = useState(true);
  const [recentPlantIds, setRecentPlantIds] = useState<string[]>([]);

  const [selectedPlantId, setSelectedPlantId] = useState('');
  const [isHiredPlant, setIsHiredPlant] = useState(false);
  const [hiredPlantIdSerial, setHiredPlantIdSerial] = useState('');
  const [hiredPlantDescription, setHiredPlantDescription] = useState('');
  const [hiredPlantHiringCompany, setHiredPlantHiringCompany] = useState('');
  const [pendingExistingMachineReg, setPendingExistingMachineReg] = useState('');

  const [siteAddress, setSiteAddress] = useState('');
  const [hirerName, setHirerName] = useState('');
  const [recentSiteAddresses, setRecentSiteAddresses] = useState<string[]>([]);
  const [recentHirerNames, setRecentHirerNames] = useState<string[]>([]);
  const [managerComments, setManagerComments] = useState('');

  const [entries, setEntries] = useState<PlantEntryDraft[]>(
    createBlankPlantWeekEntries()
  );
  const [activeDay, setActiveDay] = useState('0');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [existingTimesheetLoaded, setExistingTimesheetLoaded] = useState(!initialExistingId);
  const [timeErrors, setTimeErrors] = useState<Record<number, string>>({});
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [showSignatureDialog, setShowSignatureDialog] = useState(false);

  const [offDayStates, setOffDayStates] = useState<TimesheetOffDayState[]>([]);
  const [offDayKey, setOffDayKey] = useState('');
  const [loadingOffDays, setLoadingOffDays] = useState(true);
  const [offDayRefreshToken, setOffDayRefreshToken] = useState(0);
  const [trainingDeclineDayIndex, setTrainingDeclineDayIndex] = useState<number | null>(null);
  const [decliningTraining, setDecliningTraining] = useState(false);
  const [didNotWorkReasonDayIndex, setDidNotWorkReasonDayIndex] = useState<number | null>(null);
  const [pendingDidNotWorkBookings, setPendingDidNotWorkBookings] = useState<PendingDidNotWorkBookingMap>({});

  const currentOffDayKey = selectedEmployeeId && weekEnding ? `${selectedEmployeeId}:${weekEnding}` : '';
  const effectiveOffDayStates = useMemo(
    () => applyPendingTrainingBookingsToOffDayStates(offDayStates, pendingDidNotWorkBookings),
    [offDayStates, pendingDidNotWorkBookings]
  );
  const offDayMap = useMemo(
    () =>
      offDayKey === currentOffDayKey
        ? new Map(effectiveOffDayStates.map((state) => [state.day_of_week, state] as const))
        : new Map<number, TimesheetOffDayState>(),
    [currentOffDayKey, effectiveOffDayStates, offDayKey]
  );

  const leaveAwareTotals = useMemo(
    () => buildLeaveAwareTotals(entries, effectiveOffDayStates),
    [effectiveOffDayStates, entries]
  );
  const weeklyTotalMultiline = formatLeaveAwareWeeklyDisplayMultiline(
    leaveAwareTotals.weekly.workedHours,
    leaveAwareTotals.weekly.leaveDays
  );

  const selectedPlant = useMemo(
    () => plants.find((item) => item.id === selectedPlantId) || null,
    [plants, selectedPlantId]
  );

  const selectedEmployeeName = useMemo(() => {
    if (!selectedEmployeeId) return profile?.full_name || '';
    if (selectedEmployeeId === user?.id) return profile?.full_name || '';
    return employees.find((employee) => employee.id === selectedEmployeeId)?.full_name || '';
  }, [employees, profile?.full_name, selectedEmployeeId, user?.id]);

  const getDayDate = (dayIndex: number): Date =>
    getTimesheetEntryDateFromWeekEnding(weekEnding, dayIndex + 1);

  function buildPendingDidNotWorkBooking(
    dayIndex: number,
    kind: PendingDidNotWorkBooking['kind'],
    trainingSession?: DidNotWorkTrainingSession
  ): PendingDidNotWorkBooking {
    return {
      dayOfWeek: dayIndex + 1,
      dayName: DAY_NAMES[dayIndex] || `Day ${dayIndex + 1}`,
      date: formatLocalIsoDate(getDayDate(dayIndex)),
      kind,
      ...(trainingSession ? { trainingSession } : {}),
    };
  }

  function queuePendingDidNotWorkBooking(booking: PendingDidNotWorkBooking) {
    setPendingDidNotWorkBookings((current) => ({
      ...current,
      [booking.dayOfWeek - 1]: booking,
    }));
  }

  function removePendingDidNotWorkBooking(dayIndex: number) {
    setPendingDidNotWorkBookings((current) => {
      if (!current[dayIndex]) return current;
      const next = { ...current };
      delete next[dayIndex];
      return next;
    });
  }

  function hasPendingTrainingBooking(dayIndex: number): boolean {
    return Boolean(getPendingDidNotWorkTrainingBooking(pendingDidNotWorkBookings, dayIndex));
  }

  const machineSelectValue = useMemo(() => {
    if (isHiredPlant) return HIRED_PLANT_SENTINEL;
    if (selectedPlantId) return selectedPlantId;
    return NO_MACHINE_SENTINEL;
  }, [isHiredPlant, selectedPlantId]);

  useEffect(() => {
    if (!user?.id) return;

    setRecentPlantIds(getRecentVehicleIds(user.id, 'plant'));
    setRecentHirerNames(getRecentTextValues(user.id, HIRER_RECENT_SCOPE));
    setRecentSiteAddresses(getRecentTextValues(user.id, SITE_ADDRESS_RECENT_SCOPE));
  }, [user?.id]);

  useEffect(() => {
    if (!user || authLoading) return;
    let cancelled = false;

    const loadEmployees = async () => {
      if (!hasElevatedPermissions) {
        if (!cancelled) {
          setSelectedEmployeeId(user.id);
          setLoadingEmployees(false);
        }
        return;
      }

      setLoadingEmployees(true);
      try {
        const directory = await fetchUserDirectory({ module: 'timesheets' });
        if (cancelled) return;

        const formatted = directory.map((employee) => ({
          id: employee.id,
          full_name: employee.full_name || 'Unknown User',
          employee_id: employee.employee_id,
          has_module_access: employee.has_module_access,
        }));
        setEmployees(formatted);
        setSelectedEmployeeId((previous) => previous || managerSelectedUserId || user.id);
      } catch (fetchError) {
        if (!cancelled) {
          const message = fetchError instanceof Error ? fetchError.message : String(fetchError);
          const normalizedMessage = message.toLowerCase();
          const isNetworkFailure =
            message.includes('Failed to fetch') ||
            message.includes('NetworkError') ||
            normalizedMessage.includes('network');
          const isUnauthorized =
            normalizedMessage.includes('unauthorized') ||
            (normalizedMessage.includes('jwt') && normalizedMessage.includes('expired'));

          if (isNetworkFailure || isUnauthorized) {
            // Non-fatal: filters are optional and auth/session refresh can briefly return 401.
            setEmployees([]);
            console.warn('Unable to load employees (non-fatal):', fetchError);
          } else {
            console.error('Error fetching employees:', fetchError);
            setError('Failed to load employee list');
          }
        }
      } finally {
        if (!cancelled) setLoadingEmployees(false);
      }
    };

    void loadEmployees();

    return () => {
      cancelled = true;
    };
  }, [authLoading, hasElevatedPermissions, managerSelectedUserId, user]);

  useEffect(() => {
    if (!managerSelectedUserId) return;
    setSelectedEmployeeId((current) =>
      current === managerSelectedUserId ? current : managerSelectedUserId
    );
  }, [managerSelectedUserId]);

  useEffect(() => {
    setPendingDidNotWorkBookings({});
  }, [selectedEmployeeId, weekEnding]);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;

    const loadPlants = async () => {
      setLoadingPlants(true);
      try {
        const { data, error: plantsError } = await supabase
          .from('plant')
          .select(`
            id,
            plant_id,
            nickname,
            van_categories(name)
          `)
          .eq('status', 'active')
          .order('plant_id');

        if (plantsError) throw plantsError;
        if (cancelled) return;
        setPlants(((data || []) as PlantAsset[]).sort((a, b) => a.plant_id.localeCompare(b.plant_id)));
      } catch (plantsFetchError) {
        if (!cancelled) {
          console.error('Error fetching plants:', plantsFetchError);
          setError('Failed to load plant list');
        }
      } finally {
        if (!cancelled) setLoadingPlants(false);
      }
    };

    void loadPlants();

    return () => {
      cancelled = true;
    };
  }, [authLoading, supabase]);

  useEffect(() => {
    if (!initialExistingId || !user || !profile || authLoading) return;
    let cancelled = false;

    const loadExisting = async () => {
      setLoadingExisting(true);
      try {
        const { data: timesheetData, error: timesheetError } = await supabase
          .from('timesheets')
          .select('*')
          .eq('id', initialExistingId)
          .single();

        if (timesheetError) throw timesheetError;
        if (cancelled) return;

        const currentIsSuperAdmin =
          (profile as { super_admin?: boolean; role?: { is_super_admin?: boolean } } | null)?.super_admin ||
          profile?.role?.is_super_admin ||
          false;
        const currentIsManager = profile?.role?.is_manager_admin || false;
        const currentIsAdmin = isAdminRole(profile?.role);
        const currentHasElevatedPermissions = currentIsSuperAdmin || currentIsManager || currentIsAdmin;

        if (!currentHasElevatedPermissions && timesheetData.user_id !== user.id) {
          throw new Error('You do not have permission to edit this timesheet');
        }

        if (timesheetData.status !== 'draft' && timesheetData.status !== 'rejected') {
          router.push(`/timesheets/${initialExistingId}`);
          return;
        }

        setExistingTimesheetId(timesheetData.id);
        setWeekEnding(timesheetData.week_ending);
        setSelectedEmployeeId(timesheetData.user_id);
        setManagerComments(timesheetData.manager_comments || '');

        setSiteAddress(timesheetData.site_address || '');
        setHirerName(timesheetData.hirer_name || '');

        const hired = Boolean(timesheetData.is_hired_plant);
        setIsHiredPlant(hired);
        setHiredPlantIdSerial(timesheetData.hired_plant_id_serial || (hired ? timesheetData.reg_number || '' : ''));
        setHiredPlantDescription(timesheetData.hired_plant_description || '');
        setHiredPlantHiringCompany(timesheetData.hired_plant_hiring_company || '');
        setSelectedPlantId('');
        setPendingExistingMachineReg(hired ? '' : (timesheetData.reg_number || ''));

        const { data: entriesData, error: entriesError } = await supabase
          .from('timesheet_entries')
          .select('*, timesheet_entry_job_codes(job_number, display_order)')
          .eq('timesheet_id', timesheetData.id)
          .order('day_of_week');

        if (entriesError) throw entriesError;
        if (cancelled) return;

        const typedEntries = (entriesData || []) as Array<
          Database['public']['Tables']['timesheet_entries']['Row'] & {
            timesheet_entry_job_codes?: Array<{ job_number?: string | null; display_order?: number | null }> | null;
          }
        >;
        const fullWeek = Array.from({ length: 7 }, (_, index) => {
          const dayOfWeek = index + 1;
          const existingEntry = typedEntries.find((entry) => entry.day_of_week === dayOfWeek);
          if (!existingEntry) return createBlankEntry(dayOfWeek);

          const mappedEntry: PlantEntryDraft = {
            day_of_week: dayOfWeek,
            did_not_work: existingEntry.did_not_work || false,
            didNotWorkReason: null,
            job_number: getPrimaryJobNumber(existingEntry) || '',
            job_numbers: getEntryJobNumbers(existingEntry),
            working_in_yard: existingEntry.working_in_yard || false,
            subsistence_payment_required: isSubsistencePaymentRequired(existingEntry),
            time_started: existingEntry.time_started || '',
            time_finished: existingEntry.time_finished || '',
            operator_travel_hours: toHoursInput(existingEntry.operator_travel_hours),
            operator_yard_hours: toHoursInput(existingEntry.operator_yard_hours),
            operator_working_hours: existingEntry.operator_working_hours || null,
            daily_total: existingEntry.daily_total || null,
            machine_travel_hours: toHoursInput(existingEntry.machine_travel_hours),
            machine_start_time: existingEntry.machine_start_time || '',
            machine_finish_time: existingEntry.machine_finish_time || '',
            machine_working_hours: existingEntry.machine_working_hours || null,
            machine_standing_hours: toHoursInput(existingEntry.machine_standing_hours),
            machine_operator_hours: toHoursInput(existingEntry.machine_operator_hours),
            maintenance_breakdown_hours: toHoursInput(existingEntry.maintenance_breakdown_hours),
            remarks: existingEntry.remarks || '',
          };

          return recalculateEntry(mappedEntry);
        });

        setEntries(fullWeek);
      } catch (loadError) {
        if (!cancelled) {
          console.error('Error loading existing plant timesheet:', loadError);
          setError(loadError instanceof Error ? loadError.message : 'Failed to load timesheet');
        }
      } finally {
        if (!cancelled) {
          setLoadingExisting(false);
          setExistingTimesheetLoaded(true);
        }
      }
    };

    void loadExisting();

    return () => {
      cancelled = true;
    };
  }, [authLoading, initialExistingId, profile, router, supabase, user]);

  useEffect(() => {
    if (isHiredPlant) return;
    if (!pendingExistingMachineReg) return;
    if (!plants.length) return;

    const matchedPlant = plants.find((plant) => plant.plant_id === pendingExistingMachineReg);
    setSelectedPlantId(matchedPlant?.id || '');
    setPendingExistingMachineReg('');
  }, [isHiredPlant, pendingExistingMachineReg, plants]);

  useEffect(() => {
    if (isHiredPlant || !plants.length || !selectedPlantId) return;
    const selected = plants.find((plant) => plant.id === selectedPlantId);
    if (!selected) return;
  }, [isHiredPlant, plants, selectedPlantId]);

  useEffect(() => {
    if (!user || !selectedEmployeeId || !weekEnding) {
      setLoadingOffDays(true);
      return;
    }

    const requestKey = `${selectedEmployeeId}:${weekEnding}`;
    let cancelled = false;

    const loadOffDays = async () => {
      setLoadingOffDays(true);
      try {
        const { startIso, endIso } = getTimesheetWeekIsoBounds(weekEnding);
        const absenceResult = await supabase
          .from('absences')
          .select('id, date, end_date, status, is_half_day, half_day_session, allow_timesheet_work_on_leave, absence_reasons(name,color,is_paid)')
          .eq('profile_id', selectedEmployeeId)
          .in('status', ['pending', 'approved', 'processed'])
          .lte('date', endIso);

        if (absenceResult.error) throw absenceResult.error;
        if (cancelled) return;

        const filteredAbsences = ((absenceResult.data || []) as ApprovedAbsenceForTimesheet[]).filter((row) => {
          const rowEnd = row.end_date || row.date;
          return row.date <= endIso && rowEnd >= startIso;
        });

        let resolvedPattern: WorkShiftPattern | null = null;
        try {
          const workShiftData =
            selectedEmployeeId === user.id
              ? await fetchCurrentWorkShift()
              : await fetchEmployeeWorkShift(selectedEmployeeId);
          resolvedPattern = (workShiftData?.pattern as WorkShiftPattern | null) || null;
        } catch (workShiftError) {
          console.warn('Failed to load work shift pattern for plant timesheet off-day defaults:', workShiftError);
        }

        if (cancelled) return;

        const resolvedStates = resolveTimesheetOffDayStates(
          weekEnding,
          filteredAbsences,
          resolvedPattern
        );

        if (cancelled) return;
        setOffDayStates(resolvedStates);
        setOffDayKey(requestKey);
      } catch (offDayError) {
        console.error('Failed to resolve timesheet off-day states:', offDayError);
        if (!cancelled) {
          setOffDayStates(resolveTimesheetOffDayStates(weekEnding, [], null));
          setOffDayKey(requestKey);
        }
      } finally {
        if (!cancelled) {
          setLoadingOffDays(false);
        }
      }
    };

    void loadOffDays();

    return () => {
      cancelled = true;
    };
  }, [offDayRefreshToken, selectedEmployeeId, supabase, user, weekEnding]);

  useEffect(() => {
    if (!existingTimesheetLoaded) return;
    if (!currentOffDayKey || offDayKey !== currentOffDayKey || effectiveOffDayStates.length === 0) return;
    setEntries((previous) => applyOffDayDefaults(previous, effectiveOffDayStates));
  }, [currentOffDayKey, effectiveOffDayStates, existingTimesheetLoaded, offDayKey]);

  useEffect(() => {
    const nextErrors: Record<number, string> = {};

    entries.forEach((entry, index) => {
      if (entry.did_not_work || !entry.time_started || !entry.time_finished) return;

      if (entry.time_started === entry.time_finished) {
        nextErrors[index] = 'Start and finish times cannot be the same';
        return;
      }

      const workWindow = offDayMap.get(index + 1)?.workWindow;
      if (
        workWindow &&
        !isWorkWindowOvernight(workWindow) &&
        toMinutes(entry.time_finished) < toMinutes(entry.time_started)
      ) {
        nextErrors[index] = 'Finish time must be after start time for half-day leave bookings';
        return;
      }
      if (!workWindow) return;

      if (
        !isTimeWithinWorkWindow(entry.time_started, workWindow) ||
        !isTimeWithinWorkWindow(entry.time_finished, workWindow)
      ) {
        nextErrors[index] = `Time must be between ${workWindow.start} and ${workWindow.end} for this leave booking`;
      }
    });

    setTimeErrors(nextErrors);
  }, [entries, offDayMap]);

  const commitRecentHeaderValues = () => {
    if (!user?.id) return;
    if (hirerName.trim().length > 0) {
      setRecentHirerNames(recordRecentTextValue(user.id, HIRER_RECENT_SCOPE, hirerName));
    }
    if (siteAddress.trim().length > 0) {
      setRecentSiteAddresses(recordRecentTextValue(user.id, SITE_ADDRESS_RECENT_SCOPE, siteAddress));
    }
  };

  const getOffDayForIndex = (dayIndex: number): TimesheetOffDayState | undefined =>
    offDayMap.get(dayIndex + 1);

  const handleTrainingStatusToggle = (dayIndex: number) => {
    if (hasPendingTrainingBooking(dayIndex)) {
      removePendingDidNotWorkBooking(dayIndex);
      toast.success('Training booking selection removed.');
      return;
    }

    const dayOffState = getOffDayForIndex(dayIndex);
    if (!dayOffState?.hasTrainingBooking) return;
    setTrainingDeclineDayIndex(dayIndex);
  };

  const handleCancelTrainingDecline = () => {
    if (decliningTraining) return;
    setTrainingDeclineDayIndex(null);
  };

  const handleConfirmTrainingDecline = async () => {
    if (trainingDeclineDayIndex === null) return;
    const dayOffState = getOffDayForIndex(trainingDeclineDayIndex);
    if (!dayOffState?.trainingAbsenceIds.length) {
      setTrainingDeclineDayIndex(null);
      return;
    }

    setDecliningTraining(true);
    try {
      await declineTrainingBookingsClient({
        absenceIds: dayOffState.trainingAbsenceIds,
      });
      toast.success('Training booking removed and notifications sent.');
      setTrainingDeclineDayIndex(null);
      setOffDayRefreshToken((value) => value + 1);
    } catch (trainingError) {
      const message =
        trainingError instanceof Error ? trainingError.message : 'Failed to remove training booking';
      toast.error(message);
    } finally {
      setDecliningTraining(false);
    }
  };

  const updateEntryField = (dayIndex: number, field: keyof PlantEntryDraft, value: string | boolean) => {
    const normalizedValue =
      typeof value === 'string' && QUARTER_HOUR_TIME_FIELDS.has(field)
        ? roundTimeToNearestQuarterHour(value)
        : value;

    setEntries((current) => {
      const next = [...current];
      const offDayState = getOffDayForIndex(dayIndex);
      const currentEntry = next[dayIndex];
      const machineMirrorUpdates =
        typeof normalizedValue === 'string' && (field === 'time_started' || field === 'time_finished')
          ? getMachineMirrorUpdates(currentEntry, field, normalizedValue)
          : {};
      let updated = recalculateEntry({
        ...currentEntry,
        [field]: normalizedValue,
        ...machineMirrorUpdates,
      } as PlantEntryDraft, getRecalculateOptionsForOffDay(offDayState));
      if (
        (field === 'time_started' || field === 'time_finished') &&
        !hasWorkedTimesForSubsistence(updated)
      ) {
        updated = {
          ...updated,
          subsistence_payment_required: false,
          remarks: syncSubsistenceRemark(updated.remarks, false),
        };
      }
      next[dayIndex] = updated;
      return next;
    });
  };

  const updateEntry = (dayIndex: number, updates: Partial<PlantEntryDraft>) => {
    setEntries((current) => {
      const next = [...current];
      const offDayState = getOffDayForIndex(dayIndex);
      let updated = recalculateEntry({
        ...next[dayIndex],
        ...updates,
      }, getRecalculateOptionsForOffDay(offDayState));
      if ('subsistence_payment_required' in updates) {
        const isRequired = Boolean(updates.subsistence_payment_required);
        updated = {
          ...updated,
          subsistence_payment_required: isRequired,
          remarks: syncSubsistenceRemark(updated.remarks, isRequired),
        };
      }
      next[dayIndex] = updated;
      return next;
    });
  };

  const trimTrailingEmptyJobNumbers = (values: string[]): string[] => {
    const next = [...values];
    while (next.length > 0 && next[next.length - 1]?.trim() === '') {
      next.pop();
    }
    return next;
  };

  const getEditableJobNumbers = (entry: PlantEntryDraft): string[] => (
    entry.job_numbers.length > 0 ? [...entry.job_numbers] : ['']
  );

  const handleJobNumberChange = (dayIndex: number, jobIndex: number, value: string) => {
    const nextJobNumbers = getEditableJobNumbers(entries[dayIndex]);
    nextJobNumbers[jobIndex] = normalizeJobNumberInput(value);
    updateEntry(dayIndex, {
      job_numbers: trimTrailingEmptyJobNumbers(nextJobNumbers),
      job_number: getPrimaryJobNumber(nextJobNumbers) || '',
    });
  };

  const handleAddJobNumberField = (dayIndex: number) => {
    const nextJobNumbers = getEditableJobNumbers(entries[dayIndex]);
    nextJobNumbers.push('');
    updateEntry(dayIndex, {
      job_numbers: nextJobNumbers,
      job_number: getPrimaryJobNumber(nextJobNumbers) || '',
    });
  };

  const handleRemoveJobNumberField = (dayIndex: number, jobIndex: number) => {
    const nextJobNumbers = getEditableJobNumbers(entries[dayIndex]);
    nextJobNumbers.splice(jobIndex, 1);
    const trimmed = trimTrailingEmptyJobNumbers(nextJobNumbers);
    updateEntry(dayIndex, {
      job_numbers: trimmed,
      job_number: getPrimaryJobNumber(trimmed) || '',
    });
  };

  const toggleWorkingInYard = (dayIndex: number) => {
    const currentEntry = entries[dayIndex];
    const nextValue = !currentEntry.working_in_yard;

    updateEntry(dayIndex, {
      working_in_yard: nextValue,
      did_not_work: nextValue ? false : currentEntry.did_not_work,
      didNotWorkReason: nextValue ? null : currentEntry.didNotWorkReason,
      job_number: nextValue ? '' : currentEntry.job_number,
      job_numbers: nextValue ? [] : currentEntry.job_numbers,
      operator_yard_hours: '',
    });
  };

  const applyDidNotWorkSelection = (
    dayIndex: number,
    reason?: string,
    didNotWorkReasonCategory: TimesheetDidNotWorkReason = 'Other'
  ) => {
    const trimmedReason = reason?.trim();
    setEntries((current) => {
      const next = [...current];
      const clearedEntry = recalculateEntry({
        ...next[dayIndex],
        did_not_work: true,
        didNotWorkReason: trimmedReason ? didNotWorkReasonCategory : next[dayIndex].didNotWorkReason || 'Other',
        working_in_yard: false,
        subsistence_payment_required: false,
        time_started: '',
        time_finished: '',
        job_number: '',
        job_numbers: [],
        operator_travel_hours: '',
        operator_yard_hours: '',
        machine_travel_hours: '',
        machine_start_time: '',
        machine_finish_time: '',
        machine_standing_hours: '',
        machine_operator_hours: '',
        maintenance_breakdown_hours: '',
        remarks: trimmedReason ? formatDidNotWorkReasonRemark(trimmedReason) : next[dayIndex].remarks,
      });
      next[dayIndex] = {
        ...clearedEntry,
        daily_total: 0,
      };
      return next;
    });
  };

  const toggleDidNotWork = (dayIndex: number) => {
    const currentEntry = entries[dayIndex];
    const nextDidNotWork = !currentEntry.did_not_work;

    if (nextDidNotWork) {
      if (isScheduledWorkingDayDidNotWork({ did_not_work: true }, getOffDayForIndex(dayIndex))) {
        setDidNotWorkReasonDayIndex(dayIndex);
        return;
      }

      applyDidNotWorkSelection(dayIndex);
      return;
    }

    const existingRemarks = currentEntry.remarks;
    removePendingDidNotWorkBooking(dayIndex);
    updateEntry(dayIndex, {
      did_not_work: false,
      didNotWorkReason: null,
      daily_total: currentEntry.time_started && currentEntry.time_finished ? currentEntry.daily_total : null,
      remarks: parseDidNotWorkReasonRemark(existingRemarks) === existingRemarks ? existingRemarks : '',
    });
  };

  const toggleSubsistencePayment = (dayIndex: number) => {
    const currentEntry = entries[dayIndex];
    const nextValue = !currentEntry.subsistence_payment_required;

    if (nextValue && !hasWorkedTimesForSubsistence(currentEntry)) {
      toast.info('Enter start and finish times before adding subsistence.', {
        id: `plant-timesheet-subsistence-blocked-${dayIndex}`,
        description: 'Use this when the worker stayed away overnight and needs subsistence payment.',
      });
      return;
    }

    updateEntry(dayIndex, {
      subsistence_payment_required: nextValue,
    });
    toast.success(nextValue ? 'Subsistence payment added' : 'Subsistence payment removed', {
      id: `plant-timesheet-subsistence-toggle-${dayIndex}`,
      description: nextValue
        ? 'This day will be marked as stayed away for payroll.'
        : 'The stayed-away payroll marker has been removed for this day.',
    });
  };

  const applyPendingTrainingSelection = (dayIndex: number, trainingSession: DidNotWorkTrainingSession) => {
    const booking = buildPendingDidNotWorkBooking(dayIndex, 'training', trainingSession);
    const halfDayRemark = isHalfDayTrainingSession(trainingSession)
      ? formatHalfDayTrainingRemark(trainingSession)
      : '';
    queuePendingDidNotWorkBooking(booking);
    setEntries((current) => {
      const next = [...current];
      next[dayIndex] = recalculateEntry({
        ...next[dayIndex],
        did_not_work: false,
        didNotWorkReason: null,
        working_in_yard: false,
        subsistence_payment_required: false,
        job_number: '',
        job_numbers: [],
        operator_yard_hours: '',
        remarks: halfDayRemark,
      });
      return next;
    });
    toast.info(`${booking.dayName} marked for ${trainingSession === 'FULL' ? 'Training' : `Training (${trainingSession})`}.`, {
      description: isHalfDayTrainingSession(trainingSession)
        ? 'Enter the total day start and finish times, including training and any worked time.'
        : 'Enter the training-day start and finish times before saving.',
    });
  };

  const handleDidNotWorkReasonConfirm = (decision: DidNotWorkReasonDecision) => {
    if (didNotWorkReasonDayIndex === null) return;
    if (decision.kind === 'sickness') {
      queuePendingDidNotWorkBooking(buildPendingDidNotWorkBooking(didNotWorkReasonDayIndex, 'sickness'));
      applyDidNotWorkSelection(didNotWorkReasonDayIndex, 'Sickness', 'Sickness');
    } else if (decision.kind === 'training') {
      applyPendingTrainingSelection(didNotWorkReasonDayIndex, decision.trainingSession);
    } else {
      removePendingDidNotWorkBooking(didNotWorkReasonDayIndex);
      applyDidNotWorkSelection(didNotWorkReasonDayIndex, decision.reason);
    }
    setDidNotWorkReasonDayIndex(null);
  };

  const handleSelectedEmployeeChange = (nextEmployeeId: string) => {
    setSelectedEmployeeId(nextEmployeeId);
    onSelectedEmployeeChange?.(nextEmployeeId);
    setPendingDidNotWorkBookings({});

    // New timesheets should reset daily rows when switching employee context
    // to avoid carrying over prior employee leave defaults/values.
    if (!existingTimesheetId) {
      setEntries(createBlankPlantWeekEntries());
      setTimeErrors({});
      setRowErrors({});
      setError('');
      setActiveDay('0');
    }
  };

  const handleMachineSelection = (value: string) => {
    setPendingExistingMachineReg('');

    if (value === NO_MACHINE_SENTINEL) {
      setIsHiredPlant(false);
      setSelectedPlantId('');
      setHiredPlantIdSerial('');
      setHiredPlantDescription('');
      setHiredPlantHiringCompany('');
      return;
    }

    if (value === HIRED_PLANT_SENTINEL) {
      setIsHiredPlant(true);
      setSelectedPlantId('');
      return;
    }

    const selected = plants.find((plant) => plant.id === value);
    setIsHiredPlant(false);
    setSelectedPlantId(value);
    setHiredPlantIdSerial('');
    setHiredPlantDescription('');
    setHiredPlantHiringCompany('');
    if (user?.id) {
      setRecentPlantIds(recordRecentVehicleId(user.id, value, 3, 'plant'));
    }
    if (!selected) return;
  };

  const validateBeforeSave = (): boolean => {
    if (!selectedEmployeeId) {
      setError('Please select an employee before saving.');
      return false;
    }

    const missingReason = getMissingScheduledDidNotWorkReasonException(
      entries as unknown as TimesheetEntryLike[],
      effectiveOffDayStates,
      weekEnding
    );
    if (missingReason) {
      setRowErrors({ [missingReason.dayOfWeek - 1]: `${missingReason.dayName}: reason required for Did Not Work` });
      setError(`${missingReason.dayName}: please add a reason before selecting Did Not Work on a scheduled day.`);
      setActiveDay(String(missingReason.dayOfWeek - 1));
      return false;
    }

    if (isHiredPlant && !hiredPlantIdSerial.trim()) {
      setError('Please enter the hired plant ID / serial before saving.');
      return false;
    }

    if (jobCodeOptionsLoading) {
      setError('Job codes are still loading. Please wait a moment, then try again.');
      return false;
    }

    const requiredFieldErrors = buildValidationErrors(entries);
    const workWindowErrors = buildWorkWindowValidationErrors(entries, offDayMap);
    const jobNumberErrors = buildJobNumberValidationErrors(entries, offDayMap, cataloguedJobNumbers);
    const inlineTimeErrors = Object.entries(timeErrors).reduce<Record<number, string>>((acc, [key, message]) => {
      const index = Number(key);
      if (!Number.isFinite(index)) return acc;
      acc[index] = `${DAY_NAMES[index]}: ${message}`;
      return acc;
    }, {});
    const mergedErrors = mergeValidationErrors(requiredFieldErrors, workWindowErrors, jobNumberErrors, inlineTimeErrors);

    setRowErrors(mergedErrors);
    if (Object.keys(mergedErrors).length > 0) {
      setError('Please resolve the highlighted daily entry issues before saving.');
      return false;
    }

    return true;
  };

  const saveTimesheet = async (status: 'draft' | 'submitted', signatureData?: string) => {
    if (!user || !selectedEmployeeId || !weekEnding) return;
    if (!validateBeforeSave()) return;

    setSaving(true);
    setError('');

    const machineIdentifier = isHiredPlant
      ? hiredPlantIdSerial.trim()
      : (selectedPlant?.plant_id || '');

    try {
      let timesheetId = existingTimesheetId;

      if (timesheetId) {
        type TimesheetUpdate = Database['public']['Tables']['timesheets']['Update'];
        const timesheetData: TimesheetUpdate = {
          timesheet_type: 'plant',
          template_version: 2,
          reg_number: machineIdentifier || null,
          site_address: siteAddress.trim() || null,
          hirer_name: hirerName.trim() || null,
          is_hired_plant: isHiredPlant,
          hired_plant_id_serial: isHiredPlant ? hiredPlantIdSerial.trim() || null : null,
          hired_plant_description: isHiredPlant ? hiredPlantDescription.trim() || null : null,
          hired_plant_hiring_company: isHiredPlant ? hiredPlantHiringCompany.trim() || null : null,
          week_ending: weekEnding,
          status,
          submitted_at: status === 'submitted' ? new Date().toISOString() : null,
          signature_data: signatureData || null,
          signed_at: signatureData ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        };

        const { data: updatedTimesheet, error: updateError } = await supabase
          .from('timesheets')
          .update(timesheetData)
          .eq('id', timesheetId)
          .select()
          .single();

        if (updateError) throw updateError;
        if (!updatedTimesheet) throw new Error('Failed to update timesheet');
      } else {
        type TimesheetInsert = Database['public']['Tables']['timesheets']['Insert'];
        const timesheetData: TimesheetInsert = {
          user_id: selectedEmployeeId,
          timesheet_type: 'plant',
          template_version: 2,
          reg_number: machineIdentifier || null,
          site_address: siteAddress.trim() || null,
          hirer_name: hirerName.trim() || null,
          is_hired_plant: isHiredPlant,
          hired_plant_id_serial: isHiredPlant ? hiredPlantIdSerial.trim() || null : null,
          hired_plant_description: isHiredPlant ? hiredPlantDescription.trim() || null : null,
          hired_plant_hiring_company: isHiredPlant ? hiredPlantHiringCompany.trim() || null : null,
          week_ending: weekEnding,
          status,
          submitted_at: status === 'submitted' ? new Date().toISOString() : null,
          signature_data: signatureData || null,
          signed_at: signatureData ? new Date().toISOString() : null,
        };

        const { data: createdTimesheet, error: createError } = await supabase
          .from('timesheets')
          .insert(timesheetData)
          .select()
          .single();

        if (createError) throw createError;
        if (!createdTimesheet) throw new Error('Failed to create timesheet');
        timesheetId = createdTimesheet.id;
        setExistingTimesheetId(createdTimesheet.id);
      }

      if (!timesheetId) throw new Error('Timesheet id missing');

      const { error: deleteError } = await supabase
        .from('timesheet_entries')
        .delete()
        .eq('timesheet_id', timesheetId);

      if (deleteError) throw deleteError;

      type TimesheetEntryInsert = Database['public']['Tables']['timesheet_entries']['Insert'];
      const entriesToInsert: TimesheetEntryInsert[] = entries.map((entry) => {
        const offDayState = offDayMap.get(entry.day_of_week);
        const recalculated = recalculateEntry(entry, getRecalculateOptionsForOffDay(offDayState));
        const persistedJobNumbers = getNormalizedJobNumbers(recalculated.job_numbers);
        const operatorTravel = parseHoursInput(recalculated.operator_travel_hours);
        const operatorYard = parseHoursInput(recalculated.operator_yard_hours);
        const machineTravel = parseHoursInput(recalculated.machine_travel_hours);
        const machineStanding = parseHoursInput(recalculated.machine_standing_hours);
        const machineOperator = parseHoursInput(recalculated.machine_operator_hours);
        const maintenanceBreakdown = parseHoursInput(recalculated.maintenance_breakdown_hours);
        const halfDayTrainingRemark = getHalfDayTrainingRemarkForOffDayState(offDayState);
        const normalizedRemarks =
          recalculated.remarks?.trim() ||
          halfDayTrainingRemark ||
          (recalculated.did_not_work
            ? (offDayState && !offDayState.isExpectedShiftDay ? 'Not on Shift' : 'Did Not Work')
            : '');
        const requiresSubsistence =
          Boolean(recalculated.subsistence_payment_required) && hasWorkedTimesForSubsistence(recalculated);
        const persistedRemarks = syncSubsistenceRemark(normalizedRemarks, requiresSubsistence);

        return {
          timesheet_id: timesheetId,
          day_of_week: recalculated.day_of_week,
          time_started: recalculated.time_started || null,
          time_finished: recalculated.time_finished || null,
          operator_travel_hours: operatorTravel,
          operator_yard_hours: operatorYard,
          operator_working_hours: recalculated.operator_working_hours,
          machine_travel_hours: machineTravel,
          machine_start_time: recalculated.machine_start_time || null,
          machine_finish_time: recalculated.machine_finish_time || null,
          machine_working_hours: recalculated.machine_working_hours,
          machine_standing_hours: machineStanding,
          machine_operator_hours: machineOperator,
          maintenance_breakdown_hours: maintenanceBreakdown,
          daily_total: recalculated.daily_total,
          job_number: persistedJobNumbers[0] || null,
          working_in_yard: recalculated.working_in_yard,
          subsistence_payment_required: requiresSubsistence,
          did_not_work: recalculated.did_not_work,
          night_shift: false,
          bank_holiday: false,
          remarks: persistedRemarks || null,
        };
      });

      const { data: insertedEntries, error: entriesError } = await supabase
        .from('timesheet_entries')
        .insert(entriesToInsert)
        .select('id, day_of_week');

      if (entriesError) throw entriesError;

      type TimesheetEntryJobCodeInsert = Database['public']['Tables']['timesheet_entry_job_codes']['Insert'];
      const entryIdByDay = new Map(
        (insertedEntries || []).map((entry) => [entry.day_of_week, entry.id] as const)
      );
      const jobCodesToInsert: TimesheetEntryJobCodeInsert[] = entries.flatMap((entry) => {
        const entryId = entryIdByDay.get(entry.day_of_week);
        if (!entryId) return [];

        return getNormalizedJobNumbers(entry.job_numbers).map((jobNumber, displayOrder) => ({
          timesheet_entry_id: entryId,
          job_number: jobNumber,
          display_order: displayOrder,
        }));
      });

      if (jobCodesToInsert.length > 0) {
        const { error: jobCodesError } = await supabase
          .from('timesheet_entry_job_codes')
          .insert(jobCodesToInsert);

        if (jobCodesError) throw jobCodesError;
      }

      const didNotWorkBookings = getPendingDidNotWorkBookingsPayload(pendingDidNotWorkBookings);
      if (didNotWorkBookings.length > 0) {
        await commitTimesheetDidNotWorkBookings(timesheetId, didNotWorkBookings);
      }

      try {
        await notifyTimesheetDidNotWorkExceptions(timesheetId);
      } catch (notificationError) {
        console.warn('Did Not Work notification was not sent:', notificationError);
      }

      commitRecentHeaderValues();

      if (status === 'draft') {
        toast.success('Plant timesheet saved as draft');
      } else {
        toast.success('Plant timesheet submitted');
      }

      router.push('/timesheets');
    } catch (saveError) {
      const isDuplicateTimesheetError = isDuplicateTimesheetWeekError(saveError);
      const shouldLogError =
        !isDuplicateTimesheetError &&
        !isAuthErrorStatus(getErrorStatus(saveError)) &&
        !isNetworkFetchError(saveError);

      if (shouldLogError) {
        console.error('Error saving plant timesheet:', saveError);
      }

      if (
        !existingTimesheetId &&
        isDuplicateTimesheetError
      ) {
        const { data: duplicate } = await supabase
          .from('timesheets')
          .select('id')
          .eq('user_id', selectedEmployeeId)
          .eq('week_ending', weekEnding)
          .single();

        if (duplicate) {
          toast.error('Timesheet already exists for this week. Redirecting to edit...');
          setTimeout(() => {
            router.push(`/timesheets/new?id=${duplicate.id}`);
          }, 1200);
          return;
        }
      }

      setError(saveError instanceof Error ? saveError.message : 'Failed to save plant timesheet');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDraft = async () => {
    await saveTimesheet('draft');
  };

  const handleSubmit = () => {
    if (!validateBeforeSave()) return;
    setShowSignatureDialog(true);
  };

  const handleSignatureComplete = async (signatureData: string) => {
    setShowSignatureDialog(false);
    await saveTimesheet('submitted', signatureData);
  };

  const waitingForOffDayData =
    Boolean(currentOffDayKey) &&
    (loadingOffDays || offDayKey !== currentOffDayKey);
  const waitingForCoreData =
    authLoading ||
    loadingPlants ||
    loadingExisting ||
    (hasElevatedPermissions && loadingEmployees) ||
    !existingTimesheetLoaded;

  if (waitingForCoreData || waitingForOffDayData) {
    return <PageLoader message="Loading plant timesheet..." />;
  }

  return (
    <div className="space-y-4 pb-32 md:pb-6 w-full max-w-[1400px] mx-auto">
      <div className="bg-white dark:bg-slate-900 rounded-lg p-4 md:p-6 border border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Link href="/timesheets">
              <Button variant="ghost" size="sm" className="h-9 w-9 p-0 md:w-auto md:px-3 hover:bg-slate-100 dark:hover:bg-slate-800">
                <ArrowLeft className="h-5 w-5 md:mr-2" />
                <span className="hidden md:inline">Back</span>
              </Button>
            </Link>
            <div>
              <h1 className="text-xl md:text-3xl font-bold text-foreground">
                {existingTimesheetId ? 'Edit Plant Timesheet' : 'New Plant Timesheet'}
              </h1>
              <p className="text-sm text-muted-foreground hidden md:block">
                {selectedEmployeeName || profile?.full_name || ''}
              </p>
            </div>
          </div>
          <div className="bg-timesheet/10 dark:bg-timesheet/20 border border-timesheet/30 rounded-lg px-3 py-2">
            <div className="text-xs text-muted-foreground">Total</div>
            <div className="text-lg font-bold text-foreground whitespace-pre-line text-right">{weeklyTotalMultiline}</div>
          </div>
        </div>
      </div>

      {managerComments && (
        <Card className="bg-white dark:bg-slate-900 border-amber-200 bg-amber-50 dark:bg-amber-950/20">
          <CardHeader>
            <CardTitle className="text-amber-900 dark:text-amber-400 flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Manager Comments
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-amber-800 dark:text-amber-300 whitespace-pre-wrap">{managerComments}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-foreground">Plant Timesheet Details</CardTitle>
          <CardDescription className="text-muted-foreground">
            New plant entries use template v2. Legacy records remain unchanged.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {hasElevatedPermissions && (
            <div className="space-y-2 pb-4 border-b border-border">
              <Label htmlFor="employee" className="text-foreground text-base flex items-center gap-2">
                <User className="h-4 w-4" />
                Creating timesheet for
              </Label>
              <Select
                value={selectedEmployeeId}
                onValueChange={handleSelectedEmployeeChange}
                disabled={Boolean(existingTimesheetId)}
              >
                <SelectTrigger id="employee" className="h-12 text-base bg-slate-900/50 border-slate-600 text-white">
                  <SelectValue placeholder="Select employee..." />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id} disabled={employee.has_module_access === false}>
                      {employee.full_name}
                      {employee.employee_id ? ` (${employee.employee_id})` : ''}
                      {employee.id === user?.id ? ' (You)' : ''}
                      {employee.has_module_access === false ? ' - No Timesheets access' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="machine" className="text-foreground text-base flex items-center gap-2">
              Machine
            </Label>
            <Select value={machineSelectValue} onValueChange={handleMachineSelection}>
              <SelectTrigger id="machine" className="h-12 text-base bg-slate-900/50 border-slate-600 text-white">
                <SelectValue placeholder="Select machine (optional)" />
              </SelectTrigger>
              <SelectContent className="border-border max-h-[300px] md:max-h-[400px]">
                <SelectItem value={NO_MACHINE_SENTINEL}>No machine selected</SelectItem>
                <SelectSeparator className="bg-slate-700" />
                <SelectItem value={HIRED_PLANT_SENTINEL} className="font-semibold !text-amber-400 focus:!text-amber-400">
                  Hired Plant
                </SelectItem>
                {plants.length > 0 && <SelectSeparator className="bg-slate-700" />}
                {(() => {
                  const { recentVehicles: recentPlants, otherVehicles } = splitVehiclesByRecent(plants, recentPlantIds);
                  return (
                    <>
                      {recentPlants.length > 0 && (
                        <SelectGroup>
                          <SelectLabel className="text-muted-foreground text-xs px-2 py-1.5">Recent</SelectLabel>
                          {recentPlants.map((plant) => (
                            <SelectItem key={plant.id} value={plant.id}>
                              {plant.plant_id} {plant.nickname ? `- ${plant.nickname}` : ''} ({plant.van_categories?.name || 'Uncategorized'})
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                      {recentPlants.length > 0 && otherVehicles.length > 0 && (
                        <SelectSeparator className="bg-slate-700" />
                      )}
                      {otherVehicles.length > 0 && (
                        <SelectGroup>
                          {recentPlants.length > 0 && (
                            <SelectLabel className="text-muted-foreground text-xs px-2 py-1.5">All Plants</SelectLabel>
                          )}
                          {otherVehicles.map((plant) => (
                            <SelectItem key={plant.id} value={plant.id}>
                              {plant.plant_id} {plant.nickname ? `- ${plant.nickname}` : ''} ({plant.van_categories?.name || 'Uncategorized'})
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                    </>
                  );
                })()}
              </SelectContent>
            </Select>
            {selectedPlant && !isHiredPlant && (
              <p className="text-xs text-muted-foreground">
                Selected: {selectedPlant.plant_id} {selectedPlant.nickname ? `- ${selectedPlant.nickname}` : ''}
              </p>
            )}
          </div>

          {isHiredPlant && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 space-y-3">
              <div className="flex items-center gap-2 text-amber-300">
                <Wrench className="h-4 w-4" />
                <p className="text-sm font-medium">Hired Plant Details</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="hired-id-serial">ID / Serial</Label>
                  <Input
                    id="hired-id-serial"
                    value={hiredPlantIdSerial}
                    onChange={(event) => setHiredPlantIdSerial(event.target.value)}
                    placeholder="Required for hired plant"
                    className="bg-slate-900/50 border-slate-600 text-white"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="hired-description">Description</Label>
                  <Input
                    id="hired-description"
                    value={hiredPlantDescription}
                    onChange={(event) => setHiredPlantDescription(event.target.value)}
                    placeholder="Optional"
                    className="bg-slate-900/50 border-slate-600 text-white"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="hired-company">Hiring Company</Label>
                  <Input
                    id="hired-company"
                    value={hiredPlantHiringCompany}
                    onChange={(event) => setHiredPlantHiringCompany(event.target.value)}
                    placeholder="Optional"
                    className="bg-slate-900/50 border-slate-600 text-white"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="hirer">Hirer</Label>
              <Input
                id="hirer"
                value={hirerName}
                onChange={(event) => setHirerName(event.target.value)}
                onBlur={() => {
                  if (!user?.id || !hirerName.trim()) return;
                  setRecentHirerNames(recordRecentTextValue(user.id, HIRER_RECENT_SCOPE, hirerName));
                }}
                placeholder="Optional"
                className="bg-slate-900/50 border-slate-600 text-white"
              />
              {recentHirerNames.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {recentHirerNames.map((value) => (
                    <button
                      type="button"
                      key={value}
                      onClick={() => setHirerName(value)}
                      className="text-xs rounded-full border border-border px-2.5 py-1 text-muted-foreground hover:text-foreground hover:bg-muted/30"
                    >
                      {value}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="site-address">Site Address</Label>
              <Input
                id="site-address"
                value={siteAddress}
                onChange={(event) => setSiteAddress(event.target.value)}
                onBlur={() => {
                  if (!user?.id || !siteAddress.trim()) return;
                  setRecentSiteAddresses(recordRecentTextValue(user.id, SITE_ADDRESS_RECENT_SCOPE, siteAddress));
                }}
                placeholder="Optional"
                className="bg-slate-900/50 border-slate-600 text-white"
              />
              {recentSiteAddresses.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {recentSiteAddresses.map((value) => (
                    <button
                      type="button"
                      key={value}
                      onClick={() => setSiteAddress(value)}
                      className="text-xs rounded-full border border-border px-2.5 py-1 text-muted-foreground hover:text-foreground hover:bg-muted/30"
                    >
                      {value}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="">
        <CardHeader className="pb-3">
          <CardTitle className="text-foreground">Daily Hours</CardTitle>
        </CardHeader>
        <CardContent className="p-0 md:p-6">
          <div className="md:hidden">
            <Tabs value={activeDay} onValueChange={setActiveDay} className="w-full">
              <TabsList className="grid w-full grid-cols-7 bg-slate-900/50 p-1 rounded-lg mb-4 h-auto">
                {DAY_NAMES.map((day, index) => {
                  const isComplete = isPlantEntryComplete(entries[index], getOffDayForIndex(index));
                  return (
                    <TabsTrigger
                      key={day}
                      value={String(index)}
                      className={`text-sm py-3 data-[state=active]:bg-timesheet data-[state=active]:text-slate-900 text-muted-foreground ${
                        isComplete
                          ? 'data-[state=active]:outline data-[state=active]:outline-2 data-[state=active]:outline-green-500 data-[state=active]:-outline-offset-2 outline outline-2 outline-green-500/50 -outline-offset-2'
                          : 'data-[state=active]:outline data-[state=active]:outline-2 data-[state=active]:outline-white data-[state=active]:-outline-offset-2'
                      }`}
                    >
                      {day.substring(0, 3)}
                      {isComplete && <Check className="h-4 w-4 ml-1" />}
                    </TabsTrigger>
                  );
                })}
              </TabsList>

              {entries.map((entry, index) => {
                const dayOffState = getOffDayForIndex(index);
                const isLeaveLocked = Boolean(dayOffState?.isLeaveLocked);
                const isLeaveDayForRow = Boolean(dayOffState?.isOnApprovedLeave);
                const hasTrainingBooking = Boolean(dayOffState?.hasTrainingBooking);
                const hasPendingTrainingBooking = Boolean(dayOffState?.hasPendingTrainingBooking);
                const isPartialLeave = Boolean(dayOffState?.isPartialLeave);
                const disableForDidNotWork = entry.did_not_work && !isPartialLeave;
                const disableInputs = isLeaveLocked || disableForDidNotWork;
                const disableStatusForTraining = hasTrainingBooking;
                const disableJobNumberInput = disableInputs || entry.working_in_yard || hasTrainingBooking;
                const jobNumberPlaceholder = hasTrainingBooking
                  ? 'N/A (Training)'
                  : entry.working_in_yard
                    ? 'N/A (Yard)'
                    : 'Select job code';
                const halfDayTrainingRemark = getHalfDayTrainingRemarkForOffDayState(dayOffState);
                const halfDayTrainingHelperText = halfDayTrainingRemark
                  ? 'Half-day training: enter the total day start and finish times, including training and any worked time.'
                  : null;

                return (
                  <TabsContent key={entry.day_of_week} value={String(index)} className="space-y-4 px-4 pb-4 overflow-hidden">
                    <div className="text-center mb-4">
                      <h3 className="text-3xl font-bold text-foreground">{DAY_NAMES[index]}</h3>
                      <p className="text-xl font-semibold text-timesheet">
                        {leaveAwareTotals.rowByDay.get(entry.day_of_week)?.display ?? `${formatHours(entry.daily_total)}h`}
                      </p>
                    </div>

                    {(hasTrainingBooking || hasPendingTrainingBooking || dayOffState?.leaveLabels.length) ? (
                      <div className="space-y-1 text-center">
                        {hasTrainingBooking && (
                          <p
                            className="text-sm font-semibold text-emerald-400"
                            style={getLeaveLabelStyle(dayOffState?.trainingReasonColor)}
                          >
                            {getTrainingLabel(dayOffState)}
                          </p>
                        )}
                        {hasPendingTrainingBooking && (
                          <p className="text-sm font-semibold text-sky-400">
                            {getPendingTrainingLabel(dayOffState)}
                          </p>
                        )}
                        {dayOffState?.leaveLabels.map((label, labelIndex) => (
                          <p
                            key={`${label.reasonName}-${label.session}-${labelIndex}`}
                            className="text-sm font-semibold"
                            style={getLeaveLabelStyle(label.color)}
                          >
                            {label.label}
                          </p>
                        ))}
                        {dayOffState?.workWindow && (dayOffState?.leaveLabels.length ?? 0) > 0 && (
                          <p className="text-xs text-muted-foreground">
                            Working hours allowed: {dayOffState?.workWindow?.start} to {dayOffState?.workWindow?.end}
                          </p>
                        )}
                        {halfDayTrainingHelperText && (
                          <p className="text-sm font-medium text-emerald-200">
                            {halfDayTrainingHelperText}
                          </p>
                        )}
                      </div>
                    ) : null}

                    <div className="space-y-4 max-w-full">
                      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_4rem] gap-3 items-end">
                        <div className="space-y-2">
                          <Label className="text-foreground text-xl">Start Time</Label>
                          <MobileNumericTimeInput
                            value={entry.time_started}
                            onChange={(value) => updateEntryField(index, 'time_started', value)}
                            disabled={disableInputs}
                            ariaLabel={`${DAY_NAMES[index]} start time`}
                            className={`h-16 text-3xl text-center bg-slate-900/50 border-slate-600 text-white w-full disabled:opacity-30 disabled:cursor-not-allowed ${
                              timeErrors[index] ? 'border-red-500' : ''
                            }`}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-foreground text-xl">Finish Time</Label>
                          <MobileNumericTimeInput
                            value={entry.time_finished}
                            onChange={(value) => updateEntryField(index, 'time_finished', value)}
                            disabled={disableInputs}
                            ariaLabel={`${DAY_NAMES[index]} finish time`}
                            className={`h-16 text-3xl text-center bg-slate-900/50 border-slate-600 text-white w-full disabled:opacity-30 disabled:cursor-not-allowed ${
                              timeErrors[index] ? 'border-red-500' : ''
                            }`}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-foreground text-sm leading-tight">Subsistence</Label>
                          <button
                            type="button"
                            aria-pressed={entry.subsistence_payment_required}
                            aria-label={`${DAY_NAMES[index]} subsistence payment required`}
                            title="Stayed away - subsistence payment required"
                            onClick={() => toggleSubsistencePayment(index)}
                            disabled={disableInputs}
                            className={`flex h-16 w-16 items-center justify-center rounded-lg border-2 transition-all ${
                              entry.subsistence_payment_required
                                ? 'bg-emerald-500/20 border-emerald-500 shadow-lg shadow-emerald-500/20'
                                : 'bg-slate-800/30 border-slate-700 hover:bg-slate-800/50'
                            } disabled:opacity-30 disabled:cursor-not-allowed`}
                          >
                            <Moon className={`h-7 w-7 ${entry.subsistence_payment_required ? 'text-emerald-400' : 'text-muted-foreground'}`} />
                          </button>
                        </div>
                      </div>
                      {timeErrors[index] && (
                        <p className="text-base text-red-400 flex items-center gap-1 -mt-2">
                          <AlertCircle className="h-4 w-4" />
                          {timeErrors[index]}
                        </p>
                      )}

                      <div className="grid grid-cols-[minmax(7.25rem,0.75fr)_minmax(0,1.45fr)] gap-2">
                        <div className="min-w-0 space-y-2">
                          <Label className="text-foreground text-xl">Travel Time</Label>
                          <Input
                            type="number"
                            min="0"
                            step="0.25"
                            value={entry.operator_travel_hours}
                            onChange={(event) => updateEntryField(index, 'operator_travel_hours', event.target.value)}
                            disabled={disableInputs}
                            className="h-16 text-3xl text-center bg-slate-900/50 border-slate-600 text-white w-full disabled:opacity-30 disabled:cursor-not-allowed"
                          />
                        </div>

                        <div className="min-w-0 space-y-2">
                          <Label className="text-foreground text-xl flex items-center gap-2">
                            Job Number
                            {!entry.working_in_yard && !hasTrainingBooking && <span className="text-red-400 text-lg">*</span>}
                          </Label>
                          <JobCodeFields
                            values={entry.job_numbers}
                            onChange={(jobIndex, value) => handleJobNumberChange(index, jobIndex, value)}
                            onAdd={() => handleAddJobNumberField(index)}
                            onRemove={(jobIndex) => handleRemoveJobNumberField(index, jobIndex)}
                            placeholder={jobNumberPlaceholder}
                            disabled={disableJobNumberInput}
                            jobCodeOptions={jobCodeOptions}
                            jobCodeOptionsLoading={jobCodeOptionsLoading}
                            inputClassName="h-16 text-3xl text-center bg-slate-900/50 border-slate-600 text-white placeholder:text-muted-foreground uppercase disabled:opacity-30 disabled:cursor-not-allowed"
                          />
                        </div>
                      </div>

                      <div className="space-y-3">
                        <Label className="text-foreground text-xl">Day Status</Label>
                        <div className={`grid gap-3 ${hasTrainingBooking ? 'grid-cols-3' : 'grid-cols-2'}`}>
                          <button
                            type="button"
                            onClick={() => toggleWorkingInYard(index)}
                            disabled={disableInputs || disableStatusForTraining}
                            className={`flex flex-col items-center justify-center h-24 rounded-lg border-2 transition-all ${
                              entry.working_in_yard
                                ? 'bg-blue-500/20 border-blue-500 shadow-lg shadow-blue-500/20'
                                : 'bg-slate-800/30 border-slate-700 hover:bg-slate-800/50'
                            } disabled:opacity-30 disabled:cursor-not-allowed`}
                          >
                            <Home className={`h-8 w-8 mb-2 ${entry.working_in_yard ? 'text-blue-400' : 'text-muted-foreground'}`} />
                            <span className={`text-lg font-medium ${entry.working_in_yard ? 'text-blue-400' : 'text-muted-foreground'}`}>
                              In Yard
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => toggleDidNotWork(index)}
                            disabled={isLeaveDayForRow || disableStatusForTraining}
                            className={`flex flex-col items-center justify-center h-24 rounded-lg border-2 transition-all ${
                              entry.did_not_work
                                ? 'bg-amber-500/20 border-amber-500 shadow-lg shadow-amber-500/20'
                                : 'bg-slate-800/30 border-slate-700 hover:bg-slate-800/50'
                            } disabled:opacity-30 disabled:cursor-not-allowed`}
                          >
                            <XCircle className={`h-8 w-8 mb-2 ${entry.did_not_work ? 'text-amber-400' : 'text-muted-foreground'}`} />
                            <span className={`text-lg font-medium ${entry.did_not_work ? 'text-amber-400' : 'text-muted-foreground'}`}>
                              Did Not Work
                            </span>
                          </button>

                          {hasTrainingBooking && (
                            <button
                              type="button"
                              onClick={() => handleTrainingStatusToggle(index)}
                              disabled={decliningTraining}
                              className="flex flex-col items-center justify-center h-24 rounded-lg border-2 transition-all bg-emerald-500/20 border-emerald-500 shadow-lg shadow-emerald-500/20 disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              <User className="h-8 w-8 mb-2 text-emerald-400" />
                              <span className="text-lg font-medium text-emerald-400">
                                Training
                              </span>
                            </button>
                          )}
                        </div>
                        {(hasTrainingBooking || hasPendingTrainingBooking || dayOffState?.leaveLabels.length || entry.did_not_work) ? (
                          <div className="flex justify-center">
                            {(dayOffState?.leaveLabels.length || hasTrainingBooking || hasPendingTrainingBooking) ? (
                              <div className="space-y-1 text-center">
                                {hasTrainingBooking && (
                                  <p
                                    className="text-sm font-semibold text-emerald-400"
                                    style={getLeaveLabelStyle(dayOffState?.trainingReasonColor)}
                                  >
                                    {getTrainingLabel(dayOffState)}
                                  </p>
                                )}
                                {hasPendingTrainingBooking && (
                                  <p className="text-sm font-semibold text-sky-400">
                                    {getPendingTrainingLabel(dayOffState)}
                                  </p>
                                )}
                                {dayOffState?.leaveLabels.map((label, labelIndex) => (
                                  <p
                                    key={`${label.reasonName}-${label.session}-${labelIndex}`}
                                    className="text-sm font-semibold text-amber-400"
                                    style={getLeaveLabelStyle(label.color)}
                                  >
                                    {label.label}
                                  </p>
                                ))}
                                {dayOffState?.workWindow && (dayOffState?.leaveLabels.length ?? 0) > 0 && (
                                  <p className="text-xs text-muted-foreground">
                                    Working hours allowed: {dayOffState?.workWindow?.start} to {dayOffState?.workWindow?.end}
                                  </p>
                                )}
                                {halfDayTrainingHelperText && (
                                  <p className="text-sm font-medium text-emerald-200">
                                    {halfDayTrainingHelperText}
                                  </p>
                                )}
                              </div>
                            ) : (
                              <p
                                className="text-sm text-center font-semibold text-amber-400"
                                style={getDidNotWorkAutoStyle(dayOffState)}
                              >
                                {getDidNotWorkAutoLabel(dayOffState)}
                              </p>
                            )}
                          </div>
                        ) : null}
                      </div>

                      <div className="space-y-2">
                        <Label className="text-foreground text-xl">Total Hours</Label>
                        <div className="text-3xl font-semibold text-timesheet">
                          {leaveAwareTotals.rowByDay.get(entry.day_of_week)?.display ?? `${formatHours(entry.daily_total)}h`}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-foreground text-xl">Notes / Remarks</Label>
                        <Input
                          value={entry.remarks}
                          onChange={(event) => updateEntryField(index, 'remarks', event.target.value)}
                          placeholder="Notes"
                          disabled={isLeaveDayForRow}
                          className="h-16 text-2xl bg-slate-900/50 border-slate-600 text-white placeholder:text-muted-foreground w-full disabled:opacity-30 disabled:cursor-not-allowed"
                        />
                      </div>

                      <div className="rounded-lg border border-[hsl(var(--timesheet-primary)/0.30)] bg-[hsl(var(--timesheet-primary)/0.10)] px-3">
                        <Accordion type="single" collapsible className="w-full">
                          <AccordionItem value={`mobile-extra-${entry.day_of_week}`} className="border-0">
                            <AccordionTrigger className="justify-center gap-2 text-center text-xl font-semibold text-foreground">
                              Additional Fields
                            </AccordionTrigger>
                            <AccordionContent className="space-y-4 pb-4">
                              <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                  <Label className="text-foreground text-xl">Machine Start Time</Label>
                                  <MobileNumericTimeInput
                                    value={entry.machine_start_time}
                                    onChange={(value) => updateEntryField(index, 'machine_start_time', value)}
                                    disabled={disableInputs}
                                    ariaLabel={`${DAY_NAMES[index]} machine start time`}
                                    className="h-16 text-3xl text-center bg-slate-900/50 border-slate-600 text-white disabled:opacity-30 disabled:cursor-not-allowed"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-foreground text-xl">Machine Finish Time</Label>
                                  <MobileNumericTimeInput
                                    value={entry.machine_finish_time}
                                    onChange={(value) => updateEntryField(index, 'machine_finish_time', value)}
                                    disabled={disableInputs}
                                    ariaLabel={`${DAY_NAMES[index]} machine finish time`}
                                    className="h-16 text-3xl text-center bg-slate-900/50 border-slate-600 text-white disabled:opacity-30 disabled:cursor-not-allowed"
                                  />
                                </div>
                              </div>

                              <div className="space-y-2">
                                <Label className="text-foreground text-xl">Total</Label>
                                <div className="text-3xl font-semibold text-timesheet">
                                  {formatDerivedHours(entry.machine_working_hours) || '0.00'}
                                </div>
                              </div>

                              <div className="grid grid-cols-3 gap-3">
                                <div className="space-y-1 flex flex-col">
                                  <Label className="text-foreground text-xl leading-tight min-h-[3rem]">Travel Hours</Label>
                                  <Input
                                    type="number"
                                    min="0"
                                    step="0.25"
                                    value={entry.machine_travel_hours}
                                    onChange={(event) => updateEntryField(index, 'machine_travel_hours', event.target.value)}
                                    disabled={disableInputs}
                                    className="h-16 text-3xl text-center bg-slate-900/50 border-slate-600 text-white disabled:opacity-30 disabled:cursor-not-allowed"
                                  />
                                </div>
                                <div className="space-y-1 flex flex-col">
                                  <Label className="text-foreground text-xl leading-tight min-h-[3rem]">Standing Hours</Label>
                                  <Input
                                    type="number"
                                    min="0"
                                    step="0.25"
                                    value={entry.machine_standing_hours}
                                    onChange={(event) => updateEntryField(index, 'machine_standing_hours', event.target.value)}
                                    disabled={disableInputs}
                                    className="h-16 text-3xl text-center bg-slate-900/50 border-slate-600 text-white disabled:opacity-30 disabled:cursor-not-allowed"
                                  />
                                </div>
                                <div className="space-y-1 flex flex-col">
                                  <Label className="text-foreground text-xl leading-tight min-h-[3rem]">Maintenance / Breakdown</Label>
                                  <Input
                                    type="number"
                                    min="0"
                                    step="0.25"
                                    value={entry.maintenance_breakdown_hours}
                                    onChange={(event) => updateEntryField(index, 'maintenance_breakdown_hours', event.target.value)}
                                    disabled={disableInputs}
                                    className="h-16 text-3xl text-center bg-slate-900/50 border-slate-600 text-white disabled:opacity-30 disabled:cursor-not-allowed"
                                  />
                                </div>
                              </div>

                              <div className="space-y-2">
                                <Label className="text-foreground text-xl">Operator Total</Label>
                                <div className="text-3xl font-semibold text-timesheet">
                                  {formatDerivedHours(parseHoursInput(entry.machine_operator_hours)) || '0.00'}
                                </div>
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        </Accordion>
                      </div>
                    </div>
                  </TabsContent>
                );
              })}
            </Tabs>
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full table-fixed border-collapse">
              <colgroup>
                <col style={{ width: '64px' }} />
                <col style={{ width: '132px' }} />
                <col style={{ width: '132px' }} />
                <col style={{ width: '110px' }} />
                <col style={{ width: '160px' }} />
                <col style={{ width: '132px' }} />
                <col style={{ width: '84px' }} />
                <col />
              </colgroup>
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-3 font-medium text-white w-16">Day</th>
                  <th className="text-left p-3 font-medium text-white">Time Started</th>
                  <th className="text-left p-3 font-medium text-white">Time Finished</th>
                  <th className="text-left p-3 font-medium text-white">Travel Time</th>
                  <th className="text-left p-3 font-medium text-white">Job Number</th>
                  <th className="text-center p-3 font-medium text-white w-32">Status</th>
                  <th className="text-right p-3 font-medium text-white w-20">Total</th>
                  <th className="text-left p-3 font-medium text-white">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, index) => {
                  const dayOffState = getOffDayForIndex(index);
                  const isLeaveLocked = Boolean(dayOffState?.isLeaveLocked);
                  const isLeaveDayForRow = Boolean(dayOffState?.isOnApprovedLeave);
                  const hasTrainingBooking = Boolean(dayOffState?.hasTrainingBooking);
                  const hasPendingTrainingBooking = Boolean(dayOffState?.hasPendingTrainingBooking);
                  const isPartialLeave = Boolean(dayOffState?.isPartialLeave);
                  const disableForDidNotWork = entry.did_not_work && !isPartialLeave;
                  const disableInputs = isLeaveLocked || disableForDidNotWork;
                  const workWindow = dayOffState?.workWindow ?? null;
                  const disableStatusForTraining = hasTrainingBooking;
                  const disableJobNumberInput = disableInputs || entry.working_in_yard || hasTrainingBooking;
                  const jobNumberPlaceholder = hasTrainingBooking
                    ? 'N/A (Training)'
                    : entry.working_in_yard
                      ? 'N/A (Yard)'
                      : 'Select job code';
                  const halfDayTrainingRemark = getHalfDayTrainingRemarkForOffDayState(dayOffState);
                  const halfDayTrainingHelperText = halfDayTrainingRemark
                    ? 'Half-day training: enter total day hours, including training and worked time.'
                    : null;

                  return (
                    <Fragment key={entry.day_of_week}>
                      <tr className={`${rowErrors[index] ? 'bg-red-500/5' : ''}`}>
                        <td className="p-3 font-medium text-white">{DAY_NAMES[index].substring(0, 3)}</td>
                        <td className="p-3">
                          <Input
                            type="time"
                            step="900"
                            value={entry.time_started}
                            onChange={(event) => updateEntryField(index, 'time_started', event.target.value)}
                            disabled={disableInputs}
                            min={workWindow?.start}
                            max={workWindow?.end}
                            className={`w-28 bg-slate-900/50 border-slate-600 text-white disabled:opacity-30 disabled:cursor-not-allowed ${
                              timeErrors[index] ? 'border-red-500' : ''
                            }`}
                          />
                        </td>
                        <td className="p-3">
                          <div className="space-y-1">
                            <Input
                              type="time"
                              step="900"
                              value={entry.time_finished}
                              onChange={(event) => updateEntryField(index, 'time_finished', event.target.value)}
                              disabled={disableInputs}
                              min={workWindow?.start}
                              max={workWindow?.end}
                              className={`w-28 bg-slate-900/50 border-slate-600 text-white disabled:opacity-30 disabled:cursor-not-allowed ${
                                timeErrors[index] ? 'border-red-500' : ''
                              }`}
                            />
                            {timeErrors[index] && (
                              <p className="text-xs text-red-400 flex items-center gap-1">
                                <AlertCircle className="h-3 w-3" />
                                {timeErrors[index]}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="p-3">
                          <Input
                            type="number"
                            min="0"
                            step="0.25"
                            value={entry.operator_travel_hours}
                            onChange={(event) => updateEntryField(index, 'operator_travel_hours', event.target.value)}
                            disabled={disableInputs}
                            className="w-24 bg-slate-900/50 border-slate-600 text-white disabled:opacity-30 disabled:cursor-not-allowed"
                          />
                        </td>
                        <td className="p-3">
                          <JobCodeFields
                            values={entry.job_numbers}
                            onChange={(jobIndex, value) => handleJobNumberChange(index, jobIndex, value)}
                            onAdd={() => handleAddJobNumberField(index)}
                            onRemove={(jobIndex) => handleRemoveJobNumberField(index, jobIndex)}
                            placeholder={jobNumberPlaceholder}
                            disabled={disableJobNumberInput}
                            jobCodeOptions={jobCodeOptions}
                            jobCodeOptionsLoading={jobCodeOptionsLoading}
                            inputClassName="w-32 bg-slate-900/50 border-slate-600 text-white placeholder:text-muted-foreground uppercase disabled:opacity-30 disabled:cursor-not-allowed"
                          />
                        </td>
                        <td className="p-3">
                          <div className="space-y-2">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                type="button"
                                onClick={() => toggleWorkingInYard(index)}
                                disabled={disableInputs || disableStatusForTraining}
                                className={`flex items-center justify-center w-10 h-10 rounded-lg border-2 transition-all ${
                                  entry.working_in_yard
                                    ? 'bg-blue-500/20 border-blue-500 shadow-lg shadow-blue-500/20'
                                    : 'bg-slate-800/30 border-slate-700 hover:bg-slate-800/50'
                                } disabled:opacity-30 disabled:cursor-not-allowed`}
                                title="Working in Yard"
                              >
                                <Home className={`h-5 w-5 ${entry.working_in_yard ? 'text-blue-400' : 'text-muted-foreground'}`} />
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleDidNotWork(index)}
                                disabled={isLeaveDayForRow || disableStatusForTraining}
                                className={`flex items-center justify-center w-10 h-10 rounded-lg border-2 transition-all ${
                                  entry.did_not_work
                                    ? 'bg-amber-500/20 border-amber-500 shadow-lg shadow-amber-500/20'
                                    : 'bg-slate-800/30 border-slate-700 hover:bg-slate-800/50'
                                } disabled:opacity-30 disabled:cursor-not-allowed`}
                                title="Did Not Work"
                              >
                                <XCircle className={`h-5 w-5 ${entry.did_not_work ? 'text-amber-400' : 'text-muted-foreground'}`} />
                              </button>

                              <button
                                type="button"
                                onClick={() => toggleSubsistencePayment(index)}
                                disabled={disableInputs}
                                aria-pressed={entry.subsistence_payment_required}
                                className={`flex items-center justify-center w-10 h-10 rounded-lg border-2 transition-all ${
                                  entry.subsistence_payment_required
                                    ? 'bg-emerald-500/20 border-emerald-500 shadow-lg shadow-emerald-500/20'
                                    : 'bg-slate-800/30 border-slate-700 hover:bg-slate-800/50'
                                } disabled:opacity-30 disabled:cursor-not-allowed`}
                                title="Subsistence Payment"
                              >
                                <Moon className={`h-5 w-5 ${entry.subsistence_payment_required ? 'text-emerald-400' : 'text-muted-foreground'}`} />
                              </button>

                              {hasTrainingBooking && (
                                <button
                                  type="button"
                                  onClick={() => handleTrainingStatusToggle(index)}
                                  disabled={decliningTraining}
                                  className="flex items-center justify-center w-10 h-10 rounded-lg border-2 transition-all bg-emerald-500/20 border-emerald-500 shadow-lg shadow-emerald-500/20 disabled:opacity-30 disabled:cursor-not-allowed"
                                  title="Training"
                                >
                                  <User className="h-5 w-5 text-emerald-400" />
                                </button>
                              )}
                            </div>
                            {(hasTrainingBooking || hasPendingTrainingBooking || dayOffState?.leaveLabels.length || entry.did_not_work) ? (
                              <div className="flex justify-center">
                                {(dayOffState?.leaveLabels.length || hasTrainingBooking || hasPendingTrainingBooking) ? (
                                  <div className="space-y-1 text-center">
                                    {hasTrainingBooking && (
                                      <p
                                        className="text-[10px] font-semibold text-emerald-400"
                                        style={getLeaveLabelStyle(dayOffState?.trainingReasonColor)}
                                      >
                                        {getTrainingLabel(dayOffState)}
                                      </p>
                                    )}
                                    {hasPendingTrainingBooking && (
                                      <p className="text-[10px] font-semibold text-sky-400">
                                        {getPendingTrainingLabel(dayOffState)}
                                      </p>
                                    )}
                                    {dayOffState?.leaveLabels.map((label, labelIndex) => (
                                      <p
                                        key={`${label.reasonName}-${label.session}-${labelIndex}`}
                                        className="text-[10px] font-semibold text-amber-400"
                                        style={getLeaveLabelStyle(label.color)}
                                      >
                                        {label.label}
                                      </p>
                                    ))}
                                    {halfDayTrainingHelperText && (
                                      <p className="max-w-40 text-[10px] font-medium text-emerald-200">
                                        {halfDayTrainingHelperText}
                                      </p>
                                    )}
                                  </div>
                                ) : (
                                  <p
                                    className="text-[10px] text-center font-semibold text-amber-400"
                                    style={getDidNotWorkAutoStyle(dayOffState)}
                                  >
                                    {getDidNotWorkAutoLabel(dayOffState)}
                                  </p>
                                )}
                              </div>
                            ) : null}
                          </div>
                        </td>
                        <td className="p-3 text-right font-semibold text-timesheet">
                          {leaveAwareTotals.rowByDay.get(entry.day_of_week)?.display ?? `${formatHours(entry.daily_total)}h`}
                        </td>
                        <td className="p-3">
                          <Input
                            value={entry.remarks}
                            onChange={(event) => updateEntryField(index, 'remarks', event.target.value)}
                            placeholder="Notes"
                            disabled={isLeaveDayForRow}
                            className="bg-slate-900/50 border-slate-600 text-white placeholder:text-muted-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                          />
                        </td>
                      </tr>
                      <tr className="border-b border-border/50">
                        <td colSpan={8} className="p-3 pt-1">
                          {rowErrors[index] && (
                            <p className="mb-2 text-xs text-red-300">{rowErrors[index]}</p>
                          )}
                          <div className="rounded-lg border border-[hsl(var(--timesheet-primary)/0.30)] bg-[hsl(var(--timesheet-primary)/0.10)] px-3">
                            <Accordion type="single" collapsible className="w-full">
                              <AccordionItem value={`desktop-extra-${entry.day_of_week}`} className="border-0">
                                <AccordionTrigger className="justify-center gap-2 text-center text-sm font-medium text-foreground">
                                  Additional Fields
                                </AccordionTrigger>
                                <AccordionContent className="pb-3">
                                  <div className="grid grid-cols-7 gap-3 items-end">
                                    <div className="space-y-1 min-w-0">
                                      <Label>Machine Start Time</Label>
                                      <Input
                                        type="time"
                                        step="900"
                                        value={entry.machine_start_time}
                                        onChange={(event) => updateEntryField(index, 'machine_start_time', event.target.value)}
                                        disabled={disableInputs}
                                        min={workWindow?.start}
                                        max={workWindow?.end}
                                        className="h-10 bg-slate-900/50 border-slate-600 text-white"
                                      />
                                    </div>
                                    <div className="space-y-1 min-w-0">
                                      <Label>Machine Finish Time</Label>
                                      <Input
                                        type="time"
                                        step="900"
                                        value={entry.machine_finish_time}
                                        onChange={(event) => updateEntryField(index, 'machine_finish_time', event.target.value)}
                                        disabled={disableInputs}
                                        min={workWindow?.start}
                                        max={workWindow?.end}
                                        className="h-10 bg-slate-900/50 border-slate-600 text-white"
                                      />
                                    </div>
                                    <div className="space-y-1 min-w-0">
                                      <Label>Total</Label>
                                      <p className="h-10 flex items-center text-sm font-semibold text-timesheet">
                                        {formatDerivedHours(entry.machine_working_hours) || '0.00'}
                                      </p>
                                    </div>
                                    <div className="space-y-1 min-w-0">
                                      <Label>Machine Travel Hours</Label>
                                      <Input
                                        type="number"
                                        min="0"
                                        step="0.25"
                                        value={entry.machine_travel_hours}
                                        onChange={(event) => updateEntryField(index, 'machine_travel_hours', event.target.value)}
                                        disabled={disableInputs}
                                        className="h-10 bg-slate-900/50 border-slate-600 text-white"
                                      />
                                    </div>
                                    <div className="space-y-1 min-w-0">
                                      <Label>Machine Standing Hours</Label>
                                      <Input
                                        type="number"
                                        min="0"
                                        step="0.25"
                                        value={entry.machine_standing_hours}
                                        onChange={(event) => updateEntryField(index, 'machine_standing_hours', event.target.value)}
                                        disabled={disableInputs}
                                        className="h-10 bg-slate-900/50 border-slate-600 text-white"
                                      />
                                    </div>
                                    <div className="space-y-1 min-w-0">
                                      <Label>Maintenance / Breakdown Hours</Label>
                                      <Input
                                        type="number"
                                        min="0"
                                        step="0.25"
                                        value={entry.maintenance_breakdown_hours}
                                        onChange={(event) => updateEntryField(index, 'maintenance_breakdown_hours', event.target.value)}
                                        disabled={disableInputs}
                                        className="h-10 bg-slate-900/50 border-slate-600 text-white"
                                      />
                                    </div>
                                    <div className="space-y-1 min-w-0">
                                      <Label>Operator Total</Label>
                                      <p className="h-10 flex items-center text-sm font-semibold text-timesheet">
                                        {formatDerivedHours(parseHoursInput(entry.machine_operator_hours)) || '0.00'}
                                      </p>
                                    </div>
                                  </div>
                                </AccordionContent>
                              </AccordionItem>
                            </Accordion>
                          </div>
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
                <tr className="bg-timesheet/10 font-bold">
                  <td colSpan={6} className="p-3 text-right text-white">
                    Weekly Total:
                  </td>
                  <td className="p-3 text-right text-lg text-timesheet whitespace-pre-line">
                    {weeklyTotalMultiline}
                  </td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {Object.values(rowErrors).length > 0 && (
        <Card className="border-red-500/40 bg-red-500/10">
          <CardContent className="pt-4 space-y-2">
            {Object.values(rowErrors).map((message) => (
              <p key={message} className="text-sm text-red-200">{message}</p>
            ))}
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-red-500/40 bg-red-500/10">
          <CardContent className="pt-4">
            <p className="text-sm text-red-200">{error}</p>
          </CardContent>
        </Card>
      )}

      <div className="hidden md:block p-4 bg-slate-800/40 border border-border/50 rounded-lg backdrop-blur-xl">
        <p className="text-sm text-muted-foreground italic">
          ✓ All time and other details are correct and should be used as a basis for wages etc.
        </p>
      </div>

      <div className="hidden md:flex flex-row gap-3 justify-end">
        <Button
          variant="outline"
          onClick={handleSaveDraft}
          disabled={saving}
          className="border-slate-600 text-white hover:bg-slate-800"
        >
          <Save className="h-4 w-4 mr-2" />
          Save as Draft
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={saving}
          className="bg-timesheet hover:bg-timesheet/90 text-slate-900 font-semibold"
        >
          {saving ? 'Submitting...' : 'Submit Timesheet'}
        </Button>
      </div>

      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-slate-900/95 backdrop-blur-xl border-t border-border/50 p-4 z-20">
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={handleSaveDraft}
            disabled={saving}
            className="flex-1 h-14 border-slate-600 text-white hover:bg-slate-800"
          >
            <Save className="h-5 w-5 mr-2" />
            Save Draft
          </Button>
          <Button
            onClick={() => {
              const allDaysComplete = entries.every((entry, idx) => isPlantEntryComplete(entry, getOffDayForIndex(idx)));
              if (allDaysComplete) {
                handleSubmit();
                return;
              }

              const currentIndex = parseInt(activeDay, 10);
              const nextIncompleteIndex = entries.findIndex((entry, idx) => {
                return idx > currentIndex && !isPlantEntryComplete(entry, getOffDayForIndex(idx));
              });

              const finalIndex = nextIncompleteIndex !== -1
                ? nextIncompleteIndex
                : entries.findIndex((entry, idx) => !isPlantEntryComplete(entry, getOffDayForIndex(idx)));

              if (finalIndex !== -1) {
                setActiveDay(String(finalIndex));
              }
            }}
            disabled={saving}
            className="flex-1 h-14 bg-timesheet hover:bg-timesheet/90 text-slate-900 font-semibold text-base"
          >
            {saving ? 'Submitting...' : (() => {
              const allDaysComplete = entries.every((entry, idx) => isPlantEntryComplete(entry, getOffDayForIndex(idx)));
              return allDaysComplete ? 'Submit' : 'Next';
            })()}
          </Button>
        </div>
      </div>

      <TrainingDeclineDialog
        open={trainingDeclineDayIndex !== null}
        dayLabel={trainingDeclineDayIndex === null ? '' : DAY_NAMES[trainingDeclineDayIndex]}
        trainingLabel={
          trainingDeclineDayIndex === null
            ? 'Training'
            : getTrainingLabel(getOffDayForIndex(trainingDeclineDayIndex))
        }
        pending={decliningTraining}
        onCancel={handleCancelTrainingDecline}
        onConfirm={handleConfirmTrainingDecline}
      />

      <DidNotWorkReasonDialog
        key={didNotWorkReasonDayIndex ?? 'closed'}
        open={didNotWorkReasonDayIndex !== null}
        dayName={didNotWorkReasonDayIndex === null ? '' : DAY_NAMES[didNotWorkReasonDayIndex]}
        initialReason={
          didNotWorkReasonDayIndex === null ? '' : parseDidNotWorkReasonRemark(entries[didNotWorkReasonDayIndex]?.remarks)
        }
        onOpenChange={(open) => {
          if (!open) setDidNotWorkReasonDayIndex(null);
        }}
        onConfirm={handleDidNotWorkReasonConfirm}
      />

      <Dialog open={showSignatureDialog} onOpenChange={setShowSignatureDialog}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-lg overflow-y-auto border-border text-white">
          <DialogHeader>
            <DialogTitle className="text-white text-xl">Sign Plant Timesheet</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Please sign below to confirm your plant timesheet is accurate.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <SignaturePad
              onSave={handleSignatureComplete}
              onCancel={() => setShowSignatureDialog(false)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowSignatureDialog(false)}
              className="border-slate-600 text-white hover:bg-slate-800"
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
