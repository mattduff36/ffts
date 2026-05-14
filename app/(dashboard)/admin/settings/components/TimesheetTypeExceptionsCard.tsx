'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { fetchUserDirectory } from '@/lib/client/user-directory';
import {
  TimesheetTypeOptions,
  getTimesheetTypeLabel,
} from '@/app/(dashboard)/timesheets/types/registry';
import { Loader2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { TimesheetTypeExceptionMatrixResponse } from '@/types/timesheet-type-exceptions';

interface DirectoryEntry {
  id: string;
  full_name: string | null;
  employee_id: string | null;
  role?: {
    name?: string | null;
    display_name?: string | null;
  } | null;
  team?: {
    id?: string | null;
    name?: string | null;
  } | null;
}

export function TimesheetTypeExceptionsCard() {
  const [matrix, setMatrix] = useState<TimesheetTypeExceptionMatrixResponse | null>(null);
  const [directory, setDirectory] = useState<DirectoryEntry[]>([]);
  const [loadingMatrix, setLoadingMatrix] = useState(false);
  const [loadingDirectory, setLoadingDirectory] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [addingUser, setAddingUser] = useState(false);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const [removingRowId, setRemovingRowId] = useState<string | null>(null);

  const loadMatrix = useCallback(async () => {
    setLoadingMatrix(true);
    try {
      const response = await fetch('/api/admin/settings/timesheet-exceptions', { cache: 'no-store' });
      const payload = (await response.json()) as (TimesheetTypeExceptionMatrixResponse & { error?: string });
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load timesheet overrides');
      }
      setMatrix({ rows: payload.rows || [] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load timesheet overrides');
    } finally {
      setLoadingMatrix(false);
    }
  }, []);

  const loadDirectory = useCallback(async () => {
    setLoadingDirectory(true);
    try {
      const users = (await fetchUserDirectory({ includeRole: true, module: 'timesheets' })) as DirectoryEntry[];
      setDirectory(users);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load user directory');
    } finally {
      setLoadingDirectory(false);
    }
  }, []);

  useEffect(() => {
    void Promise.all([loadMatrix(), loadDirectory()]);
  }, [loadDirectory, loadMatrix]);

  const availableUsers = useMemo(() => {
    const existingIds = new Set((matrix?.rows || []).map((row) => row.profile_id));
    return directory
      .filter((user) => !existingIds.has(user.id))
      .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
  }, [directory, matrix?.rows]);
  const rows = matrix?.rows || [];

  async function handleAddUser() {
    if (!selectedUserId) return;
    setAddingUser(true);
    try {
      const response = await fetch('/api/admin/settings/timesheet-exceptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: selectedUserId }),
      });
      const payload = (await response.json()) as (TimesheetTypeExceptionMatrixResponse & { error?: string });
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to add override row');
      }
      setMatrix({ rows: payload.rows || [] });
      setSelectedUserId('');
      toast.success('User added to timesheet override matrix');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add override row');
    } finally {
      setAddingUser(false);
    }
  }

  async function handleUpdateOverride(profileId: string, timesheetType: 'civils' | 'plant' | null) {
    setSavingRowId(profileId);
    try {
      const response = await fetch(`/api/admin/settings/timesheet-exceptions/${profileId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timesheet_type: timesheetType }),
      });
      const payload = (await response.json()) as (TimesheetTypeExceptionMatrixResponse & { error?: string });
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to update override');
      }
      setMatrix({ rows: payload.rows || [] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update override');
    } finally {
      setSavingRowId(null);
    }
  }

  async function handleRemoveRow(profileId: string) {
    setRemovingRowId(profileId);
    try {
      const response = await fetch(`/api/admin/settings/timesheet-exceptions/${profileId}`, {
        method: 'DELETE',
      });
      const payload = (await response.json()) as (TimesheetTypeExceptionMatrixResponse & { error?: string });
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to remove override row');
      }
      setMatrix({ rows: payload.rows || [] });
      toast.success('Override row removed');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to remove override row');
    } finally {
      setRemovingRowId(null);
    }
  }

  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle className="text-white">Timesheet Overrides</CardTitle>
        <CardDescription className="text-muted-foreground">
          Override the default team timesheet type for individual users.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
            <div className="space-y-1.5">
              <Label htmlFor="timesheet-exception-user" className="text-white font-medium">
                Add User Override
              </Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId} disabled={addingUser || loadingDirectory}>
                <SelectTrigger id="timesheet-exception-user" className="bg-slate-950 border-border text-foreground">
                  <SelectValue placeholder={loadingDirectory ? 'Loading users...' : 'Select user'} />
                </SelectTrigger>
                <SelectContent className="bg-slate-950 border-border text-foreground max-h-72">
                  {availableUsers.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {(user.full_name || 'Unknown user') +
                        (user.employee_id ? ` (${user.employee_id})` : '') +
                        (user.role?.display_name ? ` - ${user.role.display_name}` : '')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              onClick={handleAddUser}
              disabled={!selectedUserId || addingUser}
              className="bg-brand-yellow hover:bg-brand-yellow-hover text-slate-900"
            >
              {addingUser ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
              Add User
            </Button>
          </div>
        </div>

        <div className="border border-slate-700 rounded-lg overflow-auto">
          {loadingMatrix ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading timesheet override matrix...
            </div>
          ) : rows.length === 0 ? (
            <div className="py-14 text-center text-muted-foreground">
              No user overrides yet. Add a user to create their override row.
            </div>
          ) : (
            <table className="w-full text-sm min-w-[920px]">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-900">
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">User</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Team Default</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Override</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Effective</th>
                  <th className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isSaving = savingRowId === row.profile_id;
                  const isRemoving = removingRowId === row.profile_id;
                  const overrideValue = row.override_timesheet_type || 'default';
                  return (
                    <tr key={row.profile_id} className="border-b border-slate-800/70">
                      <td className="px-3 py-2 align-top">
                        <div className="font-medium text-white">{row.full_name}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {row.employee_id ? (
                            <Badge variant="outline" className="border-slate-600 text-muted-foreground text-[10px] px-1.5 py-0">
                              {row.employee_id}
                            </Badge>
                          ) : null}
                          {row.role_display_name ? (
                            <Badge variant="outline" className="border-slate-600 text-muted-foreground text-[10px] px-1.5 py-0">
                              {row.role_display_name}
                            </Badge>
                          ) : null}
                          {row.team_name ? (
                            <Badge variant="outline" className="border-slate-600 text-muted-foreground text-[10px] px-1.5 py-0">
                              {row.team_name}
                            </Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-slate-300">
                        {getTimesheetTypeLabel(row.team_timesheet_type)}
                      </td>
                      <td className="px-3 py-2 min-w-[220px]">
                        <Select
                          value={overrideValue}
                          disabled={isSaving || isRemoving}
                          onValueChange={(value) => {
                            const nextValue = value === 'default' ? null : (value as 'civils' | 'plant');
                            void handleUpdateOverride(row.profile_id, nextValue);
                          }}
                        >
                          <SelectTrigger className="bg-slate-950 border-border text-foreground">
                            <SelectValue placeholder="Use team default" />
                          </SelectTrigger>
                          <SelectContent className="bg-slate-950 border-border text-foreground">
                            <SelectItem value="default">Use team default</SelectItem>
                            {TimesheetTypeOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-3 py-2 text-white">
                        <div className="flex items-center gap-2">
                          <span>{getTimesheetTypeLabel(row.effective_timesheet_type)}</span>
                          {row.override_timesheet_type ? (
                            <Badge className="bg-sky-600/30 text-sky-200 border border-sky-500/40">Override</Badge>
                          ) : (
                            <Badge variant="outline" className="border-slate-600 text-muted-foreground">Default</Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleUpdateOverride(row.profile_id, null)}
                            disabled={isSaving || isRemoving || row.override_timesheet_type === null}
                            className="h-8 px-2 text-slate-300 hover:text-white hover:bg-slate-800"
                            title="Reset to team default"
                          >
                            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveRow(row.profile_id)}
                            disabled={isRemoving || isSaving}
                            className="h-8 px-2 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                            title="Remove user row"
                          >
                            {isRemoving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
