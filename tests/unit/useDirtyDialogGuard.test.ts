/** @vitest-environment happy-dom */

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDirtyDialogGuard } from '@/lib/hooks/useDirtyDialogGuard';
import { triggerShakeAnimation } from '@/lib/utils/animations';

vi.mock('@/lib/utils/animations', () => ({
  triggerShakeAnimation: vi.fn(),
}));

function setDocumentVisibility(hidden: boolean) {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden,
  });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
}

describe('useDirtyDialogGuard', () => {
  afterEach(() => {
    setDocumentVisibility(false);
  });

  it('blocks accidental close attempts while dirty and allows explicit discard', () => {
    const onOpenChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ isDirty, disabled }: { isDirty: boolean; disabled: boolean }) => useDirtyDialogGuard({
        isDirty,
        disabled,
        onOpenChange,
      }),
      {
        initialProps: {
          isDirty: true,
          disabled: false,
        },
      }
    );

    act(() => {
      result.current.handleOpenChange(false);
    });

    expect(triggerShakeAnimation).toHaveBeenCalledWith(null);
    expect(onOpenChange).not.toHaveBeenCalled();

    const outsideEvent = { preventDefault: vi.fn() };
    act(() => {
      result.current.handleInteractOutside(outsideEvent);
    });

    expect(outsideEvent.preventDefault).toHaveBeenCalled();
    expect(triggerShakeAnimation).toHaveBeenCalledTimes(2);

    const pointerDownEvent = { preventDefault: vi.fn() };
    act(() => {
      result.current.handlePointerDownOutside(pointerDownEvent);
    });

    expect(pointerDownEvent.preventDefault).toHaveBeenCalled();
    expect(triggerShakeAnimation).toHaveBeenCalledTimes(3);

    act(() => {
      result.current.discard();
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);

    onOpenChange.mockClear();
    vi.mocked(triggerShakeAnimation).mockClear();
    rerender({ isDirty: false, disabled: false });

    act(() => {
      result.current.handleOpenChange(false);
    });

    expect(triggerShakeAnimation).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not block close attempts while disabled for submission', () => {
    const onOpenChange = vi.fn();
    const { result } = renderHook(() => useDirtyDialogGuard({
      isDirty: true,
      disabled: true,
      onOpenChange,
    }));

    const escapeEvent = { preventDefault: vi.fn() };
    act(() => {
      result.current.handleEscapeKeyDown(escapeEvent);
      result.current.handleOpenChange(false);
    });

    expect(escapeEvent.preventDefault).not.toHaveBeenCalled();
    expect(triggerShakeAnimation).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('never closes from tab-switch or minimise, even when the form is clean', () => {
    const onOpenChange = vi.fn();
    const { result } = renderHook(() => useDirtyDialogGuard({
      isDirty: false,
      onOpenChange,
    }));

    setDocumentVisibility(true);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      result.current.handleOpenChange(false);
    });

    expect(onOpenChange).not.toHaveBeenCalled();

    setDocumentVisibility(false);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      result.current.handleOpenChange(false);
    });

    expect(onOpenChange).not.toHaveBeenCalled();

    const focusEvent = { preventDefault: vi.fn() };
    act(() => {
      result.current.handleFocusOutside(focusEvent);
      result.current.handleOpenChange(false);
    });

    expect(focusEvent.preventDefault).toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('keeps a dirty dialog open after visibility/focus-loss and still allows discard', () => {
    const onOpenChange = vi.fn();
    const { result } = renderHook(() => useDirtyDialogGuard({
      isDirty: true,
      onOpenChange,
    }));

    setDocumentVisibility(true);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pagehide'));
      result.current.handleOpenChange(false);
    });

    expect(triggerShakeAnimation).toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();

    setDocumentVisibility(false);
    const focusEvent = { preventDefault: vi.fn() };
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      result.current.handleFocusOutside(focusEvent);
      result.current.handleOpenChange(false);
    });

    expect(focusEvent.preventDefault).toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();

    act(() => {
      result.current.discard();
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('lets a trusted Escape close a clean dialog after returning to the tab', () => {
    const onOpenChange = vi.fn();
    const { result } = renderHook(() => useDirtyDialogGuard({
      isDirty: false,
      onOpenChange,
    }));

    setDocumentVisibility(true);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    setDocumentVisibility(false);
    const trustedEscape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    Object.defineProperty(trustedEscape, 'isTrusted', { value: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      document.dispatchEvent(trustedEscape);
      result.current.handleOpenChange(false);
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
