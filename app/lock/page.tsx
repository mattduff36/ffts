'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { Delete, Lock, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { broadcastAuthStateChange, clearLegacyAccountSwitchClientState } from '@/lib/app-auth/client';
import { useAuth } from '@/lib/hooks/useAuth';
import { isAccountSwitcherEnabled } from '@/lib/account-switch/feature-flag';
import { invalidateCachedDataToken } from '@/lib/supabase/client';
import {
  getAccountSwitchDeviceLabel,
  getOrCreateAccountSwitchDeviceId,
} from '@/lib/account-switch/device';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type LockPageMode = 'checking' | 'set-pin-enter' | 'set-pin-confirm' | 'locked';

interface AccountSwitchSettingsResponse {
  code?: string;
  settings?: {
    pin_configured?: boolean;
  };
  error?: string;
  details?: {
    pin_locked_until?: string | null;
  };
}

interface DeviceProfileSummary {
  profile_id: string;
  full_name: string | null;
  role_name: string | null;
  avatar_url?: string | null;
  email?: string | null;
}

interface DeviceProfilesResponse {
  profiles?: DeviceProfileSummary[];
  error?: string;
}

const PIN_LENGTH = 4;
const PIN_KEYPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
const PIN_KEY_INTERACTION_CLASS =
  'transition-colors duration-200 ease-out';
const PIN_KEY_FLASH_CLASS = 'bg-brand-yellow text-slate-950';
const PIN_KEY_BUTTON_CLASS =
  `h-auto w-full aspect-[2/1] rounded-xl text-lg font-semibold bg-slate-950 text-white hover:bg-slate-900 sm:text-xl ${PIN_KEY_INTERACTION_CLASS}`;
const PIN_ACTION_BUTTON_CLASS =
  `h-auto w-full aspect-[2/1] rounded-xl text-sm sm:text-base ${PIN_KEY_INTERACTION_CLASS}`;

