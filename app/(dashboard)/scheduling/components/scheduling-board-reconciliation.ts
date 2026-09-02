import type { SchedulingProjection } from './scheduling-optimistic-ledger';

export type SchedulingMutationSettleOutcome = 'success' | 'failure' | 'ambiguous';
export type SchedulingReconcileMode = 'none' | 'coalesced-verify' | 'required';

export interface PostMutationReconciliationPlan {
  retire: boolean;
  reconcile: SchedulingReconcileMode;
}

export function proofsSatisfiedForKeys(
  proofs: Record<string, (base: SchedulingProjection) => boolean> | undefined,
  queryKeys: readonly string[],
  projection: SchedulingProjection
): boolean {
  if (!proofs) return false;
  return queryKeys.every((key) => proofs[key]?.(projection) === true);
}

export function planPostMutationReconciliation(input: {
  outcome: SchedulingMutationSettleOutcome;
  proofsSatisfied: boolean;
}): PostMutationReconciliationPlan {
  if (input.outcome === 'success' && input.proofsSatisfied) {
    return { retire: true, reconcile: 'coalesced-verify' };
  }
  if (input.outcome === 'success') {
    return { retire: false, reconcile: 'required' };
  }
  return { retire: false, reconcile: 'required' };
}

export class CoalescedBackgroundReconciler {
  private pendingKeys = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private followUp = false;
  private readonly delayMs: number;
  private readonly run: (keys: string[]) => Promise<void>;
  private readonly scheduleTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void;

  constructor(options: {
    delayMs: number;
    run: (keys: string[]) => Promise<void>;
    setTimeoutFn?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
    clearTimeoutFn?: (timer: ReturnType<typeof setTimeout>) => void;
  }) {
    this.delayMs = options.delayMs;
    this.run = options.run;
    this.scheduleTimer = options.setTimeoutFn || setTimeout;
    this.clearTimer = options.clearTimeoutFn || clearTimeout;
  }

  schedule(keys: readonly string[]) {
    for (const key of keys) this.pendingKeys.add(key);
    if (this.inFlight) {
      this.followUp = true;
      return;
    }
    this.armTimer();
  }

  dispose() {
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    this.pendingKeys.clear();
    this.followUp = false;
  }

  private armTimer() {
    if (this.timer) this.clearTimer(this.timer);
    this.timer = this.scheduleTimer(() => {
      this.timer = null;
      void this.flush();
    }, this.delayMs);
  }

  private async flush() {
    if (this.inFlight || this.pendingKeys.size === 0) return;
    const keys = [...this.pendingKeys];
    this.pendingKeys.clear();
    this.inFlight = true;
    try {
      await this.run(keys);
    } finally {
      this.inFlight = false;
      if (this.followUp || this.pendingKeys.size > 0) {
        this.followUp = false;
        this.armTimer();
      }
    }
  }
}
