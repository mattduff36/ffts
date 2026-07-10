'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AssignUsersModal, type AssignUsersSubmitPayload } from '@/components/users/assign-users-modal';
import { fetchUserDirectory } from '@/lib/client/user-directory';
import type { AssignUsersUser } from '@/lib/utils/assign-users';

interface ToolboxTalkAssignDialogProps {
  open: boolean;
  subject: string;
  onOpenChange: (open: boolean) => void;
  onSend: (userIds: string[]) => Promise<void>;
}

export function ToolboxTalkAssignDialog({
  open,
  subject,
  onOpenChange,
  onSend,
}: ToolboxTalkAssignDialogProps) {
  const [users, setUsers] = useState<AssignUsersUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const resetState = useCallback(() => {
    setUsers([]);
  }, []);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const directoryUsers = await fetchUserDirectory({
        includeRole: true,
        context: 'toolbox-talks-assignment',
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
  }, [resetState]);

  useEffect(() => {
    if (open) {
      void loadUsers();
    }
  }, [loadUsers, open]);

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      onOpenChange(true);
      return;
    }

    if (!sending) {
      resetState();
      onOpenChange(false);
    }
  }

  async function handleSubmit({ selectedIds }: AssignUsersSubmitPayload) {
    if (selectedIds.length === 0) return;

    setSending(true);
    try {
      await onSend(selectedIds);
      resetState();
      onOpenChange(false);
    } catch (error) {
      console.error('Toolbox Talk send error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to send Toolbox Talk');
    } finally {
      setSending(false);
    }
  }

  return (
    <AssignUsersModal
      open={open}
      onOpenChange={handleOpenChange}
      users={users}
      initialSelectedIds={[]}
      loading={usersLoading}
      submitting={sending}
      title="Assign users"
      entityLabel={subject || undefined}
      description="Select users to receive and sign this toolbox talk."
      searchPlaceholder="Search by name, team or role"
      emptyMessage="No users found."
      submitLabel="Send toolbox talk"
      submittingLabel="Sending..."
      selectableVariant="default"
      submitButtonClassName="bg-brand-yellow text-slate-900 hover:bg-brand-yellow-hover"
      teamActiveClassName="border-brand-yellow bg-brand-yellow/15 text-foreground"
      spinnerClassName="text-brand-yellow"
      requireSelection
      onSubmit={handleSubmit}
    />
  );
}
