'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageLoader } from '@/components/ui/page-loader';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  dialogContentViewportClassName,
} from '@/components/ui/dialog';
import { ArrowUpDown, Plus, Search, Settings, Settings2, Trash2 } from 'lucide-react';
import {
  useAllAbsenceReasons,
  useCreateAbsenceReason,
  useUpdateAbsenceReason,
  useDeleteAbsenceReason,
} from '@/lib/hooks/useAbsence';
import { AbsenceReason } from '@/types/absence';
import { toast } from 'sonner';

type SortField = 'name' | 'is_paid' | 'updated_at';
type SortDirection = 'asc' | 'desc';
type TabState = 'active' | 'inactive';

type ColumnVisibility = {
  paid: boolean;
  color: boolean;
  status: boolean;
  updated: boolean;
};

const COLUMN_VISIBILITY_STORAGE_KEY = 'absence-reasons-column-visibility';
const DEFAULT_COLUMN_VISIBILITY: ColumnVisibility = {
  paid: true,
  color: true,
  status: true,
  updated: true,
};
const DEFAULT_REASON_COLORS = [
  '#ffffff', // white
  '#ffea00', // yellow
  '#ff6a00', // orange
  '#ff1744', // red
  '#ff00ff', // magenta
  '#7c4dff', // violet
  '#2979ff', // blue
  '#00e5ff', // cyan
  '#00e676', // green
  '#795548', // brown
];

