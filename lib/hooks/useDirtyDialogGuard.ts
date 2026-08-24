'use client';

import { useCallback, useEffect, useRef } from 'react';
import { triggerShakeAnimation } from '@/lib/utils/animations';

interface PreventableDialogEvent {
  preventDefault: () => void;
}

interface UseDirtyDialogGuardOptions {
  isDirty: boolean;
  disabled?: boolean;
  onOpenChange: (open: boolean) => void;
}

function isDocumentHidden(): boolean {
  if (typeof document === 'undefined') return false;
  return document.visibilityState !== 'visible' || document.hidden;
}

export function useDirtyDialogGuard({
  isDirty,
  disabled = false,
  onOpenChange,
}: UseDirtyDialogGuardOptions) {
  const contentRef = useRef<HTMLDivElement>(null);
  const shouldBlockClose = isDirty && !disabled;
  const implicitDismissRef = useRef(false);

  const markImplicitDismiss = useCallback(() => {
    implicitDismissRef.current = true;
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    const handleBackground = () => {
      markImplicitDismiss();
    };

    const clearImplicitOnTrustedGesture = (event: Event) => {
      if (event.isTrusted) {
        implicitDismissRef.current = false;
      }
    };

    document.addEventListener('visibilitychange', handleBackground);
    window.addEventListener('pagehide', handleBackground);
    document.addEventListener('pointerdown', clearImplicitOnTrustedGesture, true);
    document.addEventListener('keydown', clearImplicitOnTrustedGesture, true);

    return () => {
      document.removeEventListener('visibilitychange', handleBackground);
      window.removeEventListener('pagehide', handleBackground);
      document.removeEventListener('pointerdown', clearImplicitOnTrustedGesture, true);
      document.removeEventListener('keydown', clearImplicitOnTrustedGesture, true);
    };
  }, [markImplicitDismiss]);

  const shake = useCallback(() => {
    triggerShakeAnimation(contentRef.current);
  }, []);

  const shouldIgnoreDismiss = useCallback(() => {
    return isDocumentHidden() || implicitDismissRef.current;
  }, []);

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open && (shouldBlockClose || shouldIgnoreDismiss())) {
      if (shouldBlockClose) {
        shake();
      }
      return;
    }

    onOpenChange(open);
  }, [onOpenChange, shake, shouldBlockClose, shouldIgnoreDismiss]);

  const handleBlockedCloseEvent = useCallback((event: PreventableDialogEvent) => {
    if (!shouldBlockClose) return;
    event.preventDefault();
    shake();
  }, [shake, shouldBlockClose]);

  const handleFocusOutside = useCallback((event: PreventableDialogEvent) => {
    event.preventDefault();
    markImplicitDismiss();
    if (shouldBlockClose) {
      shake();
    }
  }, [markImplicitDismiss, shake, shouldBlockClose]);

  const discard = useCallback(() => {
    implicitDismissRef.current = false;
    onOpenChange(false);
  }, [onOpenChange]);

  return {
    contentRef,
    handleOpenChange,
    handleInteractOutside: handleBlockedCloseEvent,
    handlePointerDownOutside: handleBlockedCloseEvent,
    handleEscapeKeyDown: handleBlockedCloseEvent,
    handleFocusOutside,
    discard,
    shake,
    shouldBlockClose,
  };
}
