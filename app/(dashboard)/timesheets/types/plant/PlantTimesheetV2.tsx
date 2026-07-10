'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { fetchUserDirectory } from '@/lib/client/user-directory';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BackButton } from '@/components/ui/back-button';
import { PanelLoader } from '@/components/ui/panel-loader';
import { AlertCircle, Save, Send, User } from 'lucide-react';
import { DAY_NAMES } from '@/types/timesheet';
import { formatHours, roundTimeToNearestQuarterHour } from '@/lib/utils/time-calculations';
import { SignaturePad } from '@/components/forms/SignaturePad';
import { Database } from '@/types/database';
import { isAdminRole } from '@/lib/utils/role-access';
import { Employee } from '@/types/common';
import { toast } from 'sonner';
import { isSubsistencePaymentRequired } from '@/lib/utils/timesheet-subsistence';
import {
  buildValidationErrors,
  createBlankEntry,
  parseHoursInput,
  recalculateEntry,
  toHoursInput,
  type PlantEntryDraft,
} from './plant-timesheet-v2-utils';
import { isDuplicateTimesheetWeekError } from '@/lib/utils/timesheet-errors';

interface PlantTimesheetV2Props {
  weekEnding: string;
  existingId: string | null;
  userId?: string;
}

const QUARTER_HOUR_TIME_FIELDS: ReadonlySet<keyof PlantEntryDraft> = new Set([
  'time_started',
  'time_finished',
  'machine_start_time',
  'machine_finish_time',
]);

function formatDerivedHours(value: number | null): string {
  if (value === null) return '';
  return value.toFixed(2);
}

