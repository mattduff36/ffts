'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { CheckCircle2, Loader2, Search, UserCheck, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SelectableCard, type ModuleVariant } from '@/components/ui/selectable-card';
import { PanelLoader } from '@/components/ui/panel-loader';
import {
  buildAssignUsersTeamOptions,
  getAssignUsersBulkIds,
  type AssignUsersUser,
} from '@/lib/utils/assign-users';
import { cn } from '@/lib/utils/cn';

export interface AssignUsersSubmitPayload {
  selectedIds: string[];
  addedIds: string[];
  removedIds: string[];
}

interface AssignUsersModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: AssignUsersUser[];
  initialSelectedIds?: string[];
  loading?: boolean;
  submitting?: boolean;
  title?: string;
  entityLabel?: string;
  description?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  submitLabel?: string;
  submittingLabel?: string;
  selectableVariant?: ModuleVariant;
  submitButtonClassName?: string;
  teamActiveClassName?: string;
  spinnerClassName?: string;
  requireSelection?: boolean;
  onSubmit: (payload: AssignUsersSubmitPayload) => Promise<void> | void;
}

function getUserSearchValues(user: AssignUsersUser): string[] {
  return [
    user.full_name || '',
    user.employee_id || '',
    user.team?.name || '',
    user.role?.display_name || user.role?.name || '',
  ];
}

