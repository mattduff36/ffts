'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Shield,
  Plus,
  Edit,
  Trash2,
  Loader2,
  AlertTriangle,
  Search,
  Briefcase,
} from 'lucide-react';
import type { RoleMatrixRow } from '@/types/roles';
import { toast } from 'sonner';
import { isClientSessionPausedError } from '@/lib/app-auth/session-error';
import { useAuth } from '@/lib/hooks/useAuth';
import { getRoleSortPriority, isCoreRoleName } from '@/lib/config/roles-core';
import { isAdminRole } from '@/lib/utils/role-access';

type RoleType = 'admin' | 'manager' | 'employee';

export function JobRolesTab() {
  const { isAdmin, isSuperAdmin, isActualSuperAdmin, profile } = useAuth();
  const isAdminActor = isAdmin || isSuperAdmin || isActualSuperAdmin;
  const isManagerActor = !isAdminActor && profile?.role?.is_manager_admin === true;
  const canEditOrDeleteRoles = isAdminActor;

  const [roles, setRoles] = useState<RoleMatrixRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedRole, setSelectedRole] = useState<RoleMatrixRow | null>(null);

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    display_name: '',
    description: '',
    role_type: 'employee' as RoleType,
    hierarchy_rank: '',
  });
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');

  const fetchRoles = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/roles');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to fetch roles');
      setRoles(data.matrix ?? []);
    } catch (error) {
      if (!isClientSessionPausedError(error)) {
        console.error('Error fetching roles:', error);
      }
      toast.error('Failed to load roles');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRoles();
  }, [fetchRoles]);

  const sortedRoles = useMemo(() => {
    return [...roles].sort((a, b) => {
      const rankA = a.hierarchy_rank ?? Number.MAX_SAFE_INTEGER;
      const rankB = b.hierarchy_rank ?? Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) return rankA - rankB;
      const byPriority = getRoleSortPriority(a.name) - getRoleSortPriority(b.name);
      if (byPriority !== 0) return byPriority;
      return a.display_name.localeCompare(b.display_name);
    });
  }, [roles]);

  const filtered = search.trim()
    ? sortedRoles.filter(r =>
        r.display_name.toLowerCase().includes(search.toLowerCase()) ||
        r.name.toLowerCase().includes(search.toLowerCase()) ||
        r.description?.toLowerCase().includes(search.toLowerCase())
      )
    : sortedRoles;

  const stats = {
    total: roles.length,
    core: roles.filter((role) => isCoreRoleName(role.name)).length,
    custom: roles.filter((role) => !isCoreRoleName(role.name)).length,
  };

  function resetForm() {
    setFormData({
      name: '',
      display_name: '',
      description: '',
      role_type: 'employee',
      hierarchy_rank: '',
    });
    setFormError('');
  }

  function openEditDialog(role: RoleMatrixRow) {
    setSelectedRole(role);
    setFormData({
      name: role.name,
      display_name: role.display_name,
      description: role.description || '',
      role_type: role.role_class || (isAdminRole(role) ? 'admin' : (role.is_manager_admin ? 'manager' : 'employee')),
      hierarchy_rank: role.hierarchy_rank != null ? String(role.hierarchy_rank) : '',
    });
    setFormError('');
    setEditDialogOpen(true);
  }

  function openDeleteDialog(role: RoleMatrixRow) {
    setSelectedRole(role);
    setFormError('');
    setDeleteDialogOpen(true);
  }

  async function handleAddRole() {
    if (!formData.name || !formData.display_name) {
      setFormError('Please fill in all required fields');
      return;
    }
    try {
      setFormLoading(true);
      setFormError('');
      const response = await fetch('/api/admin/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          role_class: formData.role_type,
          hierarchy_rank: formData.hierarchy_rank ? Number(formData.hierarchy_rank) : null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to create role');
      toast.success('Role created successfully');
      fetchRoles();
      setAddDialogOpen(false);
      resetForm();
    } catch (error) {
      console.error('Error creating role:', error);
      setFormError(error instanceof Error ? error.message : 'Failed to create role');
    } finally {
      setFormLoading(false);
    }
  }

  async function handleEditRole() {
    if (!selectedRole || !formData.name || !formData.display_name) {
      setFormError('Please fill in all required fields');
      return;
    }
    try {
      setFormLoading(true);
      setFormError('');
      const response = await fetch(`/api/admin/roles/${selectedRole.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          role_class: formData.role_type,
          hierarchy_rank: formData.hierarchy_rank ? Number(formData.hierarchy_rank) : null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to update role');
      toast.success('Role updated successfully');
      fetchRoles();
      setEditDialogOpen(false);
      setSelectedRole(null);
      resetForm();
    } catch (error) {
      console.error('Error updating role:', error);
      setFormError(error instanceof Error ? error.message : 'Failed to update role');
    } finally {
      setFormLoading(false);
    }
  }

  async function handleDeleteRole() {
    if (!selectedRole) return;
    try {
      setFormLoading(true);
      setFormError('');
      const response = await fetch(`/api/admin/roles/${selectedRole.id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to delete role');
      toast.success('Role deleted successfully');
      fetchRoles();
      setDeleteDialogOpen(false);
      setSelectedRole(null);
    } catch (error) {
      console.error('Error deleting role:', error);
      setFormError(error instanceof Error ? error.message : 'Failed to delete role');
    } finally {
      setFormLoading(false);
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
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Roles</p>
                <p className="text-2xl font-bold text-white">{stats.total}</p>
              </div>
              <Briefcase className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Core Roles</p>
                <p className="text-2xl font-bold text-white">{stats.core}</p>
              </div>
              <Shield className="h-8 w-8 text-amber-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Custom Roles</p>
                <p className="text-2xl font-bold text-white">{stats.custom}</p>
              </div>
              <Shield className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Roles Table */}
      <Card className="border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-white">Job Roles</CardTitle>
              <CardDescription className="text-muted-foreground">
                Create and manage job roles. Assign permissions on the Permissions tab.
              </CardDescription>
            </div>
            <Button
              onClick={() => { resetForm(); setAddDialogOpen(true); }}
              className="bg-brand-yellow hover:bg-brand-yellow-hover text-slate-900"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Role
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search roles..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-11 bg-slate-900/50 border-slate-600 text-white placeholder:text-muted-foreground"
              />
            </div>

            {filtered.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {search ? 'No roles match your search.' : 'No roles configured yet.'}
              </div>
            ) : (
              <div className="border border-slate-700 rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700 hover:bg-slate-800/50">
                      <TableHead className="text-muted-foreground">Role</TableHead>
                      <TableHead className="text-muted-foreground">Description</TableHead>
                      <TableHead className="text-muted-foreground text-center">Tier</TableHead>
                      <TableHead className="text-muted-foreground text-center">Type</TableHead>
                      <TableHead className="text-muted-foreground text-center">Users</TableHead>
                      <TableHead className="text-right text-muted-foreground">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map(role => (
                      <TableRow key={role.id} className="border-slate-700 hover:bg-slate-800/50">
                        <TableCell className="font-medium text-white">
                          <div className="flex items-center gap-2">
                            <span>{role.display_name}</span>
                          </div>
                          <div className="text-xs text-muted-foreground font-mono mt-0.5">{role.name}</div>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm max-w-[250px] truncate">
                          {role.description || '—'}
                        </TableCell>
                        <TableCell className="text-center text-slate-300">
                          {isAdminRole(role) ? 'Bypass' : role.hierarchy_rank ?? '—'}
                        </TableCell>
                        <TableCell className="text-center">
                          {isCoreRoleName(role.name) ? (
                            <Badge variant="default">Primary</Badge>
                          ) : role.is_super_admin ? (
                            <Badge variant="destructive">Super Admin</Badge>
                          ) : isAdminRole(role) ? (
                            <Badge variant="destructive">Admin</Badge>
                          ) : role.name === 'supervisor' ? (
                            <Badge variant="outline" className="text-cyan-300 border-cyan-500/50 bg-cyan-500/10">Supervisor</Badge>
                          ) : role.name === 'contractor' ? (
                            <Badge variant="outline" className="text-orange-300 border-orange-500/50 bg-orange-500/10">Contractor</Badge>
                          ) : role.is_manager_admin ? (
                            <Badge variant="warning">Manager</Badge>
                          ) : (
                            <Badge variant="outline" className="text-green-400 border-green-500/50 bg-green-500/10">Employee</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="text-white font-medium">{role.user_count}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEditDialog(role)}
                              disabled={!canEditOrDeleteRoles || role.is_super_admin}
                              className="text-blue-400 hover:text-blue-300 hover:bg-slate-800 disabled:opacity-30"
                              title={
                                !canEditOrDeleteRoles
                                  ? 'Only admins can edit roles'
                                  : role.is_super_admin
                                  ? 'Cannot edit super admin'
                                  : 'Edit Role'
                              }
                            >
                              <Edit className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openDeleteDialog(role)}
                              disabled={!canEditOrDeleteRoles || role.is_super_admin || role.is_manager_admin || role.user_count > 0}
                              className="text-red-400 hover:text-red-300 hover:bg-slate-800 disabled:opacity-30"
                              title={
                                !canEditOrDeleteRoles
                                  ? 'Only admins can delete roles'
                                  : role.is_super_admin || role.is_manager_admin
                                  ? 'Cannot delete admin or manager roles'
                                  : role.user_count > 0
                                  ? 'Cannot delete role with assigned users'
                                  : 'Delete Role'
                              }
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
          </div>
        </CardContent>
      </Card>

      {/* Add Role Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="border-border text-white max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Role</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Create a new job role. You can assign module permissions on the Permissions tab.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {formError && (
              <div className="bg-red-500/10 border border-red-500/50 rounded p-3 text-sm text-red-400">
                {formError}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="jr-add-name">Role Name (Internal) *</Label>
              <Input
                id="jr-add-name"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                placeholder="project-coordinator"
                className="bg-input border-border text-white placeholder:text-muted-foreground"
              />
              <p className="text-xs text-muted-foreground">Lowercase, hyphenated (e.g., project-coordinator)</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="jr-add-display">Display Name *</Label>
              <Input
                id="jr-add-display"
                value={formData.display_name}
                onChange={e => setFormData({ ...formData, display_name: e.target.value })}
                placeholder="Project Coordinator"
                className="bg-input border-border text-white placeholder:text-muted-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="jr-add-desc">Description</Label>
              <Textarea
                id="jr-add-desc"
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                placeholder="Brief description of this role..."
                className="bg-input border-border text-white placeholder:text-muted-foreground min-h-[80px]"
              />
            </div>
            <div className="space-y-2 p-3 bg-slate-800 rounded">
              <Label htmlFor="jr-add-role-type">Role Type</Label>
              <Select
                value={formData.role_type}
                onValueChange={(value: RoleType) => {
                  setFormData({
                    ...formData,
                    role_type: value,
                  });
                }}
              >
                <SelectTrigger id="jr-add-role-type" className="bg-input border-border text-white">
                  <SelectValue placeholder="Select role type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="employee">Employee</SelectItem>
                  <SelectItem value="manager" disabled={isManagerActor}>Manager</SelectItem>
                  <SelectItem value="admin" disabled={isManagerActor}>Admin</SelectItem>
                </SelectContent>
              </Select>
              <div>
                <p className="text-xs text-muted-foreground">
                  {isManagerActor
                    ? 'Managers can create Employee roles only.'
                    : 'Admins can create Admin, Manager, or Employee roles.'}
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="jr-add-rank">Permission Tier Rank</Label>
              <Input
                id="jr-add-rank"
                type="number"
                min="1"
                value={formData.hierarchy_rank}
                onChange={e => setFormData({ ...formData, hierarchy_rank: e.target.value })}
                className="bg-input border-border text-white"
                placeholder="1"
              />
              <p className="text-xs text-muted-foreground">
                Lower numbers are lower tiers. Ranked non-admin roles appear as permission matrix headers.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddDialogOpen(false); resetForm(); }} className="border-slate-600 text-white hover:bg-slate-800">
              Cancel
            </Button>
            <Button onClick={handleAddRole} disabled={formLoading} className="bg-brand-yellow hover:bg-brand-yellow-hover text-slate-900">
              {formLoading ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating...</>
              ) : (
                <><Plus className="h-4 w-4 mr-2" />Create Role</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Role Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="border-border text-white max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Role</DialogTitle>
            <DialogDescription className="text-muted-foreground">Update role details</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {formError && (
              <div className="bg-red-500/10 border border-red-500/50 rounded p-3 text-sm text-red-400">{formError}</div>
            )}
            <div className="space-y-2">
              <Label htmlFor="jr-edit-name">Role Name (Internal) *</Label>
              <Input
                id="jr-edit-name"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                className="bg-input border-border text-white placeholder:text-muted-foreground"
              />
              <p className="text-xs text-muted-foreground">Lowercase, hyphenated (e.g., project-coordinator)</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="jr-edit-display">Display Name *</Label>
              <Input
                id="jr-edit-display"
                value={formData.display_name}
                onChange={e => setFormData({ ...formData, display_name: e.target.value })}
                className="bg-input border-border text-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="jr-edit-desc">Description</Label>
              <Textarea
                id="jr-edit-desc"
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                className="bg-input border-border text-white placeholder:text-muted-foreground min-h-[80px]"
              />
            </div>
            <div className="space-y-2 p-3 bg-slate-800 rounded">
              <Label htmlFor="jr-edit-role-type">Role Type</Label>
              <Select
                value={formData.role_type}
                onValueChange={(value: RoleType) => {
                  setFormData({
                    ...formData,
                    role_type: value,
                  });
                }}
              >
                <SelectTrigger id="jr-edit-role-type" className="bg-input border-border text-white">
                  <SelectValue placeholder="Select role type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="employee">Employee</SelectItem>
                  <SelectItem value="manager" disabled={isManagerActor}>Manager</SelectItem>
                  <SelectItem value="admin" disabled={isManagerActor}>Admin</SelectItem>
                </SelectContent>
              </Select>
              <div>
                <p className="text-xs text-muted-foreground">
                  {isManagerActor
                    ? 'Managers can set Employee role type only.'
                    : 'Admins can set Admin, Manager, or Employee role type.'}
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="jr-edit-rank">Permission Tier Rank</Label>
              <Input
                id="jr-edit-rank"
                type="number"
                min="1"
                value={formData.hierarchy_rank}
                onChange={e => setFormData({ ...formData, hierarchy_rank: e.target.value })}
                className="bg-input border-border text-white"
              />
              <p className="text-xs text-muted-foreground">
                Lower numbers are lower tiers. Ranked non-admin roles appear as permission matrix headers.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditDialogOpen(false); setSelectedRole(null); resetForm(); }} className="border-slate-600 text-white hover:bg-slate-800">
              Cancel
            </Button>
            <Button onClick={handleEditRole} disabled={formLoading} className="bg-brand-yellow hover:bg-brand-yellow-hover text-slate-900">
              {formLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</> : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Role Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="border-border text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Delete Role
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Are you sure you want to delete this role? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {selectedRole && (
            <div className="bg-slate-800 rounded p-4 space-y-2">
              <p className="text-sm">
                <span className="text-muted-foreground">Role:</span>{' '}
                <span className="text-white font-medium">{selectedRole.display_name}</span>
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">Users assigned:</span>{' '}
                <span className="text-white">{selectedRole.user_count}</span>
              </p>
            </div>
          )}
          {formError && (
            <div className="bg-red-500/10 border border-red-500/50 rounded p-3 text-sm text-red-400">{formError}</div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteDialogOpen(false); setSelectedRole(null); }} className="border-slate-600 text-white hover:bg-slate-800">
              Cancel
            </Button>
            <Button onClick={handleDeleteRole} disabled={formLoading} className="bg-red-600 hover:bg-red-700">
              {formLoading ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Deleting...</>
              ) : (
                <><Trash2 className="h-4 w-4 mr-2" />Delete Role</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
