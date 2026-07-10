'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AssignUsersModal, type AssignUsersSubmitPayload } from '@/components/users/assign-users-modal';
import { fetchUserDirectory } from '@/lib/client/user-directory';
import type { AssignUsersUser } from '@/lib/utils/assign-users';
import { getReminderActionRequiredModule } from '@/lib/utils/reminder-action-permissions';
import type { ReminderActionWithAsset } from '@/types/reminders';

interface ActionsAssignDialogProps {
  open: boolean;
  action: ReminderActionWithAsset | null;
  onOpenChange: (open: boolean) => void;
  onAssigned: () => Promise<void>;
}

export function ActionsAssignDialog({
  open,
  action,
  onOpenChange,
  onAssigned,
}: ActionsAssignDialogProps) {
  const [users, setUsers] = useState<AssignUsersUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const requiredModule = getReminderActionRequiredModule(action?.asset_type);

  const resetState = useCallback(() => {
    setUsers([]);
  }, []);

  const loadUsers = useCallback(async () => {
    if (!action) {
      resetState();
      return;
    }

    setUsersLoading(true);
    try {
      const directoryUsers = await fetchUserDirectory({
        includeRole: true,
        module: requiredModule,
        context: 'actions-assignment',
      });

      setUsers(
        directoryUsers.map((user) => ({
          id: user.id,
          full_name: user.full_name || 'Unknown user',
          employee_id: user.employee_id || null,
          team: user.team?.id
            ? {
                id: user.team.id,
                name: user.team.name || user.team.id,
              }
            : null,
          role: user.role
            ? {
                name: user.role.name || 'unknown',
                display_name: user.role.display_name || user.role.name || 'Unknown',
                is_super_admin: user.role.is_super_admin,
              }
            : null,
          hasModuleAccess: user.has_module_access !== false,
          super_admin: user.super_admin,
        })),
      );
    } catch (error) {
      console.error(error);
      toast.error('Failed to load users');
      resetState();
    } finally {
      setUsersLoading(false);
    }
  }, [action, requiredModule, resetState]);

  useEffect(() => {
    if (open && action) {
      void loadUsers();
    }
  }, [action, loadUsers, open]);

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      onOpenChange(true);
      return;
    }

    if (!assigning) {
      resetState();
      onOpenChange(false);
    }
  }

  async function handleSubmit({ selectedIds }: AssignUsersSubmitPayload) {
    if (!action || selectedIds.length === 0) return;

    setAssigning(true);
    try {
      const response = await fetch('/api/actions/assign', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action_id: action.id,
          assignee_ids: selectedIds,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to assign users');
      }

      toast.success(`Reminder assigned to ${payload.assigned_count || selectedIds.length} user(s)`);
      resetState();
      onOpenChange(false);
      await onAssigned();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Failed to assign users');
    } finally {
      setAssigning(false);
    }
  }

  return (
    <AssignUsersModal
      open={open}
      onOpenChange={handleOpenChange}
      users={users}
      initialSelectedIds={[]}
      loading={usersLoading}
      submitting={assigning}
      title="Assign users"
      entityLabel={action?.asset_label || action?.title || undefined}
      description="Select users to assign this reminder to."
      submitLabel="Assign reminder"
      submittingLabel="Assigning..."
      selectableVariant="default"
      submitButtonClassName="bg-brand-yellow text-slate-900 hover:bg-brand-yellow-hover"
      teamActiveClassName="border-brand-yellow bg-brand-yellow/15 text-foreground"
      spinnerClassName="text-brand-yellow"
      requireSelection
      onSubmit={handleSubmit}
    />
  );
}
