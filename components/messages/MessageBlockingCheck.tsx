'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { subscribeToAuthStateChange } from '@/lib/app-auth/client';
import { loadClientAuthSession } from '@/lib/app-auth/client-session';
import { fetchWithAuth } from '@/lib/utils/fetch-with-auth';
import { getErrorStatus, isAuthErrorStatus, isNetworkFetchError } from '@/lib/utils/http-error';
import { useAuth } from '@/lib/hooks/useAuth';
import { BiometricEnrollmentPrompt } from '@/components/auth/BiometricEnrollmentPrompt';
import { BlockingMessageModal } from './BlockingMessageModal';
import { ReminderModal } from './ReminderModal';

interface PendingToolboxTalk {
  id: string;
  recipient_id: string;
  subject: string;
  body: string;
  priority?: 'LOW' | 'HIGH' | 'URGENT';
  acceptance_delay_minutes?: number;
  first_shown_at?: string | null;
  pdf_file_path?: string | null;
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
  const { profile, loading: authLoading } = useAuth();

  const [authRefreshTick, setAuthRefreshTick] = useState(0);
  const [checking, setChecking] = useState(false);
  const [pendingToolboxTalks, setPendingToolboxTalks] = useState<PendingToolboxTalk[]>([]);
  const [currentToolboxTalkIndex, setCurrentToolboxTalkIndex] = useState(0);
  const [pendingReminders, setPendingReminders] = useState<PendingReminder[]>([]);
  const [showReminder, setShowReminder] = useState(false);
  const [biometricPromptOpen, setBiometricPromptOpen] = useState(false);
  const [biometricCheckComplete, setBiometricCheckComplete] = useState(false);

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
      setShowReminder(false);
      setBiometricCheckComplete(false);
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
      setBiometricCheckComplete(false);
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

  useEffect(() => {
    if (pendingToolboxTalks.length > 0) return;
    if (!biometricCheckComplete || biometricPromptOpen) return;
    if (pendingReminders.length > 0) setShowReminder(true);
  }, [
    biometricCheckComplete,
    biometricPromptOpen,
    pendingReminders.length,
    pendingToolboxTalks.length,
  ]);

  function handleToolboxTalkCompleted() {
    // Move to next Toolbox Talk or finish
    if (currentToolboxTalkIndex + 1 < pendingToolboxTalks.length) {
      setCurrentToolboxTalkIndex(currentToolboxTalkIndex + 1);
    } else {
      // All Toolbox Talks signed, check if there are Reminders
      setPendingToolboxTalks([]);
      setCurrentToolboxTalkIndex(0);
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

  // Show blocking Toolbox Talk modal (if any pending)
  if (pendingToolboxTalks.length > 0) {
    const currentTalk = pendingToolboxTalks[currentToolboxTalkIndex];
    
    return (
      <BlockingMessageModal
        open={true}
        message={currentTalk}
        onSigned={handleToolboxTalkCompleted}
        onDeferred={handleToolboxTalkCompleted}
        totalPending={pendingToolboxTalks.length}
        currentIndex={currentToolboxTalkIndex}
      />
    );
  }

  const canCheckBiometrics =
    isDashboardPath &&
    !authLoading &&
    Boolean(profile?.id) &&
    pendingToolboxTalks.length === 0;

  return (
    <>
      <BiometricEnrollmentPrompt
        profileId={profile?.id}
        canCheck={canCheckBiometrics}
        onOpenChange={setBiometricPromptOpen}
        onCheckComplete={() => setBiometricCheckComplete(true)}
      />
      {showReminder && pendingReminders.length > 0 ? (
        <ReminderModal
          open={true}
          onClose={() => setShowReminder(false)}
          message={pendingReminders[0]}
          onDismissed={handleReminderDismissed}
        />
      ) : null}
    </>
  );
}

