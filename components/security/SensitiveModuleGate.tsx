'use client';

import { type Ref, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Delete, LockKeyhole, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { SensitiveAccessModuleName } from '@/types/roles';

const SENSITIVE_ACCESS_HEARTBEAT_MS = 5 * 60 * 1000;
const SENSITIVE_ACCESS_IDLE_WARNING_MS = 10 * 60 * 1000;
const ACTIVITY_EVENT_NAMES = ['pointerdown', 'keydown', 'input', 'wheel'] as const;
const NATIVE_KEYBOARD_DETECTION_MS = 750;
const NATIVE_KEYBOARD_MIN_VIEWPORT_SHRINK_PX = 120;

type PinEntryTarget = 'unlock' | 'setup' | 'confirm' | 'verification';

function focusWithoutScroll(input: HTMLInputElement) {
  try {
    input.focus({ preventScroll: true });
  } catch {
    input.focus();
  }
}

function getVisualViewportHeight() {
  return typeof window !== 'undefined' ? window.visualViewport?.height ?? null : null;
}

function isTouchMobileDevice() {
  if (typeof window === 'undefined') return false;

  const hasTouchPoints = window.navigator.maxTouchPoints > 0;
  const hasTouchEvent = 'ontouchstart' in window;
  const coarsePointer = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const mobileWidth = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1024px)').matches;

  return (hasTouchPoints || hasTouchEvent || coarsePointer) && (coarsePointer || mobileWidth);
}

interface SensitivePinStatus {
  configured: boolean;
  pin_length: 4 | 6 | null;
  must_reset: boolean;
  locked_until: string | null;
}

interface SensitiveModuleState {
  module_name: SensitiveAccessModuleName;
  required: boolean;
  unlocked: boolean;
  expires_at: string | null;
  pin_status: SensitivePinStatus;
}

export interface SensitiveModuleAccessState {
  loading: boolean;
  state: SensitiveModuleState | null;
  canAccess: boolean;
  refresh: () => Promise<void>;
  unlock: (pin: string) => Promise<boolean>;
  renew: () => Promise<boolean>;
}