function AssignUsersModalContent({
  open,
  onOpenChange,
  users,
  initialSelectedIds = [],
  loading = false,
  submitting = false,
  title = 'Assign users',
  entityLabel,
  description = 'Select users to assign.',
  searchPlaceholder = 'Search by name, team or role',
  emptyMessage = 'No eligible users found.',
  submitLabel = 'Update assignments',
  submittingLabel = 'Updating...',
  selectableVariant = 'default',
  submitButtonClassName = 'bg-brand-yellow text-slate-900 hover:bg-brand-yellow-hover',
  teamActiveClassName = 'border-brand-yellow bg-brand-yellow/15 text-foreground',
  spinnerClassName = 'text-brand-yellow',
  requireSelection = false,
  onSubmit,
}: AssignUsersModalProps) {
  const initialSelectedKey = initialSelectedIds.join('\0');
  const initialSelectedSnapshot = useMemo(
    () => (initialSelectedKey ? initialSelectedKey.split('\0') : []),
    [initialSelectedKey],
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(initialSelectedSnapshot));
  const [searchQuery, setSearchQuery] = useState('');

  const originalSelectedIds = useMemo(() => new Set(initialSelectedSnapshot), [initialSelectedSnapshot]);

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const visibleUsers = useMemo(() => {
    const eligibleUsers = users.filter((user) => user.hasModuleAccess !== false);
    if (!normalizedSearchQuery) return eligibleUsers;

    return eligibleUsers.filter((user) =>
      getUserSearchValues(user).some((value) => value.toLowerCase().includes(normalizedSearchQuery)),
    );
  }, [normalizedSearchQuery, users]);

  const teamOptions = useMemo(() => buildAssignUsersTeamOptions(users), [users]);
  const allBulkUserIds = useMemo(() => getAssignUsersBulkIds(users), [users]);
  const allTeamsSelected =
    allBulkUserIds.length > 0 && allBulkUserIds.every((userId) => selectedIds.has(userId));

  function handleClose() {
    if (submitting) return;

    setSelectedIds(new Set(initialSelectedSnapshot));
    setSearchQuery('');
    onOpenChange(false);
  }

  function handleToggleUser(user: AssignUsersUser) {
    if (user.hasModuleAccess === false || user.isLocked) return;

    setSelectedIds((current) => {
      const nextSelectedIds = new Set(current);
      if (nextSelectedIds.has(user.id)) {
        nextSelectedIds.delete(user.id);
      } else {
        nextSelectedIds.add(user.id);
      }
      return nextSelectedIds;
    });
  }

  function handleToggleBulk(userIds: string[]) {
    if (userIds.length === 0) return;

    setSelectedIds((current) => {
      const nextSelectedIds = new Set(current);
      const isEveryUserSelected = userIds.every((userId) => nextSelectedIds.has(userId));

      if (isEveryUserSelected) {
        userIds.forEach((userId) => nextSelectedIds.delete(userId));
      } else {
        userIds.forEach((userId) => nextSelectedIds.add(userId));
      }

      return nextSelectedIds;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requireSelection && selectedIds.size === 0) return;

    const selectedIdsList = Array.from(selectedIds);
    await onSubmit({
      selectedIds: selectedIdsList,
      addedIds: selectedIdsList.filter((id) => !originalSelectedIds.has(id)),
      removedIds: Array.from(originalSelectedIds).filter((id) => !selectedIds.has(id)),
    });
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (nextOpen ? onOpenChange(true) : handleClose())}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] flex-col sm:max-w-4xl lg:max-w-5xl">
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {entityLabel ? (
                <>
                  <span className="font-medium text-foreground">{entityLabel}</span>
                  <br />
                </>
              ) : null}
              {description}
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 gap-4 py-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={searchPlaceholder}
                disabled={loading || submitting}
                className="pl-10"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleToggleBulk(allBulkUserIds)}
                  disabled={loading || submitting || allBulkUserIds.length === 0}
                  className={cn(
                    'border-border text-xs',
                    allTeamsSelected ? teamActiveClassName : 'hover:bg-muted/40',
                  )}
                >
                  <Users className="mr-2 h-4 w-4" />
                  All Teams
                </Button>

                {teamOptions.map((team) => {
                  const isSelected =
                    team.selectableUserIds.length > 0 &&
                    team.selectableUserIds.every((userId) => selectedIds.has(userId));
                  const isDisabled = loading || submitting || team.selectableUserIds.length === 0;

                  return (
                    <Button
                      key={team.id}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleToggleBulk(team.selectableUserIds)}
                      disabled={isDisabled}
                      className={cn(
                        'border-border text-xs',
                        isSelected ? teamActiveClassName : 'hover:bg-muted/40',
                      )}
                    >
                      {team.name}
                    </Button>
                  );
                })}
              </div>

              <span className="rounded-md border border-border bg-muted/20 px-3 py-1.5 text-sm font-medium text-foreground">
                {selectedIds.size} selected
              </span>
            </div>

            {loading ? (
              <PanelLoader
                message="Loading users..."
                className={cn('min-h-[360px] rounded-lg border border-border', spinnerClassName)}
              />
            ) : (
              <ScrollArea className="h-[420px] pr-4">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {visibleUsers.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground md:col-span-2">{emptyMessage}</p>
                  ) : (
                    visibleUsers.map((user) => (
                      <SelectableCard
                        key={user.id}
                        selected={selectedIds.has(user.id)}
                        onSelect={() => handleToggleUser(user)}
                        disabled={submitting || user.hasModuleAccess === false}
                        locked={user.isLocked || user.hasModuleAccess === false}
                        lockedMessage={user.isLocked ? user.lockedMessage : 'No Access'}
                        variant={selectableVariant}
                      >
                        <div className="flex w-full items-center justify-between gap-3">
                          <div className="flex min-w-0 flex-col">
                            <span className="truncate text-sm font-medium text-slate-100">
                              {user.full_name || 'Unknown user'}
                              {user.employee_id ? ` (${user.employee_id})` : ''}
                            </span>
                            <span className="truncate text-xs text-muted-foreground">
                              {[user.team?.name, user.role?.display_name || user.role?.name]
                                .filter(Boolean)
                                .join(' · ') || 'No role'}
                            </span>
                          </div>
                          {user.isLocked ? <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-green-500" /> : null}
                        </div>
                      </SelectableCard>
                    ))
                  )}
                </div>
              </ScrollArea>
            )}
          </div>

          <DialogFooter className="gap-3">
            <Button type="button" variant="outline" onClick={handleClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || submitting || (requireSelection && selectedIds.size === 0)}
              className={cn('gap-2', submitButtonClassName)}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {submittingLabel}
                </>
              ) : (
                <>
                  <UserCheck className="h-4 w-4" />
                  {submitLabel} ({selectedIds.size} selected)
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AssignUsersModal(props: AssignUsersModalProps) {
  const initialSelectedKey = (props.initialSelectedIds || []).join('\0');
  const resetKey = `${props.open ? 'open' : 'closed'}:${initialSelectedKey}`;

  return <AssignUsersModalContent key={resetKey} {...props} />;
}
