import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CoalescedBackgroundReconciler,
  planPostMutationReconciliation,
  proofsSatisfiedForKeys,
} from '@/app/(dashboard)/scheduling/components/scheduling-board-reconciliation';
import type { SchedulingProjection } from '@/app/(dashboard)/scheduling/components/scheduling-optimistic-ledger';

function emptyProjection(): SchedulingProjection {
  return {
    board: undefined,
    quoteCandidates: [],
    projectCandidates: [],
    visitBacklog: [],
  };
}

describe('scheduling board reconciliation', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('P2-001 does not require an immediate full-week refetch when success proofs pass', () => {
    const plan = planPostMutationReconciliation({
      outcome: 'success',
      proofsSatisfied: true,
    });
    expect(plan).toEqual({ retire: true, reconcile: 'coalesced-verify' });
  });

  it('P2-002 coalesces five rapid successes into one background run', async () => {
    vi.useFakeTimers();
    const runs: string[][] = [];
    const reconciler = new CoalescedBackgroundReconciler({
      delayMs: 250,
      run: async (keys) => {
        runs.push(keys);
      },
    });
    reconciler.schedule(['board:week']);
    reconciler.schedule(['board:week']);
    reconciler.schedule(['board:week']);
    reconciler.schedule(['board:week']);
    reconciler.schedule(['board:week']);
    expect(runs).toEqual([]);
    await vi.advanceTimersByTimeAsync(250);
    expect(runs).toEqual([['board:week']]);
    reconciler.dispose();
  });

  it('P2-003 still runs coalesced background verification after activity settles', async () => {
    vi.useFakeTimers();
    let ran = 0;
    const reconciler = new CoalescedBackgroundReconciler({
      delayMs: 250,
      run: async () => {
        ran += 1;
      },
    });
    reconciler.schedule(['board:week', 'backlog']);
    await vi.advanceTimersByTimeAsync(249);
    expect(ran).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(ran).toBe(1);
    reconciler.dispose();
  });

  it('FE-SCHEDULING-ILLEGAL-INVOCATION-REPRO keeps browser timer receivers valid', () => {
    let scheduledCallback: (() => void) | undefined;
    const timerId = 1 as unknown as ReturnType<typeof setTimeout>;
    vi.stubGlobal('setTimeout', function (
      this: unknown,
      callback: () => void
    ): ReturnType<typeof setTimeout> {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError('Illegal invocation');
      }
      scheduledCallback = callback;
      return timerId;
    });
    vi.stubGlobal('clearTimeout', function (
      this: unknown,
      _timer: ReturnType<typeof setTimeout>
    ): void {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError('Illegal invocation');
      }
    });

    const reconciler = new CoalescedBackgroundReconciler({
      delayMs: 250,
      run: async () => {},
    });

    expect(() => reconciler.schedule(['board:week'])).not.toThrow();
    expect(scheduledCallback).toEqual(expect.any(Function));
    expect(() => reconciler.dispose()).not.toThrow();
  });

  it('P2-004 failure and ambiguous outcomes still require authoritative reconciliation', () => {
    expect(planPostMutationReconciliation({
      outcome: 'failure',
      proofsSatisfied: false,
    })).toEqual({ retire: false, reconcile: 'required' });
    expect(planPostMutationReconciliation({
      outcome: 'ambiguous',
      proofsSatisfied: false,
    })).toEqual({ retire: false, reconcile: 'required' });
  });

  it('P2-005 insufficient proof cannot retire and schedules reconciliation', () => {
    const projection = emptyProjection();
    const proofsSatisfied = proofsSatisfiedForKeys(
      {
        'board:week': (state) => Boolean(state.board),
      },
      ['board:week'],
      projection
    );
    expect(proofsSatisfied).toBe(false);
    expect(planPostMutationReconciliation({
      outcome: 'success',
      proofsSatisfied,
    })).toEqual({ retire: false, reconcile: 'required' });
  });

  it('does not cancel an in-flight GET when later successes arrive', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const inFlight = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runs: number[] = [];
    const reconciler = new CoalescedBackgroundReconciler({
      delayMs: 250,
      run: async () => {
        runs.push(runs.length + 1);
        if (runs.length === 1) await inFlight;
      },
    });
    reconciler.schedule(['board:week']);
    await vi.advanceTimersByTimeAsync(250);
    expect(runs).toEqual([1]);
    reconciler.schedule(['board:week']);
    reconciler.schedule(['board:week']);
    await vi.advanceTimersByTimeAsync(250);
    expect(runs).toEqual([1]);
    release();
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(250);
    expect(runs).toEqual([1, 2]);
    reconciler.dispose();
  });
});
