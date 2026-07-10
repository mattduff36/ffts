/** @vitest-environment happy-dom */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useDirtyDialogGuard } from '@/lib/hooks/useDirtyDialogGuard';
import { triggerShakeAnimation } from '@/lib/utils/animations';

vi.mock('@/lib/utils/animations', () => ({
  triggerShakeAnimation: vi.fn(),
}));

describe('useDirtyDialogGuard', () => {
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
});
