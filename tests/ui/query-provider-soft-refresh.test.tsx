/** @vitest-environment happy-dom */
import React from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { QueryProvider } from '@/lib/providers/query-provider';
import { pauseSoftRefresh } from '@/lib/client/soft-refresh';

vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/lib/database/client-health', () => ({ markDatabaseBackedSuccess: vi.fn(), nudgeDatabaseHealthCheck: vi.fn() }));
vi.mock('@/lib/app-auth/recovery-bridge', () => ({ handleAuthFailureStatus: vi.fn() }));
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('refreshes two independent page caches from saved server data, preserves disabled queries and pauses drafts', async () => {
  vi.useFakeTimers();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  let savedValue = 'original';
  const read = vi.fn(async () => savedValue);
  const forbidden = vi.fn(async () => 'restricted');
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryProvider>{children}</QueryProvider>;
  const first = renderHook(() => useQuery({ queryKey: ['quotes'], queryFn: read }), { wrapper });
  const second = renderHook(() => useQuery({ queryKey: ['quotes'], queryFn: read }), { wrapper });
  renderHook(() => useQuery({ queryKey: ['restricted'], queryFn: forbidden, enabled: false }), { wrapper });
  await act(() => vi.advanceTimersByTimeAsync(10));
  expect(first.result.current.data).toBe('original');
  expect(second.result.current.data).toBe('original');
  savedValue = 'saved on another device';
  await act(() => vi.advanceTimersByTimeAsync(15_010));
  expect(first.result.current.data).toBe(savedValue);
  expect(second.result.current.data).toBe(savedValue);
  expect(forbidden).not.toHaveBeenCalled();
  const release = pauseSoftRefresh();
  savedValue = 'newer';
  await act(() => vi.advanceTimersByTimeAsync(15_010));
  expect(first.result.current.data).toBe('saved on another device');
  release();
  await act(() => vi.advanceTimersByTimeAsync(15_010));
  expect(first.result.current.data).toBe('newer');
});
