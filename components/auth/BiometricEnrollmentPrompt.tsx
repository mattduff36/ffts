'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import { Fingerprint } from 'lucide-react';
import { toast } from 'sonner';
import {
  canUsePlatformAuthenticator,
  markLocalBiometricLoginEnabled,
  startBiometricRegistration,
} from '@/lib/webauthn/client';
import {
  getOrCreateWebAuthnDeviceId,
  getWebAuthnDeviceLabel,
} from '@/lib/webauthn/device';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface WebAuthnOptionsResponse {
  challenge?: string;
  error?: string;
  [key: string]: unknown;
}

interface WebAuthnStatusResponse {
  credentials_configured?: boolean;
  prompt_dismissed?: boolean;
}

interface BiometricEnrollmentPromptProps {
  profileId: string | null | undefined;
  canCheck: boolean;
  onOpenChange?: (open: boolean) => void;
  onCheckComplete?: () => void;
}

export function BiometricEnrollmentPrompt({
  profileId,
  canCheck,
  onOpenChange,
  onCheckComplete,
}: BiometricEnrollmentPromptProps) {
  const [open, setOpen] = useState(false);
  const [setupWorking, setSetupWorking] = useState(false);
  const [dismissWorking, setDismissWorking] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);
  const working = setupWorking || dismissWorking;

  const setDialogOpen = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }, [onOpenChange]);

  useEffect(() => {
    setHasChecked(false);
    setOpen(false);
    onOpenChange?.(false);
  }, [onOpenChange, profileId]);

  useEffect(() => {
    if (!canCheck || !profileId || hasChecked) {
      if (canCheck && !profileId && !hasChecked) {
        setHasChecked(true);
        onCheckComplete?.();
      }
      return;
    }

    let mounted = true;
    const deviceId = getOrCreateWebAuthnDeviceId();

    void (async () => {
      const isSupported = await canUsePlatformAuthenticator();
      if (!mounted || !isSupported) return;

      const response = await fetch(
        `/api/auth/webauthn/status?deviceId=${encodeURIComponent(deviceId)}`,
        { cache: 'no-store' }
      );
      const payload = (await response.json().catch(() => ({}))) as WebAuthnStatusResponse;
      if (!mounted || !response.ok) return;

      if (payload.credentials_configured) {
        markLocalBiometricLoginEnabled(profileId);
        return;
      }

      if (!payload.prompt_dismissed) {
        setDialogOpen(true);
      }
    })()
      .catch(() => undefined)
      .finally(() => {
        if (mounted) {
          setHasChecked(true);
          onCheckComplete?.();
        }
      });

    return () => {
      mounted = false;
    };
  }, [canCheck, hasChecked, onCheckComplete, profileId, setDialogOpen]);

  async function getRegistrationOptions(deviceId: string) {
    const response = await fetch('/api/auth/webauthn/register/options', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ deviceId }),
    });
    const payload = (await response.json()) as WebAuthnOptionsResponse;
    if (!response.ok || !payload.challenge) {
      throw new Error(payload.error || 'Unable to start biometric setup');
    }
    return payload as PublicKeyCredentialCreationOptionsJSON & WebAuthnOptionsResponse;
  }

  async function handleEnable(): Promise<void> {
    if (!profileId) return;

    const deviceId = getOrCreateWebAuthnDeviceId();
    setSetupWorking(true);
    try {
      const options = await getRegistrationOptions(deviceId);
      const registrationResponse = await startBiometricRegistration(options);
      const verifyResponse = await fetch('/api/auth/webauthn/register/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          response: registrationResponse,
          challenge: options.challenge,
          deviceId,
          deviceLabel: getWebAuthnDeviceLabel(),
        }),
      });
      const payload = (await verifyResponse.json().catch(() => ({}))) as { error?: string };
      if (!verifyResponse.ok) {
        throw new Error(payload.error || 'Unable to enable biometric login');
      }

      markLocalBiometricLoginEnabled(profileId);
      toast.success('Biometric login enabled on this device');
      setDialogOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to enable biometric login');
    } finally {
      setSetupWorking(false);
    }
  }

  async function handleDismiss(): Promise<void> {
    const deviceId = getOrCreateWebAuthnDeviceId();
    setDismissWorking(true);
    try {
      await fetch('/api/auth/webauthn/prompt/dismiss', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ deviceId }),
      });
      setDialogOpen(false);
    } finally {
      setDismissWorking(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setDialogOpen(true);
          return;
        }
        if (!working) void handleDismiss();
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto border-border p-7 text-white sm:p-9">
        <DialogHeader className="space-y-5 text-left">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-yellow text-slate-950">
            <Fingerprint className="h-9 w-9" />
          </div>
          <DialogTitle className="text-3xl font-bold leading-tight sm:text-4xl">
            Enable Biometric Login?
          </DialogTitle>
          <DialogDescription className="text-lg leading-relaxed text-slate-200 sm:text-xl">
            This device supports biometric login. Enable it now to sign in faster next time with
            Face ID, Touch ID, Windows Hello, or this device&apos;s built-in biometric check.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-4 flex-col gap-3 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            className="min-h-14 text-lg"
            disabled={working}
            onClick={() => void handleDismiss()}
          >
            Not now
          </Button>
          <Button
            type="button"
            className="min-h-14 bg-brand-yellow px-6 text-lg font-semibold text-slate-950 hover:bg-brand-yellow-hover"
            disabled={working}
            onClick={() => void handleEnable()}
          >
            {setupWorking ? 'Setting up...' : 'Enable biometric login'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
