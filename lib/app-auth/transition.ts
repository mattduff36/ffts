import type { ClientAuthSessionResponse } from '@/lib/app-auth/client-session';

export type AuthTransitionReason =
  | 'initial_load'
  | 'interval'
  | 'visibility'
  | 'focus'
  | 'online'
  | 'broadcast'
  | 'sign_in'
  | 'sign_out'
  | 'recover'
  | 'manual';

export interface AuthSessionSnapshot {
  authenticated: boolean;
  userId: string | null;
  profileId: string | null;
}

export interface AuthSessionTransition {
  changed: boolean;
  authChanged: boolean;
  userChanged: boolean;
  profileChanged: boolean;
  becameAuthenticated: boolean;
  becameUnauthenticated: boolean;
  shouldInvalidateToken: boolean;
}

export function getUnauthenticatedSessionSnapshot(): AuthSessionSnapshot {
  return {
    authenticated: false,
    userId: null,
    profileId: null,
  };
}

export function buildSessionSnapshot(payload: ClientAuthSessionResponse | null | undefined): AuthSessionSnapshot {
  if (!payload?.authenticated || !payload.user?.id) {
    return getUnauthenticatedSessionSnapshot();
  }

  const profileId =
    typeof payload.profile === 'object' &&
    payload.profile !== null &&
    'id' in payload.profile &&
    typeof (payload.profile as { id?: unknown }).id === 'string'
      ? (payload.profile as { id: string }).id
      : payload.user.id;

  return {
    authenticated: true,
    userId: payload.user.id,
    profileId,
  };
}

export function getSessionTransition(
  previous: AuthSessionSnapshot | null,
  next: AuthSessionSnapshot
): AuthSessionTransition {
  const before = previous ?? getUnauthenticatedSessionSnapshot();
  const authChanged = before.authenticated !== next.authenticated;
  const userChanged = before.userId !== next.userId;
  const profileChanged = before.profileId !== next.profileId;
  const changed = authChanged || userChanged || profileChanged;

  return {
    changed,
    authChanged,
    userChanged,
    profileChanged,
    becameAuthenticated: !before.authenticated && next.authenticated,
    becameUnauthenticated: before.authenticated && !next.authenticated,
    shouldInvalidateToken:
      userChanged || profileChanged || authChanged || !next.authenticated,
  };
}
