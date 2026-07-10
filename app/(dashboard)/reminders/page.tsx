'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, BellRing, CalendarClock, CheckCircle2, ClipboardCheck, Loader2, UserRound } from 'lucide-react';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageLoader } from '@/components/ui/page-loader';
import { PanelLoader } from '@/components/ui/panel-loader';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { TOOLBOX_TALK_MANUAL_REMINDER_WORKFLOW_KEY, VAN_DRAFT_SUBMISSION_WORKFLOW_KEY } from '@/lib/config/reminder-workflows';
import { VAN_DRAFT_SUBMISSION_REMINDER_MESSAGE } from '@/lib/utils/van-draft-submission-reminders';
import type { ReminderWithAction } from '@/types/reminders';
import { toast } from 'sonner';

interface RemindersResponse {
  success: boolean;
  reminders?: ReminderWithAction[];
  error?: string;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Never';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';

  return date.toLocaleDateString('en-GB').replace(/\//g, '-');
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Unknown';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';

  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getLatestInspectionLabel(reminder: ReminderWithAction): string {
  if (reminder.action.workflow_key === TOOLBOX_TALK_MANUAL_REMINDER_WORKFLOW_KEY) {
    return 'Manual reminder';
  }

  if (reminder.action.workflow_key === VAN_DRAFT_SUBMISSION_WORKFLOW_KEY) {
    const value = reminder.action.metadata?.inspection_date;
    return typeof value === 'string' ? formatDate(value) : 'Draft';
  }

  const value = reminder.action.metadata?.last_submitted_inspection_date;
  return typeof value === 'string' ? formatDate(value) : 'Never';
}

function getOverdueLabel(reminder: ReminderWithAction): string {
  if (reminder.action.workflow_key === TOOLBOX_TALK_MANUAL_REMINDER_WORKFLOW_KEY) {
    return 'Reminder';
  }

  if (reminder.action.workflow_key === VAN_DRAFT_SUBMISSION_WORKFLOW_KEY) {
    return 'Draft ready';
  }

  const lastSubmitted = reminder.action.metadata?.last_submitted_inspection_date;
  if (typeof lastSubmitted !== 'string') return 'Check required';

  const value = reminder.action.metadata?.days_overdue;
  return typeof value === 'number' ? `${value} days` : 'Check required';
}

function getReminderInstruction(reminder: ReminderWithAction): string {
  if (reminder.action.workflow_key === TOOLBOX_TALK_MANUAL_REMINDER_WORKFLOW_KEY) {
    return reminder.action.description || 'Please read this reminder and dismiss it when complete.';
  }

  if (reminder.action.workflow_key === VAN_DRAFT_SUBMISSION_WORKFLOW_KEY) {
    return VAN_DRAFT_SUBMISSION_REMINDER_MESSAGE;
  }

  return `Please complete this ${reminder.task_name || 'assigned task'} as soon as possible. This reminder will disappear automatically once the task is complete.`;
}

export default function RemindersPage() {
  const router = useRouter();
  const { hasPermission: canViewReminders, loading: permissionLoading } = usePermissionCheck('reminders', false);
  const [reminders, setReminders] = useState<ReminderWithAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissingReminderId, setDismissingReminderId] = useState<string | null>(null);

  const loadReminders = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/reminders?status=pending', { cache: 'no-store' });
      const payload = (await response.json()) as RemindersResponse;
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load reminders');
      }