function getInitials(name: string | null | undefined): string {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export default function LockPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profile, loading: authLoading, locked } = useAuth();
  const [deviceId] = useState(() => getOrCreateAccountSwitchDeviceId());
  const [mode, setMode] = useState<LockPageMode>('checking');
  const [profiles, setProfiles] = useState<DeviceProfileSummary[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [pinEntry, setPinEntry] = useState('');
  const [pendingPin, setPendingPin] = useState('');
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [loadingState, setLoadingState] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [pinLockedUntil, setPinLockedUntil] = useState<string | null>(null);
  const [activePinKey, setActivePinKey] = useState<string | null>(null);
  const activePinKeyTimeoutRef = useRef<number | null>(null);
  const isFeatureEnabled = useMemo(() => isAccountSwitcherEnabled(), []);

  const currentProfileId = profile?.id || null;
  const forcePinSetup = useMemo(() => searchParams?.get('setupPin') === '1', [searchParams]);
  const returnTo = useMemo(() => {
    const candidate = searchParams?.get('returnTo') || '/dashboard';
    if (!candidate.startsWith('/') || candidate.startsWith('/lock')) {
      return '/dashboard';
    }
    return candidate;
  }, [searchParams]);

  const selectedProfile = useMemo(
    () => profiles.find((item) => item.profile_id === selectedProfileId) || null,
    [profiles, selectedProfileId]
  );

  const keypadDisabled = loadingState || submitting;

  const reloadProfiles = useCallback(async (): Promise<void> => {
    const response = await fetch(
      `/api/account-switch/device-profiles?deviceId=${encodeURIComponent(deviceId)}`,
      { cache: 'no-store' }
    );
    const payload = (await response.json()) as DeviceProfilesResponse;
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to load device profiles');
    }
    setProfiles(payload.profiles || []);
  }, [deviceId]);

  useEffect(() => {
    if (authLoading) return;

    if (!isFeatureEnabled) {
      router.replace('/dashboard');
      return;
    }

    if (!currentProfileId) {
      router.replace('/login');
      return;
    }

    clearLegacyAccountSwitchClientState();
    setLoadingState(true);
    setMode('checking');
    setPinModalOpen(false);
    setSelectedProfileId(null);
    setPinEntry('');
    setPendingPin('');
    setPinLockedUntil(null);

    void (async () => {
      try {
        await fetch('/api/account-switch/device/register', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            deviceId,
            deviceLabel: getAccountSwitchDeviceLabel(),
          }),
        });

        const settingsResponse = await fetch(
          `/api/account-switch/settings?deviceId=${encodeURIComponent(deviceId)}`,
          { cache: 'no-store' }
        );
        const settingsPayload = (await settingsResponse.json()) as AccountSwitchSettingsResponse;
        if (!settingsResponse.ok) {
          throw new Error(settingsPayload.error || 'Failed to load account switch settings');
        }

        await reloadProfiles();

        if (settingsPayload.settings?.pin_configured) {
          setMode('locked');
          if (forcePinSetup && currentProfileId) {
            setSelectedProfileId(currentProfileId);
            setPinModalOpen(true);
          }
        } else {
          setMode('set-pin-enter');
          setSelectedProfileId(currentProfileId);
          setPinModalOpen(true);
          toast.info('Set a 4-digit PIN before using the lock screen on this device.');
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to load lock screen');
      } finally {
        setLoadingState(false);
      }
    })();
  }, [authLoading, currentProfileId, deviceId, forcePinSetup, isFeatureEnabled, reloadProfiles, router]);

  useEffect(() => {
    if (!pinModalOpen) return;
    if (pinEntry.length !== PIN_LENGTH) return;
    if (submitting || loadingState) return;

    void (async () => {
      if (mode === 'set-pin-enter') {
        setPendingPin(pinEntry);
        setPinEntry('');
        setMode('set-pin-confirm');
        return;
      }

      if (mode === 'set-pin-confirm') {
        if (pinEntry !== pendingPin) {
          toast.error('PIN confirmation does not match. Try again.');
          setPendingPin('');
          setPinEntry('');
          setMode('set-pin-enter');
          return;
        }

        setSubmitting(true);
        try {
          const setupResponse = await fetch('/api/account-switch/pin/setup', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              pin: pinEntry,
              enableQuickSwitch: true,
              deviceId,
              deviceLabel: getAccountSwitchDeviceLabel(),
            }),
          });
          const setupPayload = (await setupResponse.json()) as { error?: string };
          if (!setupResponse.ok) {
            throw new Error(setupPayload.error || 'Failed to set PIN');
          }

          if (!locked) {
            const lockResponse = await fetch('/api/auth/lock', {
              method: 'POST',
            });
            const lockPayload = (await lockResponse.json().catch(() => ({}))) as { error?: string };
            if (!lockResponse.ok) {
              throw new Error(lockPayload.error || 'Failed to lock account');
            }
            invalidateCachedDataToken();
            broadcastAuthStateChange('locked');
          }

          await reloadProfiles();
          setMode('locked');
          setPinModalOpen(false);
          setPinEntry('');
          setPendingPin('');
          setSelectedProfileId(null);
          toast.success('PIN set. Select a profile to unlock.');
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Failed to configure PIN');
          setPinEntry('');
          setPendingPin('');
          setMode('set-pin-enter');
        } finally {
          setSubmitting(false);
        }
        return;
      }

      if (!selectedProfileId) {
        setPinEntry('');
        return;
      }

      setSubmitting(true);
      try {
        const unlockResponse = await fetch('/api/account-switch/unlock', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            targetProfileId: selectedProfileId,
            pin: pinEntry,
            deviceId,
          }),
        });
        const unlockPayload = (await unlockResponse.json()) as AccountSwitchSettingsResponse;
        if (!unlockResponse.ok) {
          if (unlockPayload.code === 'PIN_LOCKED') {
            setPinLockedUntil(unlockPayload.details?.pin_locked_until || null);
          }
          throw new Error(unlockPayload.error || 'Incorrect PIN');
        }

        invalidateCachedDataToken();
        broadcastAuthStateChange('pin_unlock');
        window.location.replace(selectedProfileId === currentProfileId ? returnTo : '/dashboard');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to unlock account');
        setPinEntry('');
      } finally {
        setSubmitting(false);
      }
    })();
  }, [currentProfileId, deviceId, loadingState, locked, mode, pendingPin, pinEntry, pinModalOpen, reloadProfiles, returnTo, selectedProfileId, submitting]);

  const handleDigitPress = useCallback((digit: string): void => {
    if (keypadDisabled) return;
    setPinEntry((currentValue) => {
      if (currentValue.length >= PIN_LENGTH) {
        return currentValue;
      }
      return `${currentValue}${digit}`;
    });
  }, [keypadDisabled]);

  const handleBackspace = useCallback((): void => {
    if (keypadDisabled) return;
    setPinEntry((currentValue) => currentValue.slice(0, -1));
  }, [keypadDisabled]);

  const handleClear = useCallback((): void => {
    if (keypadDisabled) return;
    setPinEntry('');
  }, [keypadDisabled]);

  const flashPinKey = useCallback((keyId: string): void => {
    setActivePinKey(keyId);
    if (activePinKeyTimeoutRef.current) {
      window.clearTimeout(activePinKeyTimeoutRef.current);
    }
    activePinKeyTimeoutRef.current = window.setTimeout(() => {
      setActivePinKey(null);
      activePinKeyTimeoutRef.current = null;
    }, 180);
  }, []);

  const handleDigitButtonPress = useCallback((digit: string): void => {
    flashPinKey(`digit-${digit}`);
    handleDigitPress(digit);
  }, [flashPinKey, handleDigitPress]);

  const handleClearButtonPress = useCallback((): void => {
    flashPinKey('clear');
    handleClear();
  }, [flashPinKey, handleClear]);

  const handleBackspaceButtonPress = useCallback((): void => {
    flashPinKey('backspace');
    handleBackspace();
  }, [flashPinKey, handleBackspace]);

  const getPinButtonClassName = useCallback((baseClassName: string, keyId: string): string => {
    return activePinKey === keyId ? `${baseClassName} ${PIN_KEY_FLASH_CLASS}` : baseClassName;
  }, [activePinKey]);

  function openProfile(profileId: string): void {
    setSelectedProfileId(profileId);
    setPinEntry('');
    setPendingPin('');
    setPinLockedUntil(null);
    setPinModalOpen(true);
  }

  function handleSignInAsAnotherUser(): void {
    router.push('/login');
  }

  useEffect(() => {
    if (!pinModalOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }

      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        handleDigitButtonPress(event.key);
        return;
      }

      if (event.key === 'Backspace') {
        event.preventDefault();
        handleBackspaceButtonPress();
        return;
      }

      if (event.key === 'Delete') {
        event.preventDefault();
        handleClearButtonPress();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleBackspaceButtonPress, handleClearButtonPress, handleDigitButtonPress, pinModalOpen]);

  useEffect(() => {
    return () => {
      if (activePinKeyTimeoutRef.current) {
        window.clearTimeout(activePinKeyTimeoutRef.current);
      }
    };
  }, []);

  if (mode === 'checking' || loadingState) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#060913] text-white">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:56px_56px]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(241,214,74,0.08),transparent_30%),radial-gradient(circle_at_bottom,rgba(59,130,246,0.08),transparent_28%)]" />

      <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
        <div className="w-full max-w-5xl space-y-10">
          <div className="text-center space-y-4">
            <div className="inline-flex items-center justify-center rounded-3xl bg-brand-yellow p-5 shadow-[0_20px_60px_rgba(241,214,74,0.18)]">
              <Lock className="h-10 w-10 text-slate-950" strokeWidth={2.5} />
            </div>
            <div className="space-y-2">
              <h1 className="text-5xl font-black tracking-tight text-white sm:text-6xl">
                TEMPLATEAPP
              </h1>
              <p className="text-base text-slate-300 sm:text-xl">
                Select a profile and enter your PIN to continue.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-start justify-center gap-4 sm:gap-6">
            {profiles.map((deviceProfile) => (
              <button
                key={deviceProfile.profile_id}
                type="button"
                onClick={() => openProfile(deviceProfile.profile_id)}
                className={`w-28 sm:w-36 text-center transition-transform duration-200 hover:-translate-y-1 ${
                  submitting ? 'pointer-events-none opacity-70' : ''
                }`}
              >
                <div className="flex aspect-square items-center justify-center rounded-2xl border border-slate-700/70 bg-[#151935] shadow-lg transition-colors hover:border-slate-500">
                  {deviceProfile.avatar_url ? (
                    <div className="relative h-full w-full overflow-hidden rounded-2xl">
                      <Image
                        src={deviceProfile.avatar_url}
                        alt={deviceProfile.full_name || 'Profile avatar'}
                        fill
                        sizes="(max-width: 640px) 112px, 144px"
                        className="object-contain"
                      />
                    </div>
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 text-2xl font-semibold text-white">
                      {getInitials(deviceProfile.full_name)}
                    </div>
                  )}
                </div>
                <p className="mt-2 text-sm font-semibold tracking-tight text-white truncate">
                  {deviceProfile.full_name || 'Account'}
                </p>
              </button>
            ))}

            <button
              type="button"
              onClick={handleSignInAsAnotherUser}
              className="w-28 sm:w-36 text-center transition-transform duration-200 hover:-translate-y-1"
            >
              <div className="flex aspect-square items-center justify-center rounded-2xl border border-slate-700/70 bg-[#151935] shadow-lg transition-colors hover:border-slate-500">
                <Plus className="h-7 w-7 text-slate-200" strokeWidth={1.6} />
              </div>
              <p className="mt-2 text-sm font-semibold tracking-tight text-white">
                Sign in as another user
              </p>
            </button>
          </div>
        </div>
      </div>

      <Dialog
        open={pinModalOpen}
        onOpenChange={(open) => {
          if (mode !== 'locked') {
            setPinModalOpen(true);
            return;
          }
          if (!submitting) {
            setPinModalOpen(open);
            if (!open) {
              setSelectedProfileId(null);
              setPinEntry('');
            }
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {mode === 'set-pin-enter' && 'Create Device PIN'}
              {mode === 'set-pin-confirm' && 'Confirm Device PIN'}
              {mode === 'locked' && `Unlock ${selectedProfile?.full_name || 'Account'}`}
            </DialogTitle>
            <DialogDescription>
              {mode === 'set-pin-enter' && 'Enter a 4-digit PIN for this device.'}
              {mode === 'set-pin-confirm' && 'Re-enter the PIN to confirm it.'}
              {mode === 'locked' && 'Enter the 4-digit PIN for the selected profile.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center justify-center gap-2">
              {Array.from({ length: PIN_LENGTH }).map((_, index) => (
                <div
                  key={index}
                  className={`h-3 w-3 rounded-full ${
                    index < pinEntry.length ? 'bg-brand-yellow' : 'bg-slate-600'
                  }`}
                />
              ))}
            </div>

            {pinLockedUntil ? (
              <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">
                PIN locked until {new Date(pinLockedUntil).toLocaleTimeString()}.
              </div>
            ) : null}

            <div className="grid grid-cols-3 gap-3">
              {PIN_KEYPAD_KEYS.map((digit) => (
                <Button
                  key={digit}
                  type="button"
                  className={getPinButtonClassName(PIN_KEY_BUTTON_CLASS, `digit-${digit}`)}
                  onClick={() => handleDigitButtonPress(digit)}
                  disabled={keypadDisabled}
                >
                  {digit}
                </Button>
              ))}
              <Button
                type="button"
                variant="secondary"
                className={getPinButtonClassName(PIN_ACTION_BUTTON_CLASS, 'clear')}
                onClick={handleClearButtonPress}
                disabled={keypadDisabled}
              >
                Clear
              </Button>
              <Button
                type="button"
                className={getPinButtonClassName(PIN_KEY_BUTTON_CLASS, 'digit-0')}
                onClick={() => handleDigitButtonPress('0')}
                disabled={keypadDisabled}
              >
                0
              </Button>
              <Button
                type="button"
                variant="secondary"
                className={getPinButtonClassName(PIN_ACTION_BUTTON_CLASS, 'backspace')}
                onClick={handleBackspaceButtonPress}
                disabled={keypadDisabled}
              >
                <Delete className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
