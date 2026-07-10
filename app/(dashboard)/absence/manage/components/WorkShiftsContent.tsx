'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageLoader } from '@/components/ui/page-loader';
import { applyWorkShiftTemplate, createWorkShiftTemplate, deleteWorkShiftTemplate, fetchWorkShiftMatrix, updateEmployeeWorkShift, updateWorkShiftTemplate } from '@/lib/client/work-shifts';
import { cloneWorkShiftPattern, STANDARD_WORK_SHIFT_PATTERN } from '@/lib/utils/work-shifts';
import type { EmployeeWorkShiftRow, WorkShiftPattern, WorkShiftTemplate } from '@/types/work-shifts';
import { WORK_SHIFT_DAY_LABELS, WORK_SHIFT_DAY_ORDER } from '@/types/work-shifts';
import { ArrowRight, Check, Copy, Loader2, Minus, Pencil, Plus, RefreshCcw, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';

interface TemplateDialogState {
  open: boolean;
  mode: 'create' | 'edit';
  templateId: string | null;
  name: string;
  description: string;
  pattern: WorkShiftPattern;
}

function createTemplateDialogState(): TemplateDialogState {
  return {
    open: false,
    mode: 'create',
    templateId: null,
    name: '',
    description: '',
    pattern: cloneWorkShiftPattern(STANDARD_WORK_SHIFT_PATTERN),
  };
}

function TemplatePatternEditor({
  pattern,
  onChange,
}: {
  pattern: WorkShiftPattern;
  onChange: (pattern: WorkShiftPattern) => void;
}) {
  function toggleCell(cellKey: keyof WorkShiftPattern) {
    onChange({
      ...pattern,
      [cellKey]: !pattern[cellKey],
    });
  }

  return (
    <div className="border border-slate-700 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-900/60">
          <tr>
            <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-muted-foreground">Day</th>
            <th className="px-3 py-2 text-center text-xs uppercase tracking-wide text-muted-foreground">AM</th>
            <th className="px-3 py-2 text-center text-xs uppercase tracking-wide text-muted-foreground">PM</th>
          </tr>
        </thead>
        <tbody>
          {WORK_SHIFT_DAY_ORDER.map((day) => (
            <tr key={day} className="border-t border-slate-700/60">
              <td className="px-3 py-2 text-white">{WORK_SHIFT_DAY_LABELS[day]}</td>
              {(['am', 'pm'] as const).map((session) => {
                const cellKey = `${day}_${session}` as keyof WorkShiftPattern;
                const enabled = pattern[cellKey];

                return (
                  <td key={session} className="px-3 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => toggleCell(cellKey)}
                      className="mx-auto flex h-8 w-8 items-center justify-center rounded border border-slate-600 transition-colors hover:border-slate-400"
                      style={enabled ? { backgroundColor: 'hsl(var(--absence-primary))' } : undefined}
                    >
                      {enabled ? <Check className="h-4 w-4 text-white" /> : <Minus className="h-4 w-4 text-slate-500" />}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function isFirstSessionOfDay(_day: (typeof WORK_SHIFT_DAY_ORDER)[number], session: 'am' | 'pm'): boolean {
  return session === 'am';
}

interface WorkShiftsContentProps {
  isReadOnly?: boolean;
  scopeTeamOnly?: boolean;
  actorTeamId?: string | null;
}

export function WorkShiftsContent({
  isReadOnly = false,
  scopeTeamOnly = false,
  actorTeamId = null,
}: WorkShiftsContentProps) {
  const [templates, setTemplates] = useState<WorkShiftTemplate[]>([]);
  const [employees, setEmployees] = useState<EmployeeWorkShiftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [selectedTeamId, setSelectedTeamId] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [dialogState, setDialogState] = useState<TemplateDialogState>(createTemplateDialogState());
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [savingCells, setSavingCells] = useState<Set<string>>(new Set());
  const [applyingTemplate, setApplyingTemplate] = useState(false);

  const pendingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const rowsRef = useRef<EmployeeWorkShiftRow[]>([]);
  rowsRef.current = employees;

  const fetchMatrix = useCallback(async () => {
    try {
      setLoading(true);
      const payload = await fetchWorkShiftMatrix();
      setTemplates(payload.templates);
      setEmployees(payload.employees);
      setSelectedTemplateId((current) => {
        if (current && payload.templates.some((template) => template.id === current)) {
          return current;
        }
        return '';
      });
    } catch (error) {
      console.error('Error loading work shifts:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to load work shifts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchMatrix();
  }, [fetchMatrix]);

  useEffect(() => {
    const timers = pendingTimers.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) || null,
    [templates, selectedTemplateId]
  );

  const teamOptions = useMemo(() => {
    const byId = new Map<string, string>();
    employees.forEach((employee) => {
      if (!employee.team_id) return;
      if (!byId.has(employee.team_id)) {
        byId.set(employee.team_id, employee.team_name || employee.team_id);
      }
    });
    return Array.from(byId.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [employees]);

  const actorTeamName =
    teamOptions.find((team) => team.id === actorTeamId)?.name || (actorTeamId ? 'My Team' : 'No team assigned');
  const isTeamFilterLocked = scopeTeamOnly;
  const canManageTemplates = !scopeTeamOnly;
  const effectiveTeamFilter = scopeTeamOnly ? (actorTeamId || '__no_team_scope__') : selectedTeamId;

  useEffect(() => {
    if (!scopeTeamOnly) {
      setSelectedTeamId((current) => (current === '__no_team_scope__' ? 'all' : current));
      return;
    }

    setSelectedTeamId(actorTeamId || '__no_team_scope__');
  }, [scopeTeamOnly, actorTeamId]);

  const filteredEmployees = useMemo(() => {
    const term = search.trim().toLowerCase();
    return employees.filter((employee) => {
      if (scopeTeamOnly) {
        if (!actorTeamId) return false;
        if (employee.team_id !== actorTeamId) return false;
      } else if (effectiveTeamFilter !== 'all') {
        if (effectiveTeamFilter === 'unassigned') {
          if (employee.team_id) return false;
        } else if (employee.team_id !== effectiveTeamFilter) {
          return false;
        }
      }

      if (!term) return true;
      return (
        employee.full_name.toLowerCase().includes(term) ||
        (employee.employee_id || '').toLowerCase().includes(term) ||
        (employee.template_name || '').toLowerCase().includes(term)
      );
    });
  }, [employees, search, scopeTeamOnly, actorTeamId, effectiveTeamFilter]);

  async function flushEmployee(profileId: string) {
    const row = rowsRef.current.find((employee) => employee.profile_id === profileId);
    if (!row) {
      return;
    }

    const cellKeys = WORK_SHIFT_DAY_ORDER.flatMap((day) => [
      `${profileId}:${day}:am`,
      `${profileId}:${day}:pm`,
    ]);

    try {
      await updateEmployeeWorkShift(profileId, {
        templateId: row.template_id,
        pattern: row.pattern,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save work shift');
      await fetchMatrix();
    } finally {
      setSavingCells((current) => {
        const next = new Set(current);
        cellKeys.forEach((cellKey) => next.delete(cellKey));
        return next;
      });
    }
  }

  function queueEmployeeSave(profileId: string) {
    const existingTimer = pendingTimers.current.get(profileId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    pendingTimers.current.set(
      profileId,
      setTimeout(() => {
        pendingTimers.current.delete(profileId);
        void flushEmployee(profileId);
      }, 300)
    );
  }

  function toggleEmployeeCell(profileId: string, cellKey: keyof WorkShiftPattern) {
    const cellId = `${profileId}:${cellKey.replace('_', ':')}`;
    setEmployees((current) =>
      current.map((employee) =>
        employee.profile_id === profileId
          ? {
              ...employee,
              template_id: null,
              template_name: null,
              pattern: {
                ...employee.pattern,
                [cellKey]: !employee.pattern[cellKey],
              },
            }
          : employee
      )
    );

    setSavingCells((current) => {
      const next = new Set(current);
      next.add(cellId);
      return next;
    });

    queueEmployeeSave(profileId);
  }

  async function handleApplyTemplateToAll() {
    if (!selectedTemplate) {
      toast.error('Select a template first');
      return;
    }

    setApplyingTemplate(true);
    try {
      const result = await applyWorkShiftTemplate({
        templateId: selectedTemplate.id,
        mode: 'all',
      });
      toast.success(`Applied ${selectedTemplate.name} to ${result.affectedProfiles} employees`);
      await fetchMatrix();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to apply template');
    } finally {
      setApplyingTemplate(false);
    }
  }

  async function handleApplyTemplateToEmployee(profileId: string) {
    if (!selectedTemplate) {
      toast.error('Select a template first');
      return;
    }

    try {
      const result = await applyWorkShiftTemplate({
        templateId: selectedTemplate.id,
        mode: 'selected',
        profileIds: [profileId],
      });
      toast.success(
        `Applied ${selectedTemplate.name} and recalculated ${result.recalculatedAbsences} future/pending absences`
      );
      await fetchMatrix();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to apply template');
    }
  }

  function openCreateDialog(pattern?: WorkShiftPattern, name = '', description = '') {
    setDialogState({
      open: true,
      mode: 'create',
      templateId: null,
      name,
      description,
      pattern: cloneWorkShiftPattern(pattern || STANDARD_WORK_SHIFT_PATTERN),
    });
  }

  function openEditDialog(template: WorkShiftTemplate) {
    setDialogState({
      open: true,
      mode: 'edit',
      templateId: template.id,
      name: template.name,
      description: template.description || '',
      pattern: cloneWorkShiftPattern(template.pattern),
    });
  }

  async function handleSaveTemplate() {
    if (!dialogState.name.trim()) {
      toast.error('Template name is required');
      return;
    }

    setSavingTemplate(true);
    try {
      if (dialogState.mode === 'create') {
        await createWorkShiftTemplate({
          name: dialogState.name,
          description: dialogState.description,
          pattern: dialogState.pattern,
        });
        toast.success('Template created');
      } else if (dialogState.templateId) {
        await updateWorkShiftTemplate(dialogState.templateId, {
          name: dialogState.name,
          description: dialogState.description,
          pattern: dialogState.pattern,
        });
        toast.success('Template updated');
      }

      setDialogState(createTemplateDialogState());
      await fetchMatrix();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save template');
    } finally {
      setSavingTemplate(false);
    }
  }

  async function handleDeleteTemplate() {
    if (!selectedTemplate) {
      toast.error('Select a template first');
      return;
    }

    if (!window.confirm(`Delete the "${selectedTemplate.name}" template?`)) {
      return;
    }

    try {
      await deleteWorkShiftTemplate(selectedTemplate.id);
      toast.success('Template deleted');
      await fetchMatrix();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete template');
    }
  }

  if (loading) {
    return <PageLoader message="Loading work shifts..." />;
  }

  return (
    <div className="space-y-6">
      <Card className="border-border">
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle className="text-white">Work Shift Templates</CardTitle>
              <CardDescription className="text-muted-foreground">
                Manage reusable weekly shift patterns and apply them before making employee-specific overrides.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              {canManageTemplates ? (
                <>
                  <Button variant="outline" onClick={() => openCreateDialog()} className="border-slate-600">
                    <Plus className="mr-2 h-4 w-4" />
                    New Template
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => selectedTemplate && openEditDialog(selectedTemplate)}
                    disabled={!selectedTemplate}
                    className="border-slate-600"
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      selectedTemplate &&
                      openCreateDialog(
                        selectedTemplate.pattern,
                        `${selectedTemplate.name} Copy`,
                        selectedTemplate.description || ''
                      )
                    }
                    disabled={!selectedTemplate}
                    className="border-slate-600"
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    Duplicate
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleDeleteTemplate}
                    disabled={!selectedTemplate || selectedTemplate.is_default}
                    className="border-red-500/40 text-red-300 hover:bg-red-500/10"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {templates.map((template) => {
              const selected = template.id === selectedTemplateId;
              return (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => setSelectedTemplateId(template.id)}
                  className={`rounded-lg border p-4 text-left transition-all ${
                    selected
                      ? 'border-[hsl(var(--absence-primary))] bg-[hsl(var(--absence-primary)/0.12)]'
                      : 'border-slate-700 bg-slate-900/40 hover:border-slate-500'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">{template.name}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {template.description || 'No description'}
                      </div>
                    </div>
                    {template.is_default && (
                      <span className="rounded border border-absence/30 px-2 py-0.5 text-[10px] uppercase tracking-wide text-absence">
                        Default
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-3 rounded-lg border border-slate-700 bg-slate-950/40 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-sm font-medium text-white">
                {selectedTemplate ? `Selected template: ${selectedTemplate.name}` : 'Select a template'}
              </div>
              <div className="text-sm text-muted-foreground">
                Applying a template also recalculates pending and future absence durations for affected employees.
              </div>
            </div>
            <Button
              onClick={handleApplyTemplateToAll}
              disabled={!selectedTemplate || applyingTemplate || isReadOnly}
              className="bg-absence hover:bg-absence-dark text-white"
            >
              {applyingTemplate ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Users className="mr-2 h-4 w-4" />
              )}
              {scopeTeamOnly ? 'Apply To Team' : 'Apply To All Employees'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="text-white">Employee Work Shift Matrix</CardTitle>
              <CardDescription className="text-muted-foreground">
                Toggle AM and PM working sessions for each employee. Manual edits clear the template label for that row.
              </CardDescription>
            </div>
            <div className="flex w-full max-w-sm items-center gap-2">
              <Select value={effectiveTeamFilter} onValueChange={setSelectedTeamId} disabled={isTeamFilterLocked}>
                <SelectTrigger className="w-[190px] border-slate-600">
                  <SelectValue placeholder="Filter by team" />
                </SelectTrigger>
                <SelectContent className="bg-slate-950 border-border text-foreground">
                  {isTeamFilterLocked ? (
                    <SelectItem value={effectiveTeamFilter}>{actorTeamName}</SelectItem>
                  ) : (
                    <>
                      <SelectItem value="all">All teams</SelectItem>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      {teamOptions.map((team) => (
                        <SelectItem key={team.id} value={team.id}>
                          {team.name}
                        </SelectItem>
                      ))}
                    </>
                  )}
                </SelectContent>
              </Select>
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search employees..."
                className="bg-slate-900/50 border-slate-600 text-white"
              />
              <Button variant="outline" onClick={() => fetchMatrix()} className="border-slate-600">
                <RefreshCcw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredEmployees.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              {scopeTeamOnly && !actorTeamId
                ? 'No team is assigned to your profile, so no work shift records are available.'
                : 'No employees match the current search.'}
            </div>
          ) : (
            <div className="overflow-auto rounded-lg border border-slate-700">
              <table className="w-full min-w-[980px] table-fixed text-sm">
                <colgroup>
                  <col style={{ width: 'max(320px, calc(100% - 728px))' }} />
                  {WORK_SHIFT_DAY_ORDER.flatMap((day) => [
                    <col key={`${day}-am`} style={{ width: 52 }} />,
                    <col key={`${day}-pm`} style={{ width: 52 }} />,
                  ])}
                </colgroup>
                <thead>
                  <tr className="bg-slate-800/60">
                    <th
                      rowSpan={2}
                      className="sticky left-0 z-10 border-b border-slate-700 bg-slate-800 px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
                    >
                      Employee
                    </th>
                    {WORK_SHIFT_DAY_ORDER.map((day) => (
                      <th
                        key={day}
                        colSpan={2}
                        className="border-l border-slate-700/50 px-1 py-1 text-center text-[10px] font-semibold uppercase tracking-widest text-slate-400"
                      >
                        {WORK_SHIFT_DAY_LABELS[day]}
                      </th>
                    ))}
                  </tr>
                  <tr className="border-b border-slate-700">
                    {WORK_SHIFT_DAY_ORDER.flatMap((day) => [
                      <th
                        key={`${day}-am-header`}
                        className="border-l border-slate-600/70 px-2 py-2 text-[10px] uppercase text-slate-500"
                      >
                        AM
                      </th>,
                      <th key={`${day}-pm-header`} className="px-2 py-2 text-[10px] uppercase text-slate-500">
                        PM
                      </th>,
                    ])}
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.map((employee) => (
                    <tr key={employee.profile_id} className="border-b border-slate-700/50 hover:bg-slate-800/30">
                      <td className="sticky left-0 z-10 bg-slate-900/95 px-4 py-1.5 align-middle">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 text-sm font-medium text-white">
                            <span className="truncate">
                              {employee.full_name}
                              {employee.employee_id ? ` (${employee.employee_id})` : ''}
                            </span>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleApplyTemplateToEmployee(employee.profile_id)}
                            disabled={!selectedTemplate || isReadOnly}
                            className="h-7 shrink-0 border-slate-600 px-2 text-xs"
                          >
                            Apply
                            <ArrowRight className="ml-1 h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                      {WORK_SHIFT_DAY_ORDER.flatMap((day) =>
                        (['am', 'pm'] as const).map((session) => {
                          const cellKey = `${day}_${session}` as keyof WorkShiftPattern;
                          const enabled = employee.pattern[cellKey];
                          const isSaving = savingCells.has(`${employee.profile_id}:${day}:${session}`);

                          return (
                            <td
                              key={`${employee.profile_id}-${cellKey}`}
                              className={`px-1 py-1 text-center ${
                                isFirstSessionOfDay(day, session) ? 'border-l border-slate-600/70' : ''
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => toggleEmployeeCell(employee.profile_id, cellKey)}
                                disabled={isSaving || isReadOnly}
                                className="mx-auto flex h-7 w-7 items-center justify-center rounded border border-slate-700 transition-all disabled:cursor-not-allowed"
                                style={
                                  enabled
                                    ? {
                                        backgroundColor: 'hsl(var(--absence-primary))',
                                        boxShadow: '0 0 8px hsl(var(--absence-primary) / 0.25)',
                                      }
                                    : undefined
                                }
                              >
                                {isSaving ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-300" />
                                ) : enabled ? (
                                  <Check className="h-3.5 w-3.5 text-white" />
                                ) : (
                                  <Minus className="h-3 w-3 text-slate-500" />
                                )}
                              </button>
                            </td>
                          );
                        })
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={dialogState.open}
        onOpenChange={(open) => {
          setDialogState((current) => ({
            ...current,
            open,
          }));
          if (!open) {
            setDialogState(createTemplateDialogState());
          }
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-3xl overflow-y-auto border-border">
          <DialogHeader>
            <DialogTitle className="text-white">
              {dialogState.mode === 'create' ? 'Create Work Shift Template' : 'Edit Work Shift Template'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Define the weekly AM/PM working pattern for this reusable shift template.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="work-shift-template-name">Template name</Label>
                <Input
                  id="work-shift-template-name"
                  value={dialogState.name}
                  onChange={(event) =>
                    setDialogState((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  className="bg-slate-950 border-slate-700 text-white"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="work-shift-template-description">Description</Label>
                <Input
                  id="work-shift-template-description"
                  value={dialogState.description}
                  onChange={(event) =>
                    setDialogState((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  className="bg-slate-950 border-slate-700 text-white"
                />
              </div>
            </div>

            <TemplatePatternEditor
              pattern={dialogState.pattern}
              onChange={(pattern) =>
                setDialogState((current) => ({
                  ...current,
                  pattern,
                }))
              }
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogState(createTemplateDialogState())} className="border-slate-600">
              Cancel
            </Button>
            <Button
              onClick={handleSaveTemplate}
              disabled={savingTemplate}
              className="bg-absence hover:bg-absence-dark text-white"
            >
              {savingTemplate ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {dialogState.mode === 'create' ? 'Create Template' : 'Save Template'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