export function PlantTimesheetV2({
  weekEnding: initialWeekEnding,
  existingId: initialExistingId,
  userId: managerSelectedUserId,
}: PlantTimesheetV2Props) {
  const router = useRouter();
  const { user, profile, loading: authLoading, isManager, isAdmin, isSuperAdmin } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const hasElevatedPermissions = isSuperAdmin || isManager || isAdmin;

  const [existingTimesheetId, setExistingTimesheetId] = useState<string | null>(initialExistingId);
  const [weekEnding, setWeekEnding] = useState(initialWeekEnding || '');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>(managerSelectedUserId || user?.id || '');
  const [employees, setEmployees] = useState<Employee[]>([]);

  const [regNumber, setRegNumber] = useState('');
  const [siteAddress, setSiteAddress] = useState('');
  const [hirerName, setHirerName] = useState('');
  const [managerComments, setManagerComments] = useState('');

  const [entries, setEntries] = useState<PlantEntryDraft[]>(
    Array.from({ length: 7 }, (_, index) => createBlankEntry(index + 1))
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [existingTimesheetLoaded, setExistingTimesheetLoaded] = useState(!initialExistingId);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [showSignatureDialog, setShowSignatureDialog] = useState(false);

  const weeklyTotal = useMemo(
    () => entries.reduce((sum, entry) => sum + (entry.daily_total || 0), 0),
    [entries]
  );
  const selectedEmployeeName = useMemo(() => {
    if (selectedEmployeeId === user?.id) {
      return profile?.full_name || user?.email || '';
    }
    const employee = employees.find((item) => item.id === selectedEmployeeId);
    return employee?.full_name || '';
  }, [selectedEmployeeId, employees, user, profile]);

  useEffect(() => {
    if (!user) return;
    if (hasElevatedPermissions) {
      const loadEmployees = async () => {
        try {
          const directory = await fetchUserDirectory({ module: 'timesheets' });
          setEmployees(
            directory.map((employee) => ({
              id: employee.id,
              full_name: employee.full_name || 'Unknown User',
              employee_id: employee.employee_id,
              has_module_access: employee.has_module_access,
            }))
          );
        } catch (fetchError) {
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
      };
      void loadEmployees();
    } else {
      setSelectedEmployeeId(user.id);
    }
  }, [user, hasElevatedPermissions]);

  useEffect(() => {
    if (!initialExistingId || !user || !profile || authLoading) return;
    let cancelled = false;

    const loadExisting = async () => {
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
        setRegNumber(timesheetData.reg_number || '');
        setSiteAddress(timesheetData.site_address || '');
        setHirerName(timesheetData.hirer_name || '');
        setManagerComments(timesheetData.manager_comments || '');

        const { data: entriesData, error: entriesError } = await supabase
          .from('timesheet_entries')
          .select('*')
          .eq('timesheet_id', timesheetData.id)
          .order('day_of_week');

        if (entriesError) throw entriesError;
        const typedEntries = (entriesData || []) as Database['public']['Tables']['timesheet_entries']['Row'][];

        const fullWeek = Array.from({ length: 7 }, (_, index) => {
          const dayOfWeek = index + 1;
          const existingEntry = typedEntries.find((entry) => entry.day_of_week === dayOfWeek);
          if (!existingEntry) {
            return createBlankEntry(dayOfWeek);
          }

          const mappedEntry: PlantEntryDraft = {
            day_of_week: dayOfWeek,
            did_not_work: existingEntry.did_not_work || false,
            didNotWorkReason: null,
            job_number: existingEntry.job_number || '',
            job_numbers: existingEntry.job_number ? [existingEntry.job_number] : [],
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
          setExistingTimesheetLoaded(true);
        }
      }
    };

    void loadExisting();

    return () => {
      cancelled = true;
    };
  }, [initialExistingId, user, profile, authLoading, supabase, router]);

  const updateEntryField = (dayIndex: number, field: keyof PlantEntryDraft, value: string | boolean) => {
    const normalizedValue =
      typeof value === 'string' && QUARTER_HOUR_TIME_FIELDS.has(field)
        ? roundTimeToNearestQuarterHour(value)
        : value;

    setEntries((current) => {
      const next = [...current];
      const updated = recalculateEntry({
        ...next[dayIndex],
        [field]: normalizedValue,
      } as PlantEntryDraft);
      next[dayIndex] = updated;
      return next;
    });
  };

  const saveTimesheet = async (status: 'draft' | 'submitted', signatureData?: string) => {
    if (!user || !selectedEmployeeId || !weekEnding) return;

    const validationErrors = buildValidationErrors(entries);
    setRowErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      setError('Please complete required operator/machine times for rows with plant data.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      let timesheetId = existingTimesheetId;

      if (timesheetId) {
        type TimesheetUpdate = Database['public']['Tables']['timesheets']['Update'];
        const timesheetData: TimesheetUpdate = {
          timesheet_type: 'plant',
          template_version: 2,
          reg_number: regNumber || null,
          site_address: siteAddress || null,
          hirer_name: hirerName || null,
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
          reg_number: regNumber || null,
          site_address: siteAddress || null,
          hirer_name: hirerName || null,
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
        const recalculated = recalculateEntry(entry);
        const operatorTravel = parseHoursInput(recalculated.operator_travel_hours);
        const operatorYard = parseHoursInput(recalculated.operator_yard_hours);
        const machineTravel = parseHoursInput(recalculated.machine_travel_hours);
        const machineStanding = parseHoursInput(recalculated.machine_standing_hours);
        const machineOperator = parseHoursInput(recalculated.machine_operator_hours);
        const maintenanceBreakdown = parseHoursInput(recalculated.maintenance_breakdown_hours);

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
          job_number: null,
          working_in_yard: (operatorYard || 0) > 0,
          subsistence_payment_required: false,
          did_not_work: recalculated.did_not_work,
          night_shift: false,
          bank_holiday: false,
          remarks: recalculated.remarks || null,
        };
      });

      const { error: entriesError } = await supabase
        .from('timesheet_entries')
        .insert(entriesToInsert);

      if (entriesError) throw entriesError;

      if (status === 'draft') {
        toast.success('Plant timesheet saved as draft');
      } else {
        toast.success('Plant timesheet submitted');
      }

      router.push('/timesheets');
    } catch (saveError) {
      const isDuplicateTimesheetError = isDuplicateTimesheetWeekError(saveError);
      if (!isDuplicateTimesheetError) {
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
    const validationErrors = buildValidationErrors(entries);
    setRowErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      setError('Please complete required operator/machine times for rows with plant data.');
      return;
    }
    setShowSignatureDialog(true);
  };

  const handleSignatureComplete = async (signatureData: string) => {
    setShowSignatureDialog(false);
    await saveTimesheet('submitted', signatureData);
  };

  if (initialExistingId && !existingTimesheetLoaded) {
    return <PanelLoader message="Loading plant timesheet..." accent="timesheet" className="min-h-[320px]" />;
  }

  return (
    <div className="space-y-6 max-w-[1400px] pb-24 md:pb-6">
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-border">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-4">
            <BackButton />
            <div>
              <h1 className="text-3xl font-bold text-foreground mb-2">
                {existingTimesheetId ? 'Edit Plant Timesheet (V2)' : 'New Plant Timesheet (V2)'}
              </h1>
              <p className="text-muted-foreground">
                Week ending {new Date(weekEnding).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            </div>
          </div>
          <div className="bg-timesheet/10 dark:bg-timesheet/20 border border-timesheet/30 rounded-lg px-3 py-2">
            <div className="text-xs text-muted-foreground">Total Working Hours</div>
            <div className="text-lg font-bold text-foreground">{formatHours(weeklyTotal)}h</div>
          </div>
        </div>
      </div>

      {managerComments && (
        <Card className="border-amber-300/40 bg-amber-500/10">
          <CardHeader>
            <CardTitle className="text-amber-200 flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Manager Comments
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-amber-100 whitespace-pre-wrap">{managerComments}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Plant Timesheet Details</CardTitle>
          <CardDescription className="text-muted-foreground">
            Template v2 is only used for new plant timesheets.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {hasElevatedPermissions && (
            <div className="space-y-2">
              <Label htmlFor="employee" className="text-foreground text-base flex items-center gap-2">
                <User className="h-4 w-4" />
                Creating timesheet for
              </Label>
              <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId} disabled={Boolean(existingTimesheetId)}>
                <SelectTrigger className="h-11 bg-slate-900/50 border-slate-600 text-white">
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="machine">Machine</Label>
              <Input
                id="machine"
                value={regNumber}
                onChange={(event) => setRegNumber(event.target.value)}
                placeholder="Machine / registration"
                className="bg-slate-900/50 border-slate-600 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="operator">Operator</Label>
              <Input
                id="operator"
                value={selectedEmployeeName}
                readOnly
                className="bg-slate-900/50 border-slate-600 text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="hirer">Hirer</Label>
              <Input
                id="hirer"
                value={hirerName}
                onChange={(event) => setHirerName(event.target.value)}
                placeholder="Hirer name"
                className="bg-slate-900/50 border-slate-600 text-white"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="site-address">Site Address</Label>
            <Input
              id="site-address"
              value={siteAddress}
              onChange={(event) => setSiteAddress(event.target.value)}
              placeholder="Site address"
              className="bg-slate-900/50 border-slate-600 text-white"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Daily Entries</CardTitle>
          <CardDescription className="text-muted-foreground">
            Total Working Hours is calculated as Operator Working + Operator Travel + Operator Yard.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table className="min-w-[1700px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead>Operator Travel</TableHead>
                  <TableHead>Operator Start</TableHead>
                  <TableHead>Operator Finish</TableHead>
                  <TableHead>Operator Yard</TableHead>
                  <TableHead>Operator Working</TableHead>
                  <TableHead>Total Working</TableHead>
                  <TableHead>Machine Travel</TableHead>
                  <TableHead>Machine Start</TableHead>
                  <TableHead>Machine Finish</TableHead>
                  <TableHead>Machine Working</TableHead>
                  <TableHead>Machine Standing</TableHead>
                  <TableHead>Machine Operator</TableHead>
                  <TableHead>M&apos;tance / Breakdown</TableHead>
                  <TableHead>Remarks</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry, index) => {
                  const disableFields = entry.did_not_work;
                  return (
                    <TableRow key={entry.day_of_week} className={rowErrors[index] ? 'bg-red-500/5' : undefined}>
                      <TableCell className="font-semibold text-foreground">
                        {DAY_NAMES[index]}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          step="0.25"
                          value={entry.operator_travel_hours}
                          onChange={(event) => updateEntryField(index, 'operator_travel_hours', event.target.value)}
                          disabled={disableFields}
                          className="h-9"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="time"
                          step="900"
                          value={entry.time_started}
                          onChange={(event) => updateEntryField(index, 'time_started', event.target.value)}
                          disabled={disableFields}
                          className="h-9"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="time"
                          step="900"
                          value={entry.time_finished}
                          onChange={(event) => updateEntryField(index, 'time_finished', event.target.value)}
                          disabled={disableFields}
                          className="h-9"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          step="0.25"
                          value={entry.operator_yard_hours}
                          onChange={(event) => updateEntryField(index, 'operator_yard_hours', event.target.value)}
                          disabled={disableFields}
                          className="h-9"
                        />
                      </TableCell>
                      <TableCell>
                        <Input value={formatDerivedHours(entry.operator_working_hours)} readOnly className="h-9 bg-muted/30" />
                      </TableCell>
                      <TableCell>
                        <Input value={formatDerivedHours(entry.daily_total)} readOnly className="h-9 bg-muted/30 font-semibold" />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          step="0.25"
                          value={entry.machine_travel_hours}
                          onChange={(event) => updateEntryField(index, 'machine_travel_hours', event.target.value)}
                          disabled={disableFields}
                          className="h-9"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="time"
                          step="900"
                          value={entry.machine_start_time}
                          onChange={(event) => updateEntryField(index, 'machine_start_time', event.target.value)}
                          disabled={disableFields}
                          className="h-9"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="time"
                          step="900"
                          value={entry.machine_finish_time}
                          onChange={(event) => updateEntryField(index, 'machine_finish_time', event.target.value)}
                          disabled={disableFields}
                          className="h-9"
                        />
                      </TableCell>
                      <TableCell>
                        <Input value={formatDerivedHours(entry.machine_working_hours)} readOnly className="h-9 bg-muted/30" />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          step="0.25"
                          value={entry.machine_standing_hours}
                          onChange={(event) => updateEntryField(index, 'machine_standing_hours', event.target.value)}
                          disabled={disableFields}
                          className="h-9"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          step="0.25"
                          value={entry.machine_operator_hours}
                          onChange={(event) => updateEntryField(index, 'machine_operator_hours', event.target.value)}
                          disabled={disableFields}
                          className="h-9"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          step="0.25"
                          value={entry.maintenance_breakdown_hours}
                          onChange={(event) => updateEntryField(index, 'maintenance_breakdown_hours', event.target.value)}
                          disabled={disableFields}
                          className="h-9"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={entry.remarks}
                          onChange={(event) => updateEntryField(index, 'remarks', event.target.value)}
                          placeholder={entry.did_not_work ? 'Did not work (auto-set from approved leave)' : ''}
                          className="h-9"
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
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
          <Send className="h-4 w-4 mr-2" />
          {saving ? 'Submitting...' : 'Submit Timesheet'}
        </Button>
      </div>

      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-slate-900/95 backdrop-blur-xl border-t border-border/50 p-4 z-20">
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={handleSaveDraft}
            disabled={saving}
            className="flex-1 h-12 border-slate-600 text-white hover:bg-slate-800"
          >
            <Save className="h-4 w-4 mr-2" />
            Draft
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saving}
            className="flex-1 h-12 bg-timesheet hover:bg-timesheet/90 text-slate-900 font-semibold"
          >
            <Send className="h-4 w-4 mr-2" />
            Submit
          </Button>
        </div>
      </div>

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
