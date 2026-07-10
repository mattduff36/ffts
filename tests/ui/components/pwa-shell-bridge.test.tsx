/** @vitest-environment happy-dom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PwaShellBridge } from '@/components/layout/PwaShellBridge';

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

function setIOSStandalone(value: boolean) {
  Object.defineProperty(window.navigator, 'standalone', {
    configurable: true,
    value,
  });
}

function setDisplayModeStandalone(value: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: value && query === '(display-mode: standalone)',
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

function renderBridgeWithLink(children?: ReactNode) {
  return render(
    <>
      <PwaShellBridge />
      {children}
    </>
  );
}

describe('PwaShellBridge', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/dashboard');
    setIOSStandalone(true);
    setDisplayModeStandalone(false);
    document.documentElement.removeAttribute('data-standalone-pwa');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete (window.navigator as NavigatorWithStandalone).standalone;
    document.documentElement.removeAttribute('data-standalone-pwa');
  });

  it('marks iOS standalone mode for safe-area styling without intercepting app links', () => {
    const nextLinkClick = vi.fn((event: ReactMouseEvent<HTMLAnchorElement>) => {
      expect(event.defaultPrevented).toBe(false);
      event.preventDefault();
    });

    renderBridgeWithLink(
      // eslint-disable-next-line @next/next/no-html-link-for-pages -- This test verifies native anchor click handling.
      <a href="/timesheets" onClick={nextLinkClick}>
        Timesheets
      </a>
    );

    fireEvent.click(screen.getByRole('link', { name: 'Timesheets' }), { button: 0 });

    expect(document.documentElement.hasAttribute('data-standalone-pwa')).toBe(true);
    expect(nextLinkClick).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/dashboard');
  });

  it('does not hijack external links', () => {
    const externalClick = vi.fn((event: ReactMouseEvent<HTMLAnchorElement>) => {
      expect(event.defaultPrevented).toBe(false);
      event.preventDefault();
    });

    renderBridgeWithLink(
      <a href="https://example.com" onClick={externalClick}>
        External
      </a>
    );

    fireEvent.click(screen.getByRole('link', { name: 'External' }), { button: 0 });

    expect(externalClick).toHaveBeenCalledTimes(1);
    expect(window.location.href).toBe('http://127.0.0.1:4000/dashboard');
  });

  it('marks non-iOS standalone display mode for safe-area styling without intercepting links', () => {
    setIOSStandalone(false);
    setDisplayModeStandalone(true);
    const linkClick = vi.fn((event: ReactMouseEvent<HTMLAnchorElement>) => {
      expect(event.defaultPrevented).toBe(false);
      event.preventDefault();
    });

    renderBridgeWithLink(
      <a href="/profile" onClick={linkClick}>
        Profile
      </a>
    );

    fireEvent.click(screen.getByRole('link', { name: 'Profile' }), { button: 0 });

    expect(document.documentElement.hasAttribute('data-standalone-pwa')).toBe(true);
    expect(linkClick).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/dashboard');
  });
});
