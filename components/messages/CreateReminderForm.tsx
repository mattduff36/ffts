'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Bell, CheckSquare, UserPlus, Info } from 'lucide-react';
import { toast } from 'sonner';
import { AssignUsersModal, type AssignUsersSubmitPayload } from '@/components/users/assign-users-modal';
import { fetchUserDirectory } from '@/lib/client/user-directory';
import type { AssignUsersUser } from '@/lib/utils/assign-users';

interface CreateReminderFormProps {
  onSuccess?: () => void;
}

type CreateMessageMode = 'notification' | 'reminder';

export function CreateReminderForm({ onSuccess }: CreateReminderFormProps) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [mode, setMode] = useState<CreateMessageMode>('notification');
  const [modalOpen, setModalOpen] = useState(false);
  const [users, setUsers] = useState<AssignUsersUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const resetUsers = useCallback(() => {
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
      resetUsers();
    } finally {
      setUsersLoading(false);
    }
  }, [resetUsers]);

  useEffect(() => {
    if (modalOpen) {
      void loadUsers();
    }
  }, [loadUsers, modalOpen]);

  function handleOpenModal(e: React.FormEvent) {
    e.preventDefault();

    // Validation
    if (!subject.trim()) {
      toast.error('Subject is required');
      return;
    }

    if (!body.trim()) {
      toast.error('Message body is required');
      return;
    }

    setModalOpen(true);
  }

  async function sendNotification(employeeIds: string[]) {
    const response = await fetch('/api/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'NOTIFICATION',
        subject,
        body,
        recipient_type: 'individual',
        recipient_user_ids: employeeIds
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to send notification');
    }

    toast.success(`Notification sent to ${data.recipients_created} employee(s)`);
  }

  async function sendReminder(employeeIds: string[]) {
    const response = await fetch('/api/reminders/manual', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        subject,
        body,
        recipient_user_ids: employeeIds
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to create reminder');
    }

    toast.success(`Reminder created for ${data.recipients_created} employee(s)`);
  }

  async function handleSendToRecipients({ selectedIds }: AssignUsersSubmitPayload) {
    if (selectedIds.length === 0) return;

    setSending(true);
    try {
      if (mode === 'reminder') {
        await sendReminder(selectedIds);
      } else {
        await sendNotification(selectedIds);
      }
      
      // Reset form
      setSubject('');
      setBody('');
      resetUsers();
      setModalOpen(false);

      onSuccess?.();

    } catch (error) {
      console.error('Error sending message:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  }

  function handleModalOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setModalOpen(true);
      return;
    }

    if (!sending) {
      resetUsers();
      setModalOpen(false);
    }
  }

  return (
    <>
      <form onSubmit={handleOpenModal} className="space-y-6">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            {mode === 'notification'
              ? 'Notifications are non-blocking messages shown in the Notifications section.'
              : 'Reminders are tasks shown in the Reminders module until the recipient dismisses them.'}
          </AlertDescription>
        </Alert>

        <div className="space-y-3">
          <Label className="text-foreground">Message Type *</Label>
          <div className="grid gap-3 md:grid-cols-2">
            <button
              type="button"
              onClick={() => setMode('notification')}
              className={`rounded-lg border p-4 text-left transition-all ${
                mode === 'notification'
                  ? 'border-blue-500/40 bg-blue-500/10 ring-2 ring-brand-yellow'
                  : 'border-border bg-white hover:bg-muted/30 dark:bg-slate-900'
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Bell className="h-4 w-4" />
                Create Notification
              </span>
              <span className="mt-2 block text-xs leading-5 text-muted-foreground">
                Existing dismissible notification behavior.
              </span>
            </button>
            <button
              type="button"
              onClick={() => setMode('reminder')}
              className={`rounded-lg border p-4 text-left transition-all ${
                mode === 'reminder'
                  ? 'border-reminders bg-reminders-soft ring-2 ring-brand-yellow'
                  : 'border-border bg-white hover:bg-muted/30 dark:bg-slate-900'
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <CheckSquare className="h-4 w-4" />
                Create Reminder
              </span>
              <span className="mt-2 block text-xs leading-5 text-muted-foreground">
                Creates a Reminders module item with a dismiss CTA.
              </span>
            </button>
          </div>
        </div>

        {/* Subject */}
        <div className="space-y-2">
          <Label htmlFor="subject" className="text-foreground">
            Subject *
          </Label>
          <Input
            id="subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g., Upcoming Site Inspection - Friday 3pm"
            required
            className="bg-white dark:bg-slate-900 border-border text-foreground"
          />
        </div>

        {/* Message Body */}
        <div className="space-y-2">
          <Label htmlFor="body" className="text-foreground">
            Message *
          </Label>
          <Textarea
            id="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={mode === 'notification' ? 'Enter the notification message...' : 'Enter the reminder message...'}
            rows={8}
            required
            className="bg-white dark:bg-slate-900 border-border text-foreground"
          />
          <p className="text-xs text-muted-foreground dark:text-muted-foreground">
            {mode === 'notification'
              ? 'This message will be shown in the notifications panel for 60 days.'
              : 'This reminder will stay in the Reminders module until the recipient dismisses it.'}
          </p>
        </div>

        {/* Submit Button */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
          <Button
            type="submit"
            className="bg-brand-yellow text-slate-900 shadow-md transition-all duration-200 hover:bg-brand-yellow-hover hover:shadow-lg active:scale-95"
          >
            <UserPlus className="h-4 w-4 mr-2" />
            Choose Recipients
          </Button>
        </div>
      </form>

      <AssignUsersModal
        open={modalOpen}
        onOpenChange={handleModalOpenChange}
        users={users}
        initialSelectedIds={[]}
        loading={usersLoading}
        submitting={sending}
        title="Assign users"
        entityLabel={subject || undefined}
        description={
          mode === 'notification'
            ? 'Select users to receive this notification.'
            : 'Select users to receive this reminder in the Reminders module.'
        }
        submitLabel={mode === 'notification' ? 'Send notification' : 'Create reminder'}
        submittingLabel={mode === 'notification' ? 'Sending...' : 'Creating...'}
        selectableVariant="default"
        submitButtonClassName="bg-brand-yellow text-slate-900 hover:bg-brand-yellow-hover"
        teamActiveClassName="border-brand-yellow bg-brand-yellow/15 text-foreground"
        spinnerClassName="text-brand-yellow"
        requireSelection
        onSubmit={handleSendToRecipients}
      />
    </>
  );
}

