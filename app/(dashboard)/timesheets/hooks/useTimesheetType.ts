/**
 * useTimesheetType Hook
 * 
 * Fetches the appropriate timesheet type for a user based on their team.
 * Falls back to the legacy role-level setting, then the default type.
 * 
 * Phase 5: Dynamic Routing
 */

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { isNetworkFetchError } from '@/lib/utils/http-error';
import { DEFAULT_TIMESHEET_TYPE, TimesheetType } from '../types/registry';

export type TimesheetTypeResolutionMode = 'fixed' | 'choice';

interface UseTimesheetTypeReturn {
  timesheetType: TimesheetType | null;
  mode: TimesheetTypeResolutionMode;
  loading: boolean;
  error: string | null;
}

export interface TimesheetTypeResolution {
  timesheetType: TimesheetType | null;
  mode: TimesheetTypeResolutionMode;
}

interface ProfileTimesheetTypeRow {
  team?: { timesheet_type?: string | null } | Array<{ timesheet_type?: string | null }> | null;
  role?: { timesheet_type?: string | null } | Array<{ timesheet_type?: string | null }> | null;
}

interface TimesheetTypeOverrideRow {
  timesheet_type?: string | null;
}

function pickFirstRow<T>(rows: T[] | null | undefined): T | null {
  return rows?.[0] ?? null;
}

function pickSingleRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message?: unknown }).message ?? '');
  }
  return String(error ?? '');
}

function isMissingTeamTimesheetTypeError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return /org_teams.*timesheet_type.*does not exist|timesheet_type.*does not exist/i.test(message);
}

function isMissingTimesheetOverrideSchemaError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return /timesheet_type_exceptions.*does not exist|relation.*timesheet_type_exceptions|schema cache/i.test(message);
}

export function normalizeTimesheetType(value: unknown): TimesheetType | null {
  if (value === 'civils' || value === 'plant') return value;
  return null;
}

export function normalizeTimesheetTypeOverride(value: unknown): TimesheetType | 'user_choice' | null {
  if (value === 'user_choice') return 'user_choice';
  return normalizeTimesheetType(value);
}

export function resolveTimesheetTypeWithOverride(params: {
  overrideType?: unknown;
  teamType?: unknown;
  roleType?: unknown;
}): TimesheetTypeResolution {
  const overrideType = normalizeTimesheetTypeOverride(params.overrideType);
  if (overrideType === 'user_choice') {
    return { timesheetType: null, mode: 'choice' };
  }

  const teamType = normalizeTimesheetType(params.teamType);
  const roleType = normalizeTimesheetType(params.roleType);
  return { timesheetType: overrideType || teamType || roleType || DEFAULT_TIMESHEET_TYPE, mode: 'fixed' };
}

async function fetchRoleTimesheetType(supabase: ReturnType<typeof createClient>, userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select(`
      role:roles (
        timesheet_type
      )
    `)
    .eq('id', userId)
    .limit(1);

  if (error) throw error;

  const profileRow = pickFirstRow((data || []) as ProfileTimesheetTypeRow[]);
  const roleData = pickSingleRelation(profileRow?.role);
  return (roleData?.timesheet_type || DEFAULT_TIMESHEET_TYPE) as TimesheetType;
}

export function useTimesheetType(userId?: string): UseTimesheetTypeReturn {
  const [timesheetType, setTimesheetType] = useState<TimesheetType | null>(null);
  const [mode, setMode] = useState<TimesheetTypeResolutionMode>('fixed');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    async function fetchTimesheetType() {
      if (!userId) {
        setTimesheetType(DEFAULT_TIMESHEET_TYPE);
        setMode('fixed');
        setLoading(false);
        return;
      }

      try {
        // Precedence for new sheets:
        // user override -> team default -> role fallback -> civils.
        const [
          { data, error: fetchError },
          { data: overrideData, error: overrideError },
        ] = await Promise.all([
          supabase
            .from('profiles')
            .select(`
              team:org_teams!profiles_team_id_fkey (
                timesheet_type
              ),
              role:roles (
                timesheet_type
              )
            `)
            .eq('id', userId)
            .limit(1),
          supabase
            .from('timesheet_type_exceptions')
            .select('timesheet_type')
            .eq('profile_id', userId)
            .order('updated_at', { ascending: false })
            .limit(2),
        ]);

        if (overrideError && !isMissingTimesheetOverrideSchemaError(overrideError)) {
          throw overrideError;
        }

        const overrideRow = pickFirstRow((overrideData || []) as TimesheetTypeOverrideRow[]);
        if ((overrideData?.length ?? 0) > 1) {
          console.warn('Multiple timesheet_type_exceptions rows found for profile; using the latest row.', {
            userId,
          });
        }
        const overrideType = normalizeTimesheetTypeOverride(overrideRow?.timesheet_type);

        if (fetchError) {
          if (isMissingTeamTimesheetTypeError(fetchError)) {
            const fallbackType = await fetchRoleTimesheetType(supabase, userId);
            if (overrideType === 'user_choice') {
              setTimesheetType(null);
              setMode('choice');
            } else {
              setTimesheetType((overrideType || fallbackType) as TimesheetType);
              setMode('fixed');
            }
            setError(null);
            return;
          }
          throw fetchError;
        }

        const profileRow = pickFirstRow((data || []) as ProfileTimesheetTypeRow[]);
        if (!profileRow) {
          if (overrideType === 'user_choice') {
            setTimesheetType(null);
            setMode('choice');
          } else {
            setTimesheetType((overrideType || DEFAULT_TIMESHEET_TYPE) as TimesheetType);
            setMode('fixed');
          }
          setError(null);
          return;
        }

        const teamData = pickSingleRelation(profileRow.team);
        const roleData = pickSingleRelation(profileRow.role);
        const resolution = resolveTimesheetTypeWithOverride({
          overrideType,
          teamType: teamData?.timesheet_type,
          roleType: roleData?.timesheet_type,
        });

        setTimesheetType(resolution.timesheetType);
        setMode(resolution.mode);
        setError(null);
      } catch (err) {
        if (!isNetworkFetchError(err)) {
          console.error('Error fetching timesheet type:', err);
          setError(getErrorMessage(err) || 'Failed to fetch timesheet type');
        } else {
          setError(null);
        }
        
        // Fallback to default on error
        setTimesheetType(DEFAULT_TIMESHEET_TYPE);
        setMode('fixed');
      } finally {
        setLoading(false);
      }
    }

    fetchTimesheetType();
  }, [userId, supabase]);

  return { timesheetType, mode, loading, error };
}
