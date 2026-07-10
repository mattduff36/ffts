'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AssignUsersModal, type AssignUsersSubmitPayload } from '@/components/users/assign-users-modal';
import { fetchUserDirectory } from '@/lib/client/user-directory';
import { createClient } from '@/lib/supabase/client';
import type { AssignUsersUser } from '@/lib/utils/assign-users';

interface AssignEmployeesModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  documentId: string;
  documentTitle: string;
}

interface RamsAssignment {
  employee_id: string;
  status: string;
}

export function AssignEmployeesModal({
  open,
  onClose,
  onSuccess,
  documentId,
  documentTitle,
}: AssignEmployeesModalProps) {
  const [users, setUsers] = useState<AssignUsersUser[]>([]);
  const [initialSelectedIds, setInitialSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const resetState = useCallback(() => {
    setUsers([]);
    setInitialSelectedIds([]);
  }, []);

  const loadUsers = useCallback(async () => {
    if (!documentId) return;

    setLoading(true);
    try {
      const [directoryUsers, supabase] = await Promise.all([
        fetchUserDirectory({ includeRole: true, module: 'rams' }),
        Promise.resolve(createClient()),
      ]);

      const { data: assignments, error: assignmentsError } = await supabase
        .from('rams_assignments')
        .select('employee_id, status')
        .eq('rams_document_id', documentId);

      if (assignmentsError) throw assignmentsError;

      const typedAssignments = (assignments || []) as RamsAssignment[];
      const signedEmployeeIds = new Set(
        typedAssignments
          .filter((assignment) => assignment.status === 'signed')
          .map((assignment) => assignment.employee_id),
      );
      const assignedEmployeeIds = typedAssignments.map((assignment) => assignment.employee_id);

      setInitialSelectedIds(assignedEmployeeIds);
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
          isLocked: signedEmployeeIds.has(user.id),
          lockedMessage: 'Signed',
          super_admin: user.super_admin,
        })),
      );
    } catch (error) {
      console.error('Error fetching assignable users:', error);
      toast.error('Failed to load users');
      resetState();
    } finally {
      setLoading(false);
    }
  }, [documentId, resetState]);

  useEffect(() => {
    if (!open) return;

    void loadUsers();
  }, [loadUsers, open]);

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) return;

    if (!submitting) {
      resetState();
      onClose();
    }
  }

  async function handleSubmit({ selectedIds, addedIds, removedIds }: AssignUsersSubmitPayload) {
    setSubmitting(true);
    try {
      const response = await fetch(`/api/rams/${documentId}/assign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          employee_ids: selectedIds,
          unassign_ids: removedIds,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to update assignments');
      }

      if (addedIds.length > 0 && removedIds.length > 0) {
        toast.success(`Assigned ${addedIds.length} user(s) and unassigned ${removedIds.length} user(s)`);
      } else if (addedIds.length > 0) {
        toast.success(`Assigned ${addedIds.length} user(s)`);
      } else if (removedIds.length > 0) {
        toast.success(`Unassigned ${removedIds.length} user(s)`);
      } else {
        toast.success('Assignments updated');
      }

      resetState();
      onSuccess();
    } catch (error) {
      console.error('Assignment error:', error);
      toast.error(error instanceof Error ? error.message : 'Assignment failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AssignUsersModal
      open={open}
      onOpenChange={handleOpenChange}
      users={users}
      initialSelectedIds={initialSelectedIds}
      loading={loading}
      submitting={submitting}
      title="Assign users"
      entityLabel={documentTitle}
      description="Select users to assign this document to."
      submitLabel="Update assignments"
      submittingLabel="Updating..."
      selectableVariant="rams"
      submitButtonClassName="bg-rams text-white hover:bg-rams-dark"
      teamActiveClassName="border-rams bg-rams/15 text-rams"
      spinnerClassName="text-green-500"
      onSubmit={handleSubmit}
    />
  );
}
