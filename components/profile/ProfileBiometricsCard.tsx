'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import { Fingerprint } from 'lucide-react';
import { toast } from 'sonner';
import {
  canUsePlatformAuthenticator,
  clearLocalBiometricLoginProfile,
  markLocalBiometricLoginEnabled,
  startBiometricRegistration,
} from '@/lib/webauthn/client';
import {
  getOrCreateWebAuthnDeviceId,
  getWebAuthnDeviceLabel,
} from '@/lib/webauthn/device';
import { useAuth } from '@/lib/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PanelLoader } from '@/components/ui/panel-loader';

interface WebAuthnOptionsResponse {
  challenge?: string;
  error?: string;
  [key: string]: unknown;
}

interface WebAuthnStatusResponse {
  credentials_configured?: boolean;
  credential_count?: number;
  prompt_dismissed?: boolean;
  error?: string;
}

export function ProfileBiometricsCard() {
  const { profile } = useAuth();
  const [deviceId] = useState(() => getOrCreateWebAuthnDeviceId());
  const [deviceLabel] = useState(() => getWebAuthnDeviceLabel());
  const [status, setStatus] = useState<WebAuthnStatusResponse | null>(null);
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  const loadStatus = useCallback(async () => {
    if (!deviceId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [isSupported, statusResponse] = await Promise.all([
        canUsePlatformAuthenticator(),
        fetch(`/api/auth/webauthn/status?deviceId=${encodeURIComponent(deviceId)}`, {
          cache: 'no-store',
        }),
      ]);
      const payload = (await statusResponse.json().catch(() => ({}))) as WebAuthnStatusResponse;

      if (!statusResponse.ok) {
        throw new Error(payload.error || 'Failed to load biometric status');
      }

      setBiometricSupported(isSupported);
      setStatus(payload);

      if (profile?.id) {
        if (payload.credentials_configured) {
          markLocalBiometricLoginEnabled(profile.id);
        } else {
          clearLocalBiometricLoginProfile(profile.id);
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load biometric status');
      setBiometricSupported(false);
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [deviceId, profile?.id]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  async function getRegistrationOptions(): Promise<
    PublicKeyCredentialCreationOptionsJSON & WebAuthnOptionsResponse
  > {
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

  async function handleEnableBiometrics() {
    if (!profile?.id) return;

    setWorking(true);
    try {
      const options = await getRegistrationOptions();
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
          deviceLabel,
        }),
      });
      const payload = (await verifyResponse.json().catch(() => ({}))) as { error?: string };
      if (!verifyResponse.ok) {
        throw new Error(payload.error || 'Unable to enable biometric login');
      }

      markLocalBiometricLoginEnabled(profile.id);
      toast.success('Biometric login enabled on this device');
      await loadStatus();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to enable biometric login');
    } finally {
      setWorking(false);
    }
  }

  async function handleRemoveBiometrics() {
    if (!profile?.id) return;

    setWorking(true);
    try {
      const response = await fetch('/api/auth/webauthn/revoke-device', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ deviceId }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to remove biometric login');
      }

      clearLocalBiometricLoginProfile(profile.id);
      toast.success('Biometric login removed from this device');
      await loadStatus();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to remove biometric login');
    } finally {
      setWorking(false);
    }
  }

  const isConfigured = status?.credentials_configured === true;
  const canEnable = Boolean(profile?.id) && biometricSupported && !isConfigured && !loading;
  const canRemove = Boolean(profile?.id) && isConfigured && !loading;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-brand-yellow/15 p-3 text-brand-yellow sm:p-2">
            <Fingerprint className="h-6 w-6 sm:h-5 sm:w-5" />
          </div>
          <div>
            <CardTitle>Biometrics</CardTitle>
            <CardDescription className="text-base sm:text-sm">
              Check or update biometric login for this browser and device.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <PanelLoader message="Checking biometric status..." className="py-6" />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-border bg-slate-900/30 p-4 sm:rounded-md sm:p-3">
              <p className="text-sm uppercase tracking-wide text-muted-foreground sm:text-xs">Device</p>
              <p className="mt-1 text-base font-medium text-foreground sm:text-sm">{deviceLabel}</p>
            </div>
            <div className="rounded-lg border border-border bg-slate-900/30 p-4 sm:rounded-md sm:p-3">
              <p className="text-sm uppercase tracking-wide text-muted-foreground sm:text-xs">Browser support</p>
              <p className="mt-1 text-base font-medium text-foreground sm:text-sm">
                {biometricSupported ? 'Supported' : 'Not available'}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-slate-900/30 p-4 sm:rounded-md sm:p-3">
              <p className="text-sm uppercase tracking-wide text-muted-foreground sm:text-xs">Login credential</p>
              <p className="mt-1 text-base font-medium text-foreground sm:text-sm">
                {isConfigured ? 'Enabled on this device' : 'Not configured'}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-slate-900/30 p-4 sm:rounded-md sm:p-3">
              <p className="text-sm uppercase tracking-wide text-muted-foreground sm:text-xs">Saved credentials</p>
              <p className="mt-1 text-base font-medium text-foreground sm:text-sm">
                {status?.credential_count ?? 0} active on this device
              </p>
            </div>
          </div>
        )}

        <p className="text-sm text-muted-foreground sm:text-xs">
          Biometric login uses this device&apos;s platform authenticator, such as Windows Hello,
          Touch ID, or Face ID. Removing it only revokes this browser/device credential.
        </p>

        <div className="grid gap-2 sm:flex sm:flex-wrap">
          <Button
            type="button"
            onClick={() => void handleEnableBiometrics()}
            disabled={!canEnable || working}
            className="h-14 bg-brand-yellow text-base font-semibold text-slate-900 hover:bg-[#d1b82f] disabled:opacity-60 sm:h-9 sm:text-sm"
          >
            {working && !isConfigured ? 'Setting up...' : isConfigured ? 'Enabled' : 'Enable biometrics'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleRemoveBiometrics()}
            disabled={!canRemove || working}
            className="h-14 border-red-500/50 bg-red-500/80 text-base font-semibold text-white hover:bg-red-500 sm:h-9 sm:text-sm"
          >
            {working && isConfigured ? 'Removing...' : 'Remove biometrics'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
