'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { subscribeToAuthStateChange } from '@/lib/app-auth/client';
import { loadClientAuthSession } from '@/lib/app-auth/client-session';
import { fetchWithAuth } from '@/lib/utils/fetch-with-auth';
import { getErrorStatus, isAuthErrorStatus, isNetworkFetchError } from '@/lib/utils/http-error';
import { BlockingMessageModal } from './BlockingMessageModal';
import { ReminderModal } from './ReminderModal';
import { Loader2 } from 'lucide-react';
import { templateConfig } from '@/lib/config/template-config';

interface PendingToolboxTalk {
  id: string;
  recipient_id: string;
  subject: string;
  body: string;
  sender_name: string;
  created_at: string;
}

interface PendingReminder {
  id: string;
  recipient_id: string;
  created_via?: string | null;
  subject: string;
  body: string;
  sender_name: string;
  created_at: string;
}

const MESSAGE_BOOTSTRAP_TIMEOUT_MS = 4000;
const REMINDER_ADVANCE_DELAY_MS = 300;

interface PendingMessagesResponse {
  success?: boolean;
  toolbox_talks?: PendingToolboxTalk[];
  reminders?: PendingReminder[];
}

/**
 * MessageBlockingCheck Component
 * 
 * Handles the blocking flow for Toolbox Talks and non-blocking Reminders
 * Priority: Password Change (handled by layout redirect) → Toolbox Talks → Reminders
 * 
 * This component should be placed in the dashboard layout to check on every page load
 */
export function MessageBlockingCheck() {
  const router = useRouter();
  const pathname = usePathname();
  const isDashboardPath = pathname?.startsWith('/dashboard') ?? false;

  const [authRefreshTick, setAuthRefreshTick] = useState(0);
  const [checking, setChecking] = useState(false);
  const [pendingToolboxTalks, setPendingToolboxTalks] = useState<PendingToolboxTalk[]>([]);
  const [currentToolboxTalkIndex, setCurrentToolboxTalkIndex] = useState(0);
  const [pendingReminders, setPendingReminders] = useState<PendingReminder[]>([]);
  const [showReminder, setShowReminder] = useState(false);

  const checkPendingMessages = useCallback(async (signal: AbortSignal) => {
    try {
      const sessionResult = await loadClientAuthSession();
      if (signal.aborted || sessionResult.status !== 'authenticated' || !sessionResult.payload) {
        return;
      }

      const profile = sessionResult.payload.profile as { must_change_password?: boolean | null } | null | undefined;
      if (profile?.must_change_password) {
        // Password change takes priority - redirect handled by existing system
        router.push('/change-password');
        return;
      }

      // Fetch pending messages
      const response = await fetchWithAuth('/api/messages/pending', { signal });
      if (!response.ok || signal.aborted) {
        return;
      }

      const data = (await response.json()) as PendingMessagesResponse;

      if (signal.aborted || !data.success) {
        return;
      }

      const talks = data.toolbox_talks || [];
      const reminders = data.reminders || [];

      setPendingToolboxTalks(talks);
      setCurrentToolboxTalkIndex(0);
      setPendingReminders(reminders);
      setShowReminder(talks.length === 0 && reminders.length > 0);
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      if (!isAuthErrorStatus(getErrorStatus(error)) && !isNetworkFetchError(error)) {
        console.error('Error checking pending messages:', error);
      }
    } finally {
      if (!signal.aborted) {
        setChecking(false);
      }
    }
  }, [router]);

  useEffect(() => subscribeToAuthStateChange(() => {
    setAuthRefreshTick((current) => current + 1);
  }), []);

  useEffect(() => {
    if (!isDashboardPath) {
      setChecking(false);
      return;
    }

    const abortController = new AbortController();
    setChecking(true);
    void checkPendingMessages(abortController.signal);

    return () => {
      abortController.abort();
    };
  }, [authRefreshTick, checkPendingMessages, isDashboardPath, pathname]);

  useEffect(() => {
    if (!checking || !isDashboardPath) return;

    const timeoutId = window.setTimeout(() => {
      setChecking(false);
    }, MESSAGE_BOOTSTRAP_TIMEOUT_MS);

    return () => window.clearTimeout(timeoutId);
  }, [checking, isDashboardPath, pathname]);

  function handleToolboxTalkSigned() {
    // Move to next Toolbox Talk or finish
    if (currentToolboxTalkIndex + 1 < pendingToolboxTalks.length) {
      setCurrentToolboxTalkIndex(currentToolboxTalkIndex + 1);
    } else {
      // All Toolbox Talks signed, check if there are Reminders
      setPendingToolboxTalks([]);
      setCurrentToolboxTalkIndex(0);
      
      if (pendingReminders.length > 0) {
        setShowReminder(true);
      }
    }
  }

  function handleReminderDismissed() {
    // Remove the dismissed reminder from the list
    setShowReminder(false);
    setPendingReminders((currentReminders) => {
      const nextReminders = currentReminders.slice(1);

      // Show next reminder if any
      if (nextReminders.length > 0) {
        window.setTimeout(() => setShowReminder(true), REMINDER_ADVANCE_DELAY_MS);
      }

      return nextReminders;
    });
  }

  // Show loading state briefly while checking
  if (checking) {
    return (
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center">
        <div className="bg-white dark:bg-slate-900 rounded-lg p-6 flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading {templateConfig.branding.appName}...</p>
        </div>
      </div>
    );
  }

  // Show blocking Toolbox Talk modal (if any pending)
  if (pendingToolboxTalks.length > 0) {
    const currentTalk = pendingToolboxTalks[currentToolboxTalkIndex];
    
    return (
      <BlockingMessageModal
        open={true}
        message={currentTalk}
        onSigned={handleToolboxTalkSigned}
        totalPending={pendingToolboxTalks.length}
        currentIndex={currentToolboxTalkIndex}
      />
    );
  }

  // Show non-blocking Reminder modal (if any pending)
  if (showReminder && pendingReminders.length > 0) {
    return (
      <ReminderModal
        open={true}
        onClose={() => setShowReminder(false)}
        message={pendingReminders[0]}
        onDismissed={handleReminderDismissed}
      />
    );
  }

  // No blocking messages
  return null;
}

