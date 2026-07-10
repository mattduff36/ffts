/// <reference types="@testing-library/jest-dom/vitest" />
/** @vitest-environment happy-dom */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SensitiveModuleGate,
  type SensitiveModuleAccessState,
} from '@/components/security/SensitiveModuleGate';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

interface MutableVisualViewport {
  height: number;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}

function setMatchMedia({ coarse, mobileWidth }: { coarse: boolean; mobileWidth: boolean }) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches:
        (query === '(pointer: coarse)' && coarse) ||
        (query === '(max-width: 1024px)' && mobileWidth),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function setTouchPoints(points: number) {
  Object.defineProperty(window.navigator, 'maxTouchPoints', {
    configurable: true,
    value: points,
  });
}

function setVisualViewport(height: number): MutableVisualViewport {
  const visualViewport = {
    height,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };

  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: visualViewport,
  });

  return visualViewport;
}

function configureDesktopViewport() {
  setTouchPoints(0);
  setMatchMedia({ coarse: false, mobileWidth: false });
  return setVisualViewport(800);
}

function configureMobileViewport(height = 800) {
  setTouchPoints(1);
  setMatchMedia({ coarse: true, mobileWidth: true });
  return setVisualViewport(height);
}

function buildAccess(overrides: Partial<SensitiveModuleAccessState> = {}): SensitiveModuleAccessState {
  return {
    loading: false,
    canAccess: false,
    state: {
      module_name: 'quotes',
      required: true,
      unlocked: false,
      expires_at: null,
      pin_status: {
        configured: true,
        pin_length: 4,
        must_reset: false,
        locked_until: null,
      },
    },
    refresh: vi.fn(),
    unlock: vi.fn(async () => true),
    renew: vi.fn(async () => true),
    ...overrides,
  };
}

async function advanceKeyboardDetection() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(800);
  });
}

async function tapButton(name: string | RegExp) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
    await Promise.resolve();
  });
}

async function tapDigits(digits: string) {
  for (const digit of digits) {
    await tapButton(`Enter ${digit}`);
  }
}

async function runPendingTimers() {
  await act(async () => {
    await vi.runOnlyPendingTimersAsync();
  });
}

describe('SensitiveModuleGate mobile PIN keypad fallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps desktop on the native input path without showing the custom keypad', async () => {
    configureDesktopViewport();

    render(<SensitiveModuleGate moduleLabel="Quotes" access={buildAccess()} />);
    await advanceKeyboardDetection();

    expect(screen.queryByRole('group', { name: /custom numeric pin keypad/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Sensitive PIN')).not.toHaveAttribute('readonly');
  });

  it('keeps the custom keypad hidden when mobile viewport shrink indicates a native keyboard opened', async () => {
    const visualViewport = configureMobileViewport();

    render(<SensitiveModuleGate moduleLabel="Quotes" access={buildAccess()} />);
    visualViewport.height = 520;
    await advanceKeyboardDetection();

    expect(screen.queryByRole('group', { name: /custom numeric pin keypad/i })).not.toBeInTheDocument();
  });

  it('shows the custom keypad on mobile when the native keyboard does not appear and submits a 4 digit PIN once', async () => {
    configureMobileViewport();
    const unlock = vi.fn(async () => true);

    render(<SensitiveModuleGate moduleLabel="Quotes" access={buildAccess({ unlock })} />);
    await advanceKeyboardDetection();

    expect(screen.getByRole('group', { name: /custom numeric pin keypad/i })).toBeInTheDocument();
    const input = screen.getByLabelText('Sensitive PIN') as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(input.tabIndex).toBe(-1);

    await tapDigits('12');
    await tapButton(/delete last digit/i);
    await tapDigits('234');

    expect(unlock).toHaveBeenCalledTimes(1);
    expect(unlock).toHaveBeenCalledWith('1234');
    expect(screen.queryByRole('group', { name: /custom numeric pin keypad/i })).not.toBeInTheDocument();
  });

  it('supports 6 digit configured PINs through the custom keypad auto-submit path', async () => {
    configureMobileViewport();
    const unlock = vi.fn(async () => true);

    render(
      <SensitiveModuleGate
        moduleLabel="Quotes"
        access={buildAccess({
          unlock,
          state: {
            module_name: 'quotes',
            required: true,
            unlocked: false,
            expires_at: null,
            pin_status: {
              configured: true,
              pin_length: 6,
              must_reset: false,
              locked_until: null,
            },
          },
        })}
      />
    );
    await advanceKeyboardDetection();
    await tapDigits('123456');

    expect(unlock).toHaveBeenCalledTimes(1);
    expect(unlock).toHaveBeenCalledWith('123456');
  });

  it('drives setup, confirm setup, and verification code fields from the custom keypad', async () => {
    configureMobileViewport();
    const unlock = vi.fn(async () => true);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/setup/request')) {
        return {
          ok: true,
          json: async () => ({ requiresVerification: true, email: 'admin@example.co.uk' }),
        };
      }

      return {
        ok: true,
        json: async () => ({}),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <SensitiveModuleGate
        moduleLabel="Quotes"
        access={buildAccess({
          unlock,
          state: {
            module_name: 'quotes',
            required: true,
            unlocked: false,
            expires_at: null,
            pin_status: {
              configured: false,
              pin_length: null,
              must_reset: false,
              locked_until: null,
            },
          },
        })}
      />
    );
    await advanceKeyboardDetection();

    await tapDigits('1234');
    await runPendingTimers();
    expect(screen.getByLabelText('Confirm sensitive PIN')).toHaveAttribute('readonly');

    await tapDigits('1234');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/me/sensitive-pin/setup/request',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ pin: '1234' }),
      })
    );
    expect(screen.getByText(/Enter the 6-digit verification code/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Verification code')).toHaveAttribute('readonly');

    await tapDigits('654321');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/me/sensitive-pin/setup/confirm',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ code: '654321' }),
      })
    );
    expect(unlock).toHaveBeenCalledWith('1234');
  });
});
