import { describe, expect, it, vi } from 'vitest';
import {
  shouldRollbackOptimisticQuickAdd,
  withBoundedTimeout,
} from '@/lib/utils/scheduling-timeout';

describe('scheduling request timeouts', () => {
  it('sched-quickadd-timeout-safe keeps day-team work after a hung quick-add', async () => {
    vi.useFakeTimers();
    const pending = new Promise<string>(() => undefined);
    const raced = withBoundedTimeout(pending, 25, 'Quick add timed out');
    const expectation = expect(raced).rejects.toSatisfy((error: unknown) => {
      return error instanceof TypeError
        && error.message === 'Quick add timed out'
        && shouldRollbackOptimisticQuickAdd(error) === false;
    });
    await vi.advanceTimersByTimeAsync(25);
    await expectation;
    vi.useRealTimers();
  });

  it('rolls back only definite client failures', () => {
    expect(shouldRollbackOptimisticQuickAdd(new Error('Invalid customer'))).toBe(true);
    expect(shouldRollbackOptimisticQuickAdd(Object.assign(new Error('Server down'), { status: 503 }))).toBe(false);
  });

  it('keeps persisted day-team work after a timeout TypeError', () => {
    const timeout = new TypeError('Quick add timed out before the server confirmed the project.');
    expect(shouldRollbackOptimisticQuickAdd(timeout)).toBe(false);
  });
});
