'use client';

import type { AuthTransitionReason } from '@/lib/app-auth/transition';

const DEFERRED_UNAUTHENTICATED_REASONS = new Set<AuthTransitionReason>([
  'focus',
  'visibility',
  'online',
  'interval',
  'recover',
]);

export function getAuthFailureRedirectPath(statusCode?: number | null): string {
  void statusCode;
  return '/login';
}

export function shouldDeferUnauthenticatedHandling(
  reason: AuthTransitionReason,
  options?: { silent?: boolean }
): boolean {
  return options?.silent === true && DEFERRED_UNAUTHENTICATED_REASONS.has(reason);
}