export function AbsenceReasonsContent() {
  const { data: reasons, isLoading } = useAllAbsenceReasons();

  const createReason = useCreateAbsenceReason();
  const updateReason = useUpdateAbsenceReason();
  const deleteReason = useDeleteAbsenceReason();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDisableDialog, setShowDisableDialog] = useState(false);
  const [disableTargetReason, setDisableTargetReason] = useState<AbsenceReason | null>(null);
  const [editingReason, setEditingReason] = useState<AbsenceReason | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [tab, setTab] = useState<TabState>('active');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibility>(DEFAULT_COLUMN_VISIBILITY);
  const [name, setName] = useState('');
  const [isPaid, setIsPaid] = useState(true);
  const [color, setColor] = useState('#6366f1');
  const [submitting, setSubmitting] = useState(false);
  const [disableSubmitting, setDisableSubmitting] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(COLUMN_VISIBILITY_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<ColumnVisibility>;
        setColumnVisibility((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      // Ignore localStorage parse failures
    }
  }, []);

  function toggleColumn(column: keyof ColumnVisibility) {
    setColumnVisibility((prev) => {
      const next = { ...prev, [column]: !prev[column] };
      localStorage.setItem(COLUMN_VISIBILITY_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  const filteredReasons = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    const base = (reasons || []).filter((reason) => (tab === 'active' ? reason.is_active : !reason.is_active));
    return base.filter((reason) => {
      if (!term) return true;
      return reason.name.toLowerCase().includes(term);
    });
  }, [reasons, searchQuery, tab]);

  const sortedReasons = useMemo(() => {
    const list = [...filteredReasons];
    list.sort((a, b) => {
      const direction = sortDirection === 'asc' ? 1 : -1;
      if (sortField === 'name') {
        return direction * a.name.localeCompare(b.name);
      }
      if (sortField === 'is_paid') {
        return direction * Number(a.is_paid) - direction * Number(b.is_paid);
      }
      const aUpdatedAt = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const bUpdatedAt = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      return direction * aUpdatedAt - direction * bUpdatedAt;
    });
    return list;
  }, [filteredReasons, sortDirection, sortField]);

  const activeCount = (reasons || []).filter((reason) => reason.is_active).length;
  const inactiveCount = (reasons || []).filter((reason) => !reason.is_active).length;

  function handleSort(field: SortField) {
    if (field === sortField) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortField(field);
    setSortDirection('asc');
  }

  async function handleCreate() {
    if (!name.trim()) {
      toast.error('Please enter a reason name');
      return;
    }

    setSubmitting(true);

    try {
      await createReason.mutateAsync({
        name: name.trim(),
        is_paid: isPaid,
        color,
      });

      toast.success('Absence reason created');
      setName('');
      setIsPaid(true);
      setColor('#6366f1');
      setShowCreateDialog(false);
    } catch (error: unknown) {
      console.error('Error creating reason:', error);
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        toast.error('A reason with this name already exists');
      } else {
        toast.error('Failed to create reason');
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleEditClick(reason: AbsenceReason) {
    setEditingReason(reason);
    setName(reason.name);
    setIsPaid(reason.is_paid);
    setColor(reason.color || '#6366f1');
    setShowEditDialog(true);
  }

  async function handleUpdate() {
    if (!editingReason || !name.trim()) {
      toast.error('Please enter a reason name');
      return;
    }

    setSubmitting(true);

    try {
      await updateReason.mutateAsync({
        id: editingReason.id,
        updates: {
          name: name.trim(),
          is_paid: isPaid,
          color,
        },
      });

      toast.success('Absence reason updated');
      setEditingReason(null);
      setName('');
      setIsPaid(true);
      setColor('#6366f1');
      setShowEditDialog(false);
    } catch (error: unknown) {
      console.error('Error updating reason:', error);
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        toast.error('A reason with this name already exists');
      } else {
        toast.error('Failed to update reason');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleActive(reason: AbsenceReason) {
    try {
      await updateReason.mutateAsync({
        id: reason.id,
        updates: { is_active: !reason.is_active },
      });

      toast.success(`Reason ${reason.is_active ? 'disabled' : 'enabled'}`);
    } catch (error) {
      console.error('Error toggling active:', error);
      toast.error('Failed to update reason');
    }
  }

  function handleDelete(reason: AbsenceReason) {
    setDisableTargetReason(reason);
    setShowDisableDialog(true);
  }

  async function confirmDisableReason() {
    if (!disableTargetReason) return;
    setDisableSubmitting(true);
    try {
      await deleteReason.mutateAsync(disableTargetReason.id);
      toast.success('Reason disabled');
      setShowDisableDialog(false);
      setDisableTargetReason(null);
    } catch (error) {
      console.error('Error deleting reason:', error);
      toast.error('Failed to delete reason');
    } finally {
      setDisableSubmitting(false);
    }
  }

  if (isLoading) {
    return <PageLoader message="Loading absence reasons..." />;
  }

  return (
    <div className="space-y-6">
      <Card className="border-border">
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="text-foreground">Absence Reasons</CardTitle>
            <CardDescription className="text-muted-foreground">Manage absence and leave reasons</CardDescription>
          </div>
          <Button
            onClick={() => {
              setName('');
              setIsPaid(true);
              setColor('#6366f1');
              setShowCreateDialog(true);
            }}
            className="bg-absence hover:bg-absence-dark text-white"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Reason
          </Button>
        </CardHeader>
      </Card>

      <Tabs value={tab} onValueChange={(value) => setTab(value as TabState)} className="space-y-4">
        <TabsList className="bg-slate-800 border-border">
          <TabsTrigger value="active">Active ({activeCount})</TabsTrigger>
          <TabsTrigger value="inactive">Inactive ({inactiveCount})</TabsTrigger>
        </TabsList>

        <Card className="border-border">
          <CardContent className="pt-6">
            <div className="flex flex-col gap-3 md:flex-row">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search reasons..."
                  className="pl-11 bg-slate-900/50 border-slate-600 text-white"
                />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="border-slate-600">
                    <Settings2 className="h-4 w-4 mr-2" />
                    Columns
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52 bg-slate-900 border border-border">
                  <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem checked={columnVisibility.paid} onCheckedChange={() => toggleColumn('paid')}>
                    Paid
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={columnVisibility.color} onCheckedChange={() => toggleColumn('color')}>
                    Color
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={columnVisibility.status} onCheckedChange={() => toggleColumn('status')}>
                    Status
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={columnVisibility.updated} onCheckedChange={() => toggleColumn('updated')}>
                    Updated
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </CardContent>
        </Card>

        <TabsContent value={tab} className="space-y-4 mt-0">
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-foreground">
                <Settings className="h-5 w-5" />
                Reasons
              </CardTitle>
              <CardDescription className="text-muted-foreground">{sortedReasons.length} reasons shown</CardDescription>
            </CardHeader>
            <CardContent>
              {sortedReasons.length === 0 ? (
                <div className="text-center py-10">
                  <Settings className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">No reasons match your current view.</p>
                </div>
              ) : (
                <>
                  <div className="hidden md:block border border-slate-700 rounded-lg overflow-hidden">
                    <Table className="min-w-full">
                      <TableHeader>
                        <TableRow className="border-border">
                          <TableHead className="bg-slate-900 text-muted-foreground cursor-pointer" onClick={() => handleSort('name')}>
                            <div className="flex items-center gap-2">
                              Name
                              <ArrowUpDown className="h-3 w-3" />
                            </div>
                          </TableHead>
                          {columnVisibility.paid && (
                            <TableHead className="bg-slate-900 text-muted-foreground cursor-pointer" onClick={() => handleSort('is_paid')}>
                              <div className="flex items-center gap-2">
                                Paid
                                <ArrowUpDown className="h-3 w-3" />
                              </div>
                            </TableHead>
                          )}
                          {columnVisibility.color && <TableHead className="bg-slate-900 text-muted-foreground">Color</TableHead>}
                          {columnVisibility.status && <TableHead className="bg-slate-900 text-muted-foreground">Status</TableHead>}
                          {columnVisibility.updated && (
                            <TableHead className="bg-slate-900 text-muted-foreground cursor-pointer" onClick={() => handleSort('updated_at')}>
                              <div className="flex items-center gap-2">
                                Updated
                                <ArrowUpDown className="h-3 w-3" />
                              </div>
                            </TableHead>
                          )}
                          <TableHead className="bg-slate-900 text-muted-foreground text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortedReasons.map((reason) => (
                          <TableRow
                            key={reason.id}
                            className="border-slate-700 hover:bg-slate-800/30 cursor-pointer"
                            onClick={() => handleEditClick(reason)}
                          >
                            <TableCell className="font-medium text-white">{reason.name}</TableCell>
                            {columnVisibility.paid && (
                              <TableCell>
                                <Badge
                                  variant="outline"
                                  className={
                                    reason.is_paid
                                      ? 'border-blue-500/30 text-blue-400 bg-blue-500/10'
                                      : 'border-slate-600 text-muted-foreground'
                                  }
                                >
                                  {reason.is_paid ? 'Paid' : 'Unpaid'}
                                </Badge>
                              </TableCell>
                            )}
                            {columnVisibility.color && (
                              <TableCell>
                                <div className="flex items-center gap-2 text-muted-foreground">
                                  <span
                                    className="h-3 w-3 rounded-full border border-white/20"
                                    style={{ backgroundColor: reason.color || '#6366f1' }}
                                  />
                                  {reason.color || '#6366f1'}
                                </div>
                              </TableCell>
                            )}
                            {columnVisibility.status && (
                              <TableCell>
                                <Badge
                                  variant="outline"
                                  className={
                                    reason.is_active
                                      ? 'border-green-500/30 text-green-400 bg-green-500/10'
                                      : 'border-slate-600 text-muted-foreground'
                                  }
                                >
                                  {reason.is_active ? 'Active' : 'Inactive'}
                                </Badge>
                              </TableCell>
                            )}
                            {columnVisibility.updated && (
                              <TableCell className="text-muted-foreground">
                                {reason.updated_at ? new Date(reason.updated_at).toLocaleDateString() : '-'}
                              </TableCell>
                            )}
                            <TableCell className="text-right">
                              <div className="inline-flex items-center gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleToggleActive(reason);
                                  }}
                                  className="border-border text-muted-foreground"
                                >
                                  {reason.is_active ? 'Disable' : 'Enable'}
                                </Button>
                                {reason.is_active && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void handleDelete(reason);
                                    }}
                                    className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="md:hidden space-y-3">
                    {sortedReasons.map((reason) => (
                      <Card
                        key={reason.id}
                        className="bg-slate-800 border-slate-700 cursor-pointer"
                        onClick={() => handleEditClick(reason)}
                      >
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <h3 className="font-semibold text-white">{reason.name}</h3>
                            <span
                              className="h-3 w-3 rounded-full border border-white/20"
                              style={{ backgroundColor: reason.color || '#6366f1' }}
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge
                              variant="outline"
                              className={
                                reason.is_paid
                                  ? 'border-blue-500/30 text-blue-400 bg-blue-500/10'
                                  : 'border-slate-600 text-muted-foreground'
                              }
                            >
                              {reason.is_paid ? 'Paid' : 'Unpaid'}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={
                                reason.is_active
                                  ? 'border-green-500/30 text-green-400 bg-green-500/10'
                                  : 'border-slate-600 text-muted-foreground'
                              }
                            >
                              {reason.is_active ? 'Active' : 'Inactive'}
                            </Badge>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Updated {reason.updated_at ? new Date(reason.updated_at).toLocaleDateString() : '-'}
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleToggleActive(reason);
                              }}
                              className="border-border text-muted-foreground flex-1"
                            >
                              {reason.is_active ? 'Disable' : 'Enable'}
                            </Button>
                            {reason.is_active && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleDelete(reason);
                                }}
                                className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className={dialogContentViewportClassName({ size: '3xl', className: 'border-border' })}>
          <DialogHeader>
            <DialogTitle className="text-foreground">Add Absence Reason</DialogTitle>
            <DialogDescription className="text-slate-400/90">
              Create a new reason for absence or leave
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border border-[hsl(var(--absence-primary)/0.25)] bg-[hsl(var(--absence-primary)/0.06)] p-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name" className="text-foreground font-medium">Reason Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Sick Leave"
                className="bg-slate-950 border-border text-foreground"
              />
            </div>

            <div className="flex items-center gap-2 rounded-md border border-border bg-slate-950 px-3 py-2">
              <Checkbox id="isPaid" checked={isPaid} onCheckedChange={(value) => setIsPaid(Boolean(value))} />
              <label htmlFor="isPaid" className="text-sm text-slate-400/90 cursor-pointer">
                This is a paid absence
              </label>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reasonColor" className="text-foreground font-medium">Calendar Color</Label>
              <div className="mt-2 flex items-center gap-3">
                <Input
                  id="reasonColor"
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-10 w-16 p-1 border-border bg-background"
                />
                <Input value={color} onChange={(e) => setColor(e.target.value)} className="border-border bg-background text-foreground" />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)} className="border-border text-muted-foreground">
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={submitting || !name.trim()}
              className="bg-absence hover:bg-absence-dark text-white"
            >
              {submitting ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className={dialogContentViewportClassName({ size: '3xl', className: 'border-border' })}>
          <DialogHeader>
            <DialogTitle className="text-foreground">Edit Absence Reason</DialogTitle>
            <DialogDescription className="text-slate-400/90">Update the reason details</DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border border-[hsl(var(--absence-primary)/0.25)] bg-[hsl(var(--absence-primary)/0.06)] p-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="editName" className="text-foreground font-medium">Reason Name *</Label>
              <Input
                id="editName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Sick Leave"
                className="bg-slate-950 border-border text-foreground"
              />
            </div>

            <div className="flex items-center gap-2 rounded-md border border-border bg-slate-950 px-3 py-2">
              <Checkbox id="editIsPaid" checked={isPaid} onCheckedChange={(value) => setIsPaid(Boolean(value))} />
              <label htmlFor="editIsPaid" className="text-sm text-slate-400/90 cursor-pointer">
                This is a paid absence
              </label>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="editReasonColor" className="text-foreground font-medium">Calendar Color</Label>
              <div className="mt-2 flex items-center gap-3">
                <Input
                  id="editReasonColor"
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-10 w-16 p-1 border-border bg-background"
                />
                <Input value={color} onChange={(e) => setColor(e.target.value)} className="border-border bg-background text-foreground" />
              </div>
              <div className="mt-3">
                <p className="mb-2 text-xs text-muted-foreground">Default colors</p>
                <div className="grid grid-cols-5 gap-2">
                  {DEFAULT_REASON_COLORS.map((presetColor) => {
                    const isSelected = color.toLowerCase() === presetColor.toLowerCase();
                    return (
                      <button
                        key={presetColor}
                        type="button"
                        onClick={() => setColor(presetColor)}
                        className={`h-8 w-full rounded border transition ${isSelected ? 'border-white ring-2 ring-white/40' : 'border-white/20 hover:border-white/50'}`}
                        style={{ backgroundColor: presetColor }}
                        aria-label={`Use color ${presetColor}`}
                        title={presetColor}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowEditDialog(false);
                setEditingReason(null);
              }}
              className="border-border text-muted-foreground"
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpdate}
              disabled={submitting || !name.trim()}
              className="bg-absence hover:bg-absence-dark text-white"
            >
              {submitting ? 'Updating...' : 'Update'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDisableDialog} onOpenChange={setShowDisableDialog}>
        <DialogContent className={dialogContentViewportClassName({ size: '3xl', className: 'border-border' })}>
          <DialogHeader>
            <DialogTitle className="text-foreground">Disable Absence Reason</DialogTitle>
            <DialogDescription className="text-slate-400/90">
              Are you sure you want to disable {disableTargetReason?.name ? `'${disableTargetReason.name}'` : 'this reason'}? It will no longer be available for new absence requests.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
            <p className="text-sm text-red-300">Existing records remain unchanged, but this reason will be unavailable for new requests.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDisableDialog(false)} className="border-border text-muted-foreground">
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDisableReason} disabled={disableSubmitting || !disableTargetReason}>
              {disableSubmitting ? 'Disabling...' : 'Disable'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
