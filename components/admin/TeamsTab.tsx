'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, Plus, Edit, Trash2, Search, FileText } from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchAdminTeamDirectory,
  invalidateAdminTeamDirectoryCache,
} from '@/lib/admin/team-directory-client';
import { useAuth } from '@/lib/hooks/useAuth';
import {
  TimesheetTypeOptions,
  getTimesheetTypeLabel,
} from '@/app/(dashboard)/timesheets/types/registry';

type TeamRow = {
  id: string;
  team_id?: string;
  name: string;
  code?: string | null;
  timesheet_type?: string | null;
  active: boolean;
  member_count: number;
  manager_count: number;
  without_manager_count: number;
  manager_1_id?: string | null;
  manager_2_id?: string | null;
  manager_1_name?: string | null;
  manager_2_name?: string | null;
};

type ManagerOption = {
  id: string;
  full_name: string;
  employee_id?: string | null;
  is_placeholder: boolean;
  role_class: 'admin' | 'manager' | 'employee';
  label: string;
};

export function TeamsTab() {
  const { isAdmin, isSuperAdmin, isActualSuperAdmin } = useAuth();
  const canMutateTeams = isAdmin || isSuperAdmin || isActualSuperAdmin;

  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [managerOptions, setManagerOptions] = useState<ManagerOption[]>([]);

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<TeamRow | null>(null);

  const [formData, setFormData] = useState({
    id: '',
    name: '',
    code: '',
    timesheet_type: 'civils',
    manager_1_id: '',
    manager_2_id: '',
  });
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');

  const fetchTeams = useCallback(async (force = false) => {
    try {
      setLoading(true);
      const data = await fetchAdminTeamDirectory({ force });
      const rows = Array.isArray(data?.teams) ? data.teams : [];
      const mapped: TeamRow[] = rows.map((row: TeamRow & { team_id?: string }) => ({
        ...row,
        id: row.id || row.team_id || '',
      }));
      setTeams(mapped);
      setManagerOptions(Array.isArray(data?.manager_options) ? data.manager_options : []);
    } catch (error) {
      console.error('Error loading teams:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to load teams');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  const filteredTeams = useMemo(() => {
    if (!search.trim()) return teams;
    const query = search.toLowerCase();
    return teams.filter(
      (team) =>
        team.name.toLowerCase().includes(query) ||
        team.id.toLowerCase().includes(query) ||
        (team.code || '').toLowerCase().includes(query)
    );
  }, [search, teams]);

  const stats = useMemo(
    () => ({
      total: teams.length,
      members: teams.reduce((sum, team) => sum + team.member_count, 0),
    }),
    [teams]
  );

  function resetForm() {
    setFormData({ id: '', name: '', code: '', timesheet_type: 'civils', manager_1_id: '', manager_2_id: '' });
    setFormError('');
  }

  function openEdit(team: TeamRow) {
    setSelectedTeam(team);
    setFormData({
      id: team.id,
      name: team.name,
      code: team.code || '',
      timesheet_type: team.timesheet_type || 'civils',
      manager_1_id: team.manager_1_id || '',
      manager_2_id: team.manager_2_id || '',
    });
    setFormError('');
    setEditDialogOpen(true);
  }

  async function handleCreateTeam() {
    if (!formData.name.trim()) {
      setFormError('Team name is required');
      return;
    }
    try {
      setFormLoading(true);
      setFormError('');
      const response = await fetch('/api/admin/hierarchy/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: formData.id || undefined,
          name: formData.name,
          code: formData.code || undefined,
          timesheet_type: formData.timesheet_type,
          manager_1_id: formData.manager_1_id || null,
          manager_2_id: formData.manager_2_id || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create team');
      }
      toast.success('Team created');
      invalidateAdminTeamDirectoryCache();
      await fetchTeams(true);
      setAddDialogOpen(false);
      resetForm();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Failed to create team');
    } finally {
      setFormLoading(false);
    }
  }

  async function handleEditTeam() {
    if (!selectedTeam) return;
    if (!formData.name.trim()) {
      setFormError('Team name is required');
      return;
    }
    try {
      setFormLoading(true);
      setFormError('');
      const response = await fetch(`/api/admin/hierarchy/teams/${selectedTeam.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          code: formData.code || null,
          timesheet_type: formData.timesheet_type,
          manager_1_id: formData.manager_1_id || null,
          manager_2_id: formData.manager_2_id || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update team');
      }
      toast.success('Team updated');
      invalidateAdminTeamDirectoryCache();
      await fetchTeams(true);
      setEditDialogOpen(false);
      setSelectedTeam(null);
      resetForm();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Failed to update team');
    } finally {
      setFormLoading(false);
    }
  }

  async function handleDeleteTeam(team: TeamRow) {
    if (!confirm(`Delete "${team.name}"? This is blocked if users are still assigned.`)) return;
    try {
      const response = await fetch(`/api/admin/hierarchy/teams/${team.id}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete team');
      }
      toast.success('Team deleted');
      invalidateAdminTeamDirectoryCache();
      await fetchTeams(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete team');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border-border">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Teams</p>
            <p className="text-2xl font-bold text-white">{stats.total}</p>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Assigned Users</p>
            <p className="text-2xl font-bold text-white">{stats.members}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-white">Teams</CardTitle>
              <CardDescription className="text-muted-foreground">
                Manage team definitions independently from job roles.
              </CardDescription>
            </div>
            <Button
              onClick={() => {
                resetForm();
                setAddDialogOpen(true);
              }}
              disabled={!canMutateTeams}
              className="bg-brand-yellow hover:bg-brand-yellow-hover text-slate-900"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Team
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search teams..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-11 bg-slate-900/50 border-slate-600 text-white"
            />
          </div>

          {filteredTeams.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">No teams found.</div>
          ) : (
            <div className="border border-slate-700 rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-700 hover:bg-slate-800/50">
                    <TableHead className="text-muted-foreground">Team</TableHead>
                    <TableHead className="text-muted-foreground">Code</TableHead>
                    <TableHead className="text-muted-foreground">Timesheet</TableHead>
                    <TableHead className="text-muted-foreground">Manager 1</TableHead>
                    <TableHead className="text-muted-foreground">Manager 2</TableHead>
                    <TableHead className="text-muted-foreground text-center">Users</TableHead>
                    <TableHead className="text-right text-muted-foreground">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTeams.map((team) => (
                    <TableRow key={team.id} className="border-slate-700 hover:bg-slate-800/50">
                      <TableCell className="font-medium text-white">
                        <div>{team.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{team.id}</div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{team.code || '—'}</TableCell>
                      <TableCell className="text-slate-300">
                        <div className="flex items-center gap-1.5">
                          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                          {getTimesheetTypeLabel(team.timesheet_type || 'civils')}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className={team.manager_1_name ? 'text-white' : 'text-slate-500'}>
                          {team.manager_1_name || 'No Manager 1'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={team.manager_2_name ? 'text-white' : 'text-slate-500'}>
                          {team.manager_2_name || 'No Manager 2'}
                        </span>
                      </TableCell>
                      <TableCell className="text-center text-white">{team.member_count}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!canMutateTeams}
                            onClick={() => openEdit(team)}
                            className="text-blue-400 hover:text-blue-300 hover:bg-slate-800 disabled:opacity-40"
                          >
                            <Edit className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!canMutateTeams}
                            onClick={() => handleDeleteTeam(team)}
                            className="text-red-400 hover:text-red-300 hover:bg-slate-800 disabled:opacity-40"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="border-border text-white">
          <DialogHeader>
            <DialogTitle>Add Team</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Create a new team for user assignment and hierarchy scope.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {formError && (
              <div className="bg-red-500/10 border border-red-500/50 rounded p-3 text-sm text-red-400">
                {formError}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="team-add-name">Team Name *</Label>
              <Input
                id="team-add-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="bg-input border-border text-white"
                placeholder="Civils"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="team-add-id">Team ID (optional)</Label>
              <Input
                id="team-add-id"
                value={formData.id}
                onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                className="bg-input border-border text-white"
                placeholder="civils"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="team-add-code">Team Code (optional)</Label>
              <Input
                id="team-add-code"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                className="bg-input border-border text-white"
                placeholder="CVL"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="team-add-timesheet-type" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Timesheet Type
              </Label>
              <Select
                value={formData.timesheet_type}
                onValueChange={(value) => setFormData({ ...formData, timesheet_type: value })}
              >
                <SelectTrigger id="team-add-timesheet-type" className="bg-input border-border text-white">
                  <SelectValue placeholder="Select timesheet type" />
                </SelectTrigger>
                <SelectContent>
                  {TimesheetTypeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Controls which timesheet format users on this team are sent to.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="team-add-manager-1">Manager 1</Label>
              <Select
                value={formData.manager_1_id}
                onValueChange={(value) => setFormData({ ...formData, manager_1_id: value === 'none' ? '' : value })}
              >
                <SelectTrigger id="team-add-manager-1" className="bg-input border-border text-white">
                  <SelectValue placeholder="Select manager" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Manager 1</SelectItem>
                  {managerOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="team-add-manager-2">Manager 2</Label>
              <Select
                value={formData.manager_2_id}
                onValueChange={(value) => setFormData({ ...formData, manager_2_id: value === 'none' ? '' : value })}
              >
                <SelectTrigger id="team-add-manager-2" className="bg-input border-border text-white">
                  <SelectValue placeholder="Select manager" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Manager 2</SelectItem>
                  {managerOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAddDialogOpen(false);
                resetForm();
              }}
              className="border-slate-600 text-white hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateTeam}
              disabled={formLoading}
              className="bg-brand-yellow hover:bg-brand-yellow-hover text-slate-900"
            >
              {formLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Team'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="border-border text-white">
          <DialogHeader>
            <DialogTitle>Edit Team</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Update team display details.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {formError && (
              <div className="bg-red-500/10 border border-red-500/50 rounded p-3 text-sm text-red-400">
                {formError}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="team-edit-name">Team Name *</Label>
              <Input
                id="team-edit-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="bg-input border-border text-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="team-edit-code">Team Code</Label>
              <Input
                id="team-edit-code"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                className="bg-input border-border text-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="team-edit-timesheet-type" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Timesheet Type
              </Label>
              <Select
                value={formData.timesheet_type}
                onValueChange={(value) => setFormData({ ...formData, timesheet_type: value })}
              >
                <SelectTrigger id="team-edit-timesheet-type" className="bg-input border-border text-white">
                  <SelectValue placeholder="Select timesheet type" />
                </SelectTrigger>
                <SelectContent>
                  {TimesheetTypeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="team-edit-manager-1">Manager 1</Label>
              <Select
                value={formData.manager_1_id}
                onValueChange={(value) => setFormData({ ...formData, manager_1_id: value === 'none' ? '' : value })}
              >
                <SelectTrigger id="team-edit-manager-1" className="bg-input border-border text-white">
                  <SelectValue placeholder="Select manager" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Manager 1</SelectItem>
                  {managerOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="team-edit-manager-2">Manager 2</Label>
              <Select
                value={formData.manager_2_id}
                onValueChange={(value) => setFormData({ ...formData, manager_2_id: value === 'none' ? '' : value })}
              >
                <SelectTrigger id="team-edit-manager-2" className="bg-input border-border text-white">
                  <SelectValue placeholder="Select manager" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Manager 2</SelectItem>
                  {managerOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditDialogOpen(false);
                setSelectedTeam(null);
                resetForm();
              }}
              className="border-slate-600 text-white hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleEditTeam}
              disabled={formLoading}
              className="bg-brand-yellow hover:bg-brand-yellow-hover text-slate-900"
            >
              {formLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