export function useSensitiveModuleAccess(
  moduleName: SensitiveAccessModuleName,
  options?: { enabled?: boolean }
): SensitiveModuleAccessState {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<SensitiveModuleState | null>(null);
  const enabled = options?.enabled ?? true;

  const refresh = useCallback(async () => {
    if (!enabled) {
      setState(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/sensitive-access/status?module=${encodeURIComponent(moduleName)}`, {
        cache: 'no-store',
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to check sensitive access');
      }
      setState(payload.state);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to check sensitive access');
      setState(null);
    } finally {
      setLoading(false);
    }
  }, [enabled, moduleName]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const unlock = useCallback(async (pin: string) => {
    try {
      const response = await fetch('/api/sensitive-access/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ module: moduleName, pin }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to unlock module');
      }
      setState(payload.state);
      toast.success('Sensitive module unlocked');
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to unlock module');
      await refresh();
      return false;
    }
  }, [moduleName, refresh]);

  const renew = useCallback(async () => {
    try {
      const response = await fetch('/api/sensitive-access/renew', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ module: moduleName }),
      });
      const payload = await response.json().catch(() => null) as { state?: SensitiveModuleState } | null;
      if (!response.ok) {
        if (response.status === 428) {
          setState((current) => current ? { ...current, unlocked: false, expires_at: null } : current);
        }
        return false;
      }
      if (payload?.state) {
        setState(payload.state);
      }
      return true;
    } catch {
      return false;
    }
  }, [moduleName]);

  return {
    loading,
    state,
    canAccess: Boolean(state && (!state.required || state.unlocked)),
    refresh,
    unlock,
    renew,
  };
}

export function SensitiveModuleSessionManager({
  moduleLabel,
  access,
  initialLastActivityAt,
  initialWarningOpen = false,
}: {
  moduleLabel: string;
  access: SensitiveModuleAccessState;
  initialLastActivityAt?: number;
  initialWarningOpen?: boolean;
}) {
  const router = useRouter();
  const { canAccess, renew, state } = access;
  const lastActivityAtRef = useRef(initialLastActivityAt ?? Date.now());
  const warningOpenRef = useRef(initialWarningOpen);
  const heartbeatRunningRef = useRef(false);
  const [warningOpen, setWarningOpen] = useState(initialWarningOpen);
  const [confirming, setConfirming] = useState(false);
  const moduleName = state?.module_name;
  const canManageSession = canAccess && state?.required === true && Boolean(state.expires_at);

  const runHeartbeat = useCallback(async () => {
    if (!canManageSession) return;
    if (heartbeatRunningRef.current) return;

    heartbeatRunningRef.current = true;
    try {
      if (warningOpenRef.current) {
        router.push('/dashboard');
        return;
      }

      const idleFor = Date.now() - lastActivityAtRef.current;
      if (idleFor <= SENSITIVE_ACCESS_HEARTBEAT_MS) {
        const renewed = await renew();
        if (!renewed) {
          router.push('/dashboard');
        }
        return;
      }

      if (idleFor >= SENSITIVE_ACCESS_IDLE_WARNING_MS) {
        warningOpenRef.current = true;
        setWarningOpen(true);
      }
    } finally {
      heartbeatRunningRef.current = false;
    }
  }, [canManageSession, renew, router]);

  const confirmStillActive = useCallback(async () => {
    setConfirming(true);
    lastActivityAtRef.current = Date.now();
    warningOpenRef.current = false;
    setWarningOpen(false);

    try {
      const renewed = await renew();
      if (!renewed) {
        router.push('/dashboard');
      }
    } finally {
      setConfirming(false);
    }
  }, [renew, router]);

  useEffect(() => {
    if (!canManageSession) return;

    lastActivityAtRef.current = initialLastActivityAt ?? Date.now();
    warningOpenRef.current = initialWarningOpen;
    setWarningOpen(initialWarningOpen);

    const recordActivity = (event?: Event) => {
      if (event && event.isTrusted === false) return;
      if (!warningOpenRef.current) {
        lastActivityAtRef.current = Date.now();
      }
    };
    const recordVisibleActivity = (event?: Event) => {
      if (document.visibilityState === 'visible') {
        recordActivity(event);
      }
    };
    const listenerOptions = { capture: true, passive: true };

    ACTIVITY_EVENT_NAMES.forEach((eventName) => {
      document.addEventListener(eventName, recordActivity, listenerOptions);
    });
    document.addEventListener('visibilitychange', recordVisibleActivity, listenerOptions);

    let heartbeat: number | null = null;
    let cancelled = false;
    const scheduleHeartbeat = () => {
      heartbeat = window.setTimeout(() => {
        if (!cancelled) {
          scheduleHeartbeat();
        }
        void runHeartbeat();
      }, SENSITIVE_ACCESS_HEARTBEAT_MS);
    };

    scheduleHeartbeat();

    return () => {
      cancelled = true;
      if (heartbeat !== null) {
        window.clearTimeout(heartbeat);
      }
      ACTIVITY_EVENT_NAMES.forEach((eventName) => {
        document.removeEventListener(eventName, recordActivity, listenerOptions);
      });
      document.removeEventListener('visibilitychange', recordVisibleActivity, listenerOptions);
    };
  }, [canManageSession, initialLastActivityAt, initialWarningOpen, moduleName, runHeartbeat]);

  if (!canManageSession) return null;

  return (
    <AlertDialog open={warningOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you still using {moduleLabel}?</AlertDialogTitle>
          <AlertDialogDescription>
            Sensitive access is about to expire because there has been no recent activity on this page.
            Confirm you are still here to keep working without losing your current changes.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              void confirmStillActive();
            }}
            disabled={confirming}
            className="bg-brand-yellow text-slate-900 hover:bg-[#d1b82f] disabled:opacity-60"
          >
            {confirming ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Yes, I&apos;m still here
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function PinDigitEntry({
  id,
  label,
  value,
  length,
  onChange,
  inputRef,
  onActivate,
  describedBy,
  disabled = false,
  autoComplete = 'off',
  autoFocus = false,
  customEntryActive = false,
  visuallyActive = true,
}: {
  id: string;
  label: string;
  value: string;
  length: 4 | 6;
  onChange: (value: string) => void;
  inputRef: Ref<HTMLInputElement>;
  onActivate: () => void;
  describedBy?: string;
  disabled?: boolean;
  autoComplete?: string;
  autoFocus?: boolean;
  customEntryActive?: boolean;
  visuallyActive?: boolean;
}) {
  const slots = Array.from({ length }, (_, index) => index);

  return (
    <div className="space-y-3">
      <Label htmlFor={id} className="sr-only">
        {label}
      </Label>
      <div
        className="relative mx-auto w-fit"
        onClick={() => {
          if (!disabled) {
            onActivate();
          }
        }}
      >
        <Input
          ref={inputRef}
          id={id}
          type="tel"
          inputMode={customEntryActive ? 'none' : 'numeric'}
          pattern="[0-9]*"
          autoComplete={autoComplete}
          autoFocus={!customEntryActive && autoFocus}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          readOnly={customEntryActive}
          tabIndex={customEntryActive ? -1 : undefined}
          aria-label={label}
          aria-describedby={describedBy}
          aria-readonly={customEntryActive}
          className={`absolute inset-0 z-10 h-full w-full border-0 bg-transparent p-0 text-transparent caret-transparent opacity-0 ${
            customEntryActive ? 'pointer-events-none cursor-default' : 'cursor-text'
          }`}
        />
        <div
          className={`grid gap-2 sm:gap-3 ${length === 4 ? 'grid-cols-4' : 'grid-cols-6'}`}
          aria-hidden="true"
        >
          {slots.map((slot) => {
            const filled = value.length > slot;
            const active = visuallyActive && value.length === slot && !disabled;

            return (
              <div
                key={slot}
                className={`flex h-12 w-10 items-center justify-center rounded-xl border text-lg font-semibold shadow-inner transition-all sm:h-16 sm:w-14 sm:rounded-2xl sm:text-xl ${
                  filled
                    ? 'border-brand-yellow/70 bg-brand-yellow/15 text-white shadow-brand-yellow/10'
                    : active
                      ? 'border-brand-yellow bg-slate-900/90 ring-4 ring-brand-yellow/10'
                      : 'border-slate-600/70 bg-slate-900/70 text-slate-500'
                }`}
              >
                {filled ? '*' : ''}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SensitiveNumericKeypad({
  value,
  disabled,
  onDigit,
  onBackspace,
  onConfirm,
  confirmDisabled = false,
}: {
  value: string;
  disabled?: boolean;
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onConfirm?: () => void;
  confirmDisabled?: boolean;
}) {
  const keys = [
    { digit: '1', letters: '' },
    { digit: '2', letters: 'ABC' },
    { digit: '3', letters: 'DEF' },
    { digit: '4', letters: 'GHI' },
    { digit: '5', letters: 'JKL' },
    { digit: '6', letters: 'MNO' },
    { digit: '7', letters: 'PQRS' },
    { digit: '8', letters: 'TUV' },
    { digit: '9', letters: 'WXYZ' },
  ];
  const keyClassName =
    'flex min-h-14 flex-col items-center justify-center rounded-xl bg-slate-200/85 text-slate-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_1px_8px_rgba(0,0,0,0.2)] transition active:scale-[0.98] active:bg-white disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-16 sm:rounded-2xl';

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[80] mx-auto max-w-[680px] rounded-t-[2rem] border border-white/10 bg-slate-950/85 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-3 shadow-[0_-20px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl sm:px-6"
      role="group"
      aria-label="Custom numeric PIN keypad"
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="mx-auto mb-3 h-1 w-12 rounded-full bg-white/20" aria-hidden="true" />
      <div className="mx-auto grid max-w-[560px] grid-cols-3 gap-2.5 sm:gap-3">
        {keys.map((key) => (
          <button
            key={key.digit}
            type="button"
            className={keyClassName}
            onClick={() => onDigit(key.digit)}
            disabled={disabled}
            aria-label={`Enter ${key.digit}`}
          >
            <span className="text-2xl font-semibold leading-none sm:text-3xl">{key.digit}</span>
            {key.letters ? (
              <span className="mt-1 text-[0.6rem] font-bold tracking-[0.22em] text-slate-700">{key.letters}</span>
            ) : (
              <span className="mt-1 text-[0.6rem]" aria-hidden="true">&nbsp;</span>
            )}
          </button>
        ))}
        {onConfirm ? (
          <button
            type="button"
            className={`${keyClassName} bg-brand-yellow/90`}
            onClick={onConfirm}
            disabled={disabled || confirmDisabled}
            aria-label="Confirm PIN"
          >
            <Check className="h-7 w-7" />
          </button>
        ) : (
          <div aria-hidden="true" />
        )}
        <button
          type="button"
          className={keyClassName}
          onClick={() => onDigit('0')}
          disabled={disabled}
          aria-label="Enter 0"
        >
          <span className="text-2xl font-semibold leading-none sm:text-3xl">0</span>
          <span className="mt-1 text-[0.6rem]" aria-hidden="true">&nbsp;</span>
        </button>
        <button
          type="button"
          className="flex min-h-14 items-center justify-center rounded-xl text-slate-100 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-16 sm:rounded-2xl"
          onClick={onBackspace}
          disabled={disabled || value.length === 0}
          aria-label="Delete last digit"
        >
          <Delete className="h-8 w-8" />
        </button>
      </div>
    </div>
  );
}

export function SensitiveModuleGate({
  moduleLabel,
  access,
}: {
  moduleLabel: string;
  access: SensitiveModuleAccessState;
}) {
  const [pin, setPin] = useState('');
  const [setupPin, setSetupPin] = useState('');
  const [confirmSetupPin, setConfirmSetupPin] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [setupEmail, setSetupEmail] = useState('');
  const [setupPending, setSetupPending] = useState(false);
  const [setupPinLength, setSetupPinLength] = useState<4 | 6>(4);
  const [working, setWorking] = useState(false);
  const [activePinTarget, setActivePinTarget] = useState<PinEntryTarget | null>(null);
  const [customKeypadTarget, setCustomKeypadTarget] = useState<PinEntryTarget | null>(null);
  const pinInputRef = useRef<HTMLInputElement>(null);
  const setupPinInputRef = useRef<HTMLInputElement>(null);
  const confirmSetupPinInputRef = useRef<HTMLInputElement>(null);
  const verificationInputRef = useRef<HTMLInputElement>(null);
  const customKeypadTargetRef = useRef<PinEntryTarget | null>(null);
  const focusAttemptIdRef = useRef(0);
  const focusDetectionTimerRef = useRef<number | null>(null);
  const workingRef = useRef(false);
  const pinStatus = access.state?.pin_status;
  const setupRequired = !pinStatus?.configured || pinStatus.must_reset;
  const configuredPinLength = pinStatus?.pin_length === 4 || pinStatus?.pin_length === 6 ? pinStatus.pin_length : null;
  const pinEntryLength = configuredPinLength ?? 6;
  const pinCanUnlock = configuredPinLength ? pin.length === configuredPinLength : pin.length === 4 || pin.length === 6;
  const customKeypadVisible = customKeypadTarget !== null;

  useEffect(() => {
    customKeypadTargetRef.current = customKeypadTarget;
  }, [customKeypadTarget]);

  useEffect(() => {
    workingRef.current = working;
  }, [working]);

  const beginWorking = useCallback(() => {
    if (workingRef.current) return false;
    workingRef.current = true;
    setWorking(true);
    return true;
  }, []);

  const endWorking = useCallback(() => {
    workingRef.current = false;
    setWorking(false);
  }, []);

  const focusPinInput = useCallback((input: HTMLInputElement | null, target: PinEntryTarget) => {
    if (!input) return;

    setActivePinTarget(target);

    if (customKeypadTargetRef.current) {
      setCustomKeypadTarget(target);
      return;
    }

    if (!isTouchMobileDevice()) {
      focusWithoutScroll(input);
      setCustomKeypadTarget(null);
      return;
    }

    const attemptId = focusAttemptIdRef.current + 1;
    focusAttemptIdRef.current = attemptId;

    if (focusDetectionTimerRef.current !== null) {
      window.clearTimeout(focusDetectionTimerRef.current);
    }

    const startingViewportHeight = getVisualViewportHeight();
    focusWithoutScroll(input);

    focusDetectionTimerRef.current = window.setTimeout(() => {
      if (focusAttemptIdRef.current !== attemptId) return;

      const endingViewportHeight = getVisualViewportHeight();
      const nativeKeyboardLikelyOpen =
        startingViewportHeight !== null &&
        endingViewportHeight !== null &&
        startingViewportHeight - endingViewportHeight >= NATIVE_KEYBOARD_MIN_VIEWPORT_SHRINK_PX;

      if (nativeKeyboardLikelyOpen) {
        setCustomKeypadTarget(null);
        return;
      }

      input.blur();
      setActivePinTarget(target);
      setCustomKeypadTarget(target);
    }, NATIVE_KEYBOARD_DETECTION_MS);
  }, []);

  useEffect(() => {
    if (!setupRequired) {
      focusPinInput(pinInputRef.current, 'unlock');
      return;
    }

    if (setupPending) {
      focusPinInput(verificationInputRef.current, 'verification');
    } else {
      focusPinInput(setupPinInputRef.current, 'setup');
    }
  }, [focusPinInput, setupPending, setupRequired]);

  useEffect(() => {
    return () => {
      if (focusDetectionTimerRef.current !== null) {
        window.clearTimeout(focusDetectionTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const visualViewport = window.visualViewport;
    if (!visualViewport) return;

    let previousHeight = visualViewport.height;
    const handleViewportResize = () => {
      const nextHeight = visualViewport.height;
      if (
        isTouchMobileDevice() &&
        previousHeight - nextHeight >= NATIVE_KEYBOARD_MIN_VIEWPORT_SHRINK_PX
      ) {
        setCustomKeypadTarget(null);
      }
      previousHeight = nextHeight;
    };

    visualViewport.addEventListener('resize', handleViewportResize);
    return () => visualViewport.removeEventListener('resize', handleViewportResize);
  }, []);

  async function handleUnlock(candidatePin = pin) {
    const candidateCanUnlock = configuredPinLength
      ? candidatePin.length === configuredPinLength
      : candidatePin.length === 4 || candidatePin.length === 6;

    if (!candidateCanUnlock || !beginWorking()) return;

    let unlocked = false;
    try {
      unlocked = await access.unlock(candidatePin);
      setPin('');
      if (unlocked) {
        setCustomKeypadTarget(null);
        setActivePinTarget(null);
      }
    } finally {
      endWorking();
      if (!unlocked) {
        window.setTimeout(() => focusPinInput(pinInputRef.current, 'unlock'), 0);
      }
    }
  }

  function handlePinChange(nextValue: string) {
    const nextPin = nextValue.replace(/\D/g, '').slice(0, pinEntryLength);
    setPin(nextPin);

    if (configuredPinLength && nextPin.length === configuredPinLength && !workingRef.current) {
      void handleUnlock(nextPin);
    }
  }

  function handleSetupPinLengthChange(nextLength: 4 | 6) {
    setSetupPinLength(nextLength);
    setSetupPin((current) => current.slice(0, nextLength));
    setConfirmSetupPin('');
    window.setTimeout(() => focusPinInput(setupPinInputRef.current, 'setup'), 0);
  }

  function handleSetupPinChange(nextValue: string) {
    const nextPin = nextValue.replace(/\D/g, '').slice(0, setupPinLength);
    setSetupPin(nextPin);
    setConfirmSetupPin('');

    if (nextPin.length === setupPinLength) {
      window.setTimeout(() => focusPinInput(confirmSetupPinInputRef.current, 'confirm'), 0);
    }
  }

  function handleConfirmSetupPinChange(nextValue: string) {
    const nextPin = nextValue.replace(/\D/g, '').slice(0, setupPinLength);
    setConfirmSetupPin(nextPin);

    if (nextPin.length === setupPinLength && setupPin.length === setupPinLength && !workingRef.current) {
      void requestPinSetup(setupPin, nextPin);
    }
  }

  function handleVerificationCodeChange(nextValue: string) {
    const nextCode = nextValue.replace(/\D/g, '').slice(0, 6);
    setVerificationCode(nextCode);

    if (nextCode.length === 6 && !workingRef.current) {
      void confirmPinSetup(nextCode);
    }
  }

  async function requestPinSetup(candidateSetupPin = setupPin, candidateConfirmSetupPin = confirmSetupPin) {
    if (workingRef.current) return;

    if (candidateSetupPin.length !== setupPinLength || candidateConfirmSetupPin.length !== setupPinLength) {
      return;
    }

    if (candidateSetupPin !== candidateConfirmSetupPin) {
      toast.error('PINs do not match');
      setConfirmSetupPin('');
      window.setTimeout(() => focusPinInput(confirmSetupPinInputRef.current, 'confirm'), 0);
      return;
    }
    if (!/^\d{4}$|^\d{6}$/.test(candidateSetupPin)) {
      toast.error('PIN must be either 4 or 6 digits');
      return;
    }

    if (!beginWorking()) return;
    try {
      const response = await fetch('/api/me/sensitive-pin/setup/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: candidateSetupPin }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to set sensitive PIN');
      }

      if (payload.requiresVerification === false) {
        toast.success('Sensitive PIN set');
        const unlocked = await access.unlock(candidateSetupPin);
        if (unlocked) {
          setSetupPin('');
          setConfirmSetupPin('');
          setCustomKeypadTarget(null);
          setActivePinTarget(null);
        } else {
          await access.refresh();
        }
        return;
      }

      setSetupPending(true);
      setSetupEmail(payload.email || '');
      setVerificationCode('');
      toast.success('Verification code sent');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to set sensitive PIN');
    } finally {
      endWorking();
    }
  }

  async function confirmPinSetup(candidateCode = verificationCode) {
    if (candidateCode.length !== 6 || !beginWorking()) return;

    try {
      const response = await fetch('/api/me/sensitive-pin/setup/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: candidateCode }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to confirm verification code');
      }

      toast.success('Sensitive PIN set');
      const unlocked = await access.unlock(setupPin);
      if (unlocked) {
        setSetupPin('');
        setConfirmSetupPin('');
        setVerificationCode('');
        setSetupEmail('');
        setSetupPending(false);
        setCustomKeypadTarget(null);
        setActivePinTarget(null);
      } else {
        await access.refresh();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to confirm verification code');
    } finally {
      endWorking();
    }
  }

  const getTargetValue = (target: PinEntryTarget) => {
    switch (target) {
      case 'unlock':
        return pin;
      case 'setup':
        return setupPin;
      case 'confirm':
        return confirmSetupPin;
      case 'verification':
        return verificationCode;
    }
  };

  const updateTargetValue = (target: PinEntryTarget, nextValue: string) => {
    switch (target) {
      case 'unlock':
        handlePinChange(nextValue);
        return;
      case 'setup':
        handleSetupPinChange(nextValue);
        return;
      case 'confirm':
        handleConfirmSetupPinChange(nextValue);
        return;
      case 'verification':
        handleVerificationCodeChange(nextValue);
        return;
    }
  };

  const handleCustomKeypadDigit = (digit: string) => {
    if (!customKeypadTarget || workingRef.current) return;
    updateTargetValue(customKeypadTarget, `${getTargetValue(customKeypadTarget)}${digit}`);
  };

  const handleCustomKeypadBackspace = () => {
    if (!customKeypadTarget || workingRef.current) return;
    updateTargetValue(customKeypadTarget, getTargetValue(customKeypadTarget).slice(0, -1));
  };

  const customKeypadValue = customKeypadTarget ? getTargetValue(customKeypadTarget) : '';
  const customKeypadCanConfirmUnlock =
    customKeypadTarget === 'unlock' && !configuredPinLength && (pin.length === 4 || pin.length === 6);

  return (
    <>
    <div
      className={`flex min-h-[calc(100dvh_-_var(--top-nav-h,68px)_-_1rem)] items-start justify-center overflow-y-auto px-4 pt-4 transition-[padding] sm:min-h-[calc(100dvh-11rem)] ${
        customKeypadVisible
          ? 'pb-[calc(21rem+env(safe-area-inset-bottom,0px))] sm:items-start sm:pb-[calc(22rem+env(safe-area-inset-bottom,0px))] sm:pt-8'
          : 'pb-8 sm:items-center sm:py-8'
      }`}
    >
      <Card className="relative flex w-full max-w-[580px] overflow-hidden rounded-3xl border border-slate-700/70 bg-slate-950/95 shadow-2xl shadow-black/40 sm:rounded-[2rem]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(241,214,74,0.16),_transparent_36%),linear-gradient(145deg,_rgba(15,23,42,0.2),_rgba(2,6,23,0.9))]" />
        <div className="pointer-events-none absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-brand-yellow/80 to-transparent" />
        <div className="flex w-full flex-col justify-center">
          <CardHeader className="relative px-4 pb-3 pt-5 text-center sm:px-10 sm:pb-4 sm:pt-8">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-2xl border border-brand-yellow/35 bg-brand-yellow/15 text-brand-yellow shadow-lg shadow-brand-yellow/10 sm:mb-4 sm:h-14 sm:w-14">
              {setupRequired ? <ShieldCheck className="h-5 w-5 sm:h-6 sm:w-6" /> : <LockKeyhole className="h-5 w-5 sm:h-6 sm:w-6" />}
            </div>
            <CardTitle className="text-2xl sm:text-3xl">
              {setupRequired ? 'Set Sensitive PIN' : 'Verify your identity'}
            </CardTitle>
            <CardDescription className="mx-auto max-w-md text-sm leading-5 text-slate-300 sm:text-base sm:leading-6">
              {setupRequired
                ? `Create a 4 or 6 digit PIN to unlock protected modules for 20 minutes on this session.`
                : `Enter your ${configuredPinLength ? `${configuredPinLength}-digit ` : ''}sensitive access PIN to unlock ${moduleLabel} for 20 minutes.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="relative space-y-3 px-4 pb-5 sm:space-y-4 sm:px-10 sm:pb-8">
            {setupRequired ? (
              <div className="mx-auto max-w-md space-y-4 text-center sm:space-y-5">
                {!setupPending ? (
                  <>
                    <div className="mx-auto flex w-fit rounded-full border border-slate-700/70 bg-slate-900/80 p-1 shadow-inner">
                      {[4, 6].map((length) => (
                        <button
                          key={length}
                          type="button"
                          aria-pressed={setupPinLength === length}
                          onClick={() => handleSetupPinLengthChange(length as 4 | 6)}
                          className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                            setupPinLength === length
                              ? 'bg-brand-yellow text-slate-950 shadow shadow-brand-yellow/15'
                              : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                          }`}
                        >
                          {length} digit
                        </button>
                      ))}
                    </div>

                    <div className="space-y-3 rounded-2xl border border-slate-800/80 bg-slate-950/45 p-3 sm:space-y-4 sm:p-4">
                      <p className="text-sm font-medium text-slate-200">Choose your new PIN</p>
                      <PinDigitEntry
                        id="sensitive-module-setup-pin"
                        label="New sensitive PIN"
                        value={setupPin}
                        length={setupPinLength}
                        onChange={handleSetupPinChange}
                        inputRef={setupPinInputRef}
                        onActivate={() => focusPinInput(setupPinInputRef.current, 'setup')}
                        disabled={working}
                        describedBy="sensitive-module-setup-help"
                        autoFocus={!setupPending}
                        customEntryActive={customKeypadTarget === 'setup'}
                        visuallyActive={activePinTarget === 'setup'}
                      />
                    </div>

                    <div className="space-y-3 rounded-2xl border border-slate-800/80 bg-slate-950/45 p-3 sm:space-y-4 sm:p-4">
                      <p className="text-sm font-medium text-slate-200">Confirm your PIN</p>
                      <PinDigitEntry
                        id="sensitive-module-confirm-pin"
                        label="Confirm sensitive PIN"
                        value={confirmSetupPin}
                        length={setupPinLength}
                        onChange={handleConfirmSetupPinChange}
                        inputRef={confirmSetupPinInputRef}
                        onActivate={() => focusPinInput(confirmSetupPinInputRef.current, 'confirm')}
                        disabled={working || setupPin.length !== setupPinLength}
                        describedBy="sensitive-module-setup-help"
                        customEntryActive={customKeypadTarget === 'confirm'}
                        visuallyActive={activePinTarget === 'confirm'}
                      />
                    </div>

                    <div
                      id="sensitive-module-setup-help"
                      className="flex min-h-6 items-center justify-center text-sm text-slate-400"
                      aria-live="polite"
                    >
                      {working ? (
                        <span className="inline-flex items-center gap-2 text-brand-yellow">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Setting PIN...
                        </span>
                      ) : setupPin.length === setupPinLength ? (
                        'Re-enter the same PIN to finish setup.'
                      ) : (
                        'This PIN cannot match your normal account password.'
                      )}
                    </div>
                  </>
                ) : (
                  <div className="space-y-4 rounded-2xl border border-brand-yellow/35 bg-brand-yellow/10 p-4 sm:space-y-5 sm:p-5">
                    <p className="text-center text-sm text-slate-200">
                      Enter the 6-digit verification code sent to {setupEmail || 'your email address'}.
                    </p>
                    <PinDigitEntry
                      id="sensitive-module-verification-code"
                      label="Verification code"
                      value={verificationCode}
                      length={6}
                      onChange={handleVerificationCodeChange}
                      inputRef={verificationInputRef}
                      onActivate={() => focusPinInput(verificationInputRef.current, 'verification')}
                      disabled={working}
                      autoComplete="one-time-code"
                      autoFocus
                      describedBy="sensitive-module-verification-help"
                      customEntryActive={customKeypadTarget === 'verification'}
                      visuallyActive={activePinTarget === 'verification'}
                    />
                    <div
                      id="sensitive-module-verification-help"
                      className="flex min-h-6 items-center justify-center text-sm text-slate-300"
                      aria-live="polite"
                    >
                      {working ? (
                        <span className="inline-flex items-center gap-2 text-brand-yellow">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Verifying code...
                        </span>
                      ) : (
                        'The code submits automatically after the final digit.'
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <form
                className="mx-auto grid max-w-md gap-5 text-center"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleUnlock();
                }}
              >
                <div className="space-y-4">
                  <PinDigitEntry
                    id="sensitive-module-pin"
                    label="Sensitive PIN"
                    value={pin}
                    length={pinEntryLength}
                    onChange={handlePinChange}
                    inputRef={pinInputRef}
                    onActivate={() => focusPinInput(pinInputRef.current, 'unlock')}
                    disabled={working}
                    describedBy="sensitive-module-pin-help"
                    autoFocus
                    customEntryActive={customKeypadTarget === 'unlock'}
                    visuallyActive={activePinTarget === 'unlock'}
                  />
                </div>
                <div
                  id="sensitive-module-pin-help"
                  className="flex min-h-6 items-center justify-center text-sm text-slate-400"
                  aria-live="polite"
                >
                  {working ? (
                    <span className="inline-flex items-center gap-2 text-brand-yellow">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Verifying PIN...
                    </span>
                  ) : pinCanUnlock && !configuredPinLength ? (
                    'Press Enter to unlock.'
                  ) : (
                    null
                  )}
                </div>
              </form>
            )}
          </CardContent>
        </div>
      </Card>
    </div>
    {customKeypadTarget ? (
      <SensitiveNumericKeypad
        value={customKeypadValue}
        disabled={working}
        onDigit={handleCustomKeypadDigit}
        onBackspace={handleCustomKeypadBackspace}
        onConfirm={customKeypadTarget === 'unlock' && !configuredPinLength ? () => void handleUnlock() : undefined}
        confirmDisabled={!customKeypadCanConfirmUnlock}
      />
    ) : null}
    </>
  );
}