      setReminders(payload.reminders || []);
    } catch (error) {
      console.error(error);
      setReminders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!permissionLoading && !canViewReminders) {
      router.replace('/dashboard');
    }
  }, [permissionLoading, canViewReminders, router]);

  useEffect(() => {
    if (!permissionLoading && canViewReminders) {
      void loadReminders();
    }
  }, [permissionLoading, canViewReminders, loadReminders]);

  async function handleDismissManualReminder(reminderId: string) {
    setDismissingReminderId(reminderId);
    try {
      const response = await fetch(`/api/reminders/${reminderId}/dismiss`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to dismiss reminder');
      }

      toast.success('Reminder dismissed');
      setReminders((current) => current.filter((reminder) => reminder.id !== reminderId));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to dismiss reminder');
    } finally {
      setDismissingReminderId(null);
    }
  }

  if (permissionLoading) {
    return <PageLoader message="Loading reminders..." />;
  }

  if (!canViewReminders) {
    return <PageLoader message="Redirecting..." />;
  }

  return (
    <AppPageShell width="medium">
      <AppPageHeader
        title="Reminders"
        description="Your assigned tasks stay here until the requested work has been completed."
        icon={<BellRing className="h-5 w-5" />}
        iconContainerClassName="bg-reminders-soft text-reminders"
      />

      {loading ? (
        <Card className="border-border">
          <CardContent>
            <PanelLoader message="Loading reminders..." accent="reminders" className="py-16" />
          </CardContent>
        </Card>
      ) : reminders.length === 0 ? (
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-foreground">No pending reminders</CardTitle>
            <CardDescription className="text-muted-foreground">
              You have no assigned reminder tasks right now.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-4">
          {reminders.map((reminder) => {
            const isManualReminder = reminder.action.workflow_key === TOOLBOX_TALK_MANUAL_REMINDER_WORKFLOW_KEY;

            return (
              <Card key={reminder.id} className="border-border">
                <CardHeader className="space-y-4">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={getOverdueLabel(reminder) === 'Check required' ? 'destructive' : 'warning'}>
                        {getOverdueLabel(reminder)}
                      </Badge>
                      <Badge variant="secondary">Assigned to you</Badge>
                    </div>
                    <div className="space-y-2">
                      <CardTitle className="text-xl text-foreground">
                        {reminder.action.asset_label || reminder.action.title}
                      </CardTitle>
                      <CardDescription className="text-sm leading-6 text-muted-foreground">
                        {getReminderInstruction(reminder)}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {!isManualReminder ? (
                      <div className="rounded-lg border border-border bg-muted/20 p-3">
                        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                          <ClipboardCheck className="h-4 w-4" />
                          Latest check
                        </div>
                        <p className="mt-2 text-sm font-medium text-foreground">{getLatestInspectionLabel(reminder)}</p>
                      </div>
                    ) : null}
                    <div className="rounded-lg border border-border bg-muted/20 p-3">
                      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                        <UserRound className="h-4 w-4" />
                        Assigned by
                      </div>
                      <p className="mt-2 text-sm font-medium text-foreground">
                        {reminder.assigned_by_name || 'A manager'}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/20 p-3 sm:col-span-2 lg:col-span-1">
                      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                        <CalendarClock className="h-4 w-4" />
                        Assigned
                      </div>
                      <p className="mt-2 text-sm font-medium text-foreground">
                        {formatDateTime(reminder.created_at)}
                      </p>
                    </div>
                    {isManualReminder ? (
                      <div className="rounded-lg border border-reminders bg-reminders-soft p-3 sm:col-span-2 lg:col-span-1">
                        <p className="text-sm leading-6 text-foreground">
                          Click once you have read this reminder.
                        </p>
                        <Button
                          type="button"
                          onClick={() => handleDismissManualReminder(reminder.id)}
                          disabled={dismissingReminderId === reminder.id}
                          className="mt-3 w-full gap-2 bg-reminders text-white hover:bg-reminders-dark"
                        >
                          {dismissingReminderId === reminder.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4" />
                          )}
                          {dismissingReminderId === reminder.id ? 'Dismissing...' : 'Dismiss reminder'}
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  {!isManualReminder ? (
                    <div className="rounded-lg border border-reminders bg-reminders-soft p-4">
                      <p className="text-sm leading-6 text-foreground">
                        Complete the task in the correct module. This reminder is marked as complete automatically after the task is submitted.
                      </p>
                      {reminder.task_href && reminder.task_label ? (
                        <Button asChild className="mt-4 w-full gap-2 bg-reminders text-white hover:bg-reminders-dark sm:w-auto">
                          <Link href={reminder.task_href}>
                            {reminder.task_label}
                            <ArrowRight className="h-4 w-4" />
                          </Link>
                        </Button>
                      ) : (
                        <p className="mt-3 text-sm text-muted-foreground">
                          No direct link is available for this reminder. Open the correct module from your dashboard to complete it.
                        </p>
                      )}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </AppPageShell>
  );
}
