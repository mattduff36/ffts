import { describe, expect, it } from 'vitest';
import {
  buildSessionSnapshot,
  getSessionTransition,
  getUnauthenticatedSessionSnapshot,
} from '@/lib/app-auth/transition';

describe('auth transition helpers', () => {
  it('builds an unauthenticated snapshot when payload is missing', () => {
    expect(buildSessionSnapshot(null)).toEqual(getUnauthenticatedSessionSnapshot());
  });

  it('detects profile switch when user id changes', () => {
    const previous = buildSessionSnapshot({
      authenticated: true,
      user: { id: 'user-a', email: 'a@example.com' },
      profile: { id: 'profile-a' },
    });
    const next = buildSessionSnapshot({
      authenticated: true,
      user: { id: 'user-b', email: 'b@example.com' },
      profile: { id: 'profile-b' },
    });

    const transition = getSessionTransition(previous, next);
    expect(transition.userChanged).toBe(true);
    expect(transition.profileChanged).toBe(true);
    expect(transition.becameAuthenticated).toBe(false);
    expect(transition.shouldInvalidateToken).toBe(true);
  });

  it('detects sign-out transition', () => {
    const previous = buildSessionSnapshot({
      authenticated: true,
      user: { id: 'user-a', email: 'a@example.com' },
      profile: { id: 'profile-a' },
    });
    const next = getUnauthenticatedSessionSnapshot();

    const transition = getSessionTransition(previous, next);
    expect(transition.authChanged).toBe(true);
    expect(transition.becameUnauthenticated).toBe(true);
    expect(transition.shouldInvalidateToken).toBe(true);
  });
});
