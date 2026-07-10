'use client';

import { useCallback, useRef } from 'react';
import { triggerShakeAnimation } from '@/lib/utils/animations';

interface PreventableDialogEvent {
  preventDefault: () => void;
}

interface UseDirtyDialogGuardOptions {
  isDirty: boolean;
  disabled?: boolean;
  onOpenChange: (open: boolean) => void;
}

export function useDirtyDialogGuard({
  isDirty,
  disabled = false,
  onOpenChange,
}: UseDirtyDialogGuardOptions) {
  const contentRef = useRef<HTMLDivElement>(null);
  const shouldBlockClose = isDirty && !disabled;

  const shake = useCallback(() => {
    triggerShakeAnimation(contentRef.current);
  }, []);

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open && shouldBlockClose) {
      shake();
      return;
    }

    onOpenChange(open);
  }, [onOpenChange, shake, shouldBlockClose]);

  const handleBlockedCloseEvent = useCallback((event: PreventableDialogEvent) => {
    if (!shouldBlockClose) return;
    event.preventDefault();
    shake();
  }, [shake, shouldBlockClose]);

  const discard = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  return {
    contentRef,
    handleOpenChange,
    handleInteractOutside: handleBlockedCloseEvent,
    handleEscapeKeyDown: handleBlockedCloseEvent,
    discard,
    shake,
    shouldBlockClose,
  };
}
