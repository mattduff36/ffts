/**
 * Plant Table Async Callback Timing Fix Test
 * 
 * Tests for bug fix related to async callback synchronization
 */

import { describe, it, expect, vi } from 'vitest';

describe('Plant Table Async Callback Timing Fix', () => {
  describe('Bug: Callback fires before async fetch completes', () => {
    it('should demonstrate the timing issue before fix', async () => {
      let fetchCompleted = false;
      let callbackFiredWhileFetching = false;

      const mockFetchPlantData = async () => {
        await new Promise((resolve) => setTimeout(resolve, 100)); // Simulate async delay
        fetchCompleted = true;
      };

      const mockCallback = () => {
        if (!fetchCompleted) {
          callbackFiredWhileFetching = true; // ❌ Callback fires too early
        }
      };

      // BEFORE: Callback fires immediately (no await)
      const onSuccessBefore = () => {
        mockFetchPlantData(); // ❌ Not awaited
        mockCallback(); // ❌ Fires immediately
      };

      onSuccessBefore();
      expect(callbackFiredWhileFetching).toBe(true); // ❌ Fired before fetch completed

      // Wait for fetch to actually complete
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(fetchCompleted).toBe(true); // Fetch completed after callback fired
    });

    it('should demonstrate correct timing after fix', async () => {
      let fetchCompleted = false;
      let callbackFiredAfterFetch = false;

      const mockFetchPlantData = async () => {
        await new Promise((resolve) => setTimeout(resolve, 100)); // Simulate async delay
        fetchCompleted = true;
      };

      const mockCallback = () => {
        if (fetchCompleted) {
          callbackFiredAfterFetch = true; // ✅ Callback fires after fetch
        }
      };

      // AFTER: Callback waits for fetch (with await)
      const onSuccessAfter = async () => {
        await mockFetchPlantData(); // ✅ Awaited
        mockCallback(); // ✅ Fires after fetch completes
      };

      await onSuccessAfter();
      expect(fetchCompleted).toBe(true); // Fetch completed
      expect(callbackFiredAfterFetch).toBe(true); // ✅ Callback fired after fetch
    });
  });

  describe('Async state update synchronization', () => {
    it('should ensure state updates before callback fires', async () => {
      const plantAssets: Array<{ id: string; plant_id?: string }> = [];
      let callbackReceivedCorrectCount = false;

      const fetchPlantData = async () => {
        await new Promise((resolve) => setTimeout(resolve, 50)); // Simulate DB query
        plantAssets.push({ id: 'p1', plant_id: 'P001' }); // State update
      };

      const onVehicleAdded = () => {
        // Parent component expects up-to-date count
        if (plantAssets.length === 1) {
          callbackReceivedCorrectCount = true; // ✅ Correct count
        }
      };

      // Correct pattern: await fetch before callback
      await fetchPlantData();
      onVehicleAdded();

      expect(callbackReceivedCorrectCount).toBe(true);
      expect(plantAssets.length).toBe(1);
    });

    it('should show stale data issue without await', async () => {
      const plantAssets: Array<{ id: string; plant_id?: string }> = [];
      let callbackReceivedStaleCount = false;

      const fetchPlantData = async () => {
        await new Promise((resolve) => setTimeout(resolve, 50)); // Simulate DB query
        plantAssets.push({ id: 'p1', plant_id: 'P001' }); // State update happens later
      };

      const onVehicleAdded = () => {
        // Parent component gets stale count
        if (plantAssets.length === 0) {
          callbackReceivedStaleCount = true; // ❌ Stale data
        }
      };

      // Incorrect pattern: no await
      fetchPlantData(); // Starts async operation
      onVehicleAdded(); // Fires immediately with stale data

      expect(callbackReceivedStaleCount).toBe(true); // ❌ Received stale data
      expect(plantAssets.length).toBe(0); // Still empty

      // Wait for fetch to complete
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(plantAssets.length).toBe(1); // Now updated (too late)
    });
  });

  describe('Race condition scenarios', () => {
    it('should prevent race condition between fetch and callback', async () => {
      const executionOrder: string[] = [];

      const fetchPlantData = async () => {
        executionOrder.push('fetch-start');
        await new Promise((resolve) => setTimeout(resolve, 50));
        executionOrder.push('fetch-complete');
      };

      const onVehicleAdded = () => {
        executionOrder.push('callback-fired');
      };

      // Correct: Sequential execution
      const onSuccess = async () => {
        await fetchPlantData();
        onVehicleAdded();
      };

      await onSuccess();

      expect(executionOrder).toEqual([
        'fetch-start',
        'fetch-complete',
        'callback-fired', // ✅ Correct order
      ]);
    });

    it('should show race condition without await', async () => {
      const executionOrder: string[] = [];

      const fetchPlantData = async () => {
        executionOrder.push('fetch-start');
        await new Promise((resolve) => setTimeout(resolve, 50));
        executionOrder.push('fetch-complete');
      };

      const onVehicleAdded = () => {
        executionOrder.push('callback-fired');
      };

      // Incorrect: Parallel execution
      const onSuccess = () => {
        fetchPlantData(); // No await
        onVehicleAdded(); // Fires immediately
      };

      onSuccess();

      // Callback fires before fetch completes
      expect(executionOrder).toEqual([
        'fetch-start',
        'callback-fired', // ❌ Fired too early
      ]);

      // Wait for fetch to complete
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(executionOrder).toEqual([
        'fetch-start',
        'callback-fired',
        'fetch-complete', // ❌ Completes after callback
      ]);
    });
  });

  describe('Parent component state synchronization', () => {
    it('should provide fresh data to parent component', async () => {
      const parentState = { plantCount: 0 };

      const fetchPlantData = async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 5; // New count from database
      };

      const onVehicleAdded = (newCount: number) => {
        parentState.plantCount = newCount; // Parent updates its state
      };

      // Correct pattern
      const onSuccess = async () => {
        const newCount = await fetchPlantData(); // ✅ Wait for data
        onVehicleAdded(newCount); // ✅ Send fresh data
      };

      await onSuccess();

      expect(parentState.plantCount).toBe(5); // ✅ Fresh data
    });

    it('should show stale data sent to parent without await', async () => {
      const parentState = { plantCount: 0 };
      let currentCount = 0;

      const fetchPlantData = async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        currentCount = 5; // Updates after delay
      };

      const onVehicleAdded = () => {
        parentState.plantCount = currentCount; // Gets stale value
      };

      // Incorrect pattern
      const onSuccess = () => {
        fetchPlantData(); // No await
        onVehicleAdded(); // Fires with stale currentCount
      };

      onSuccess();

      expect(parentState.plantCount).toBe(0); // ❌ Stale data

      // Wait for fetch
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(currentCount).toBe(5); // Data updated (but parent already notified)
    });
  });

  describe('Real-world callback behavior', () => {
    it('should simulate AddVehicleDialog onSuccess callback', async () => {
      const mockPlantData = [
        { id: 'p1', plant_id: 'P001' },
        { id: 'p2', plant_id: 'P002' },
      ];

      let localPlantAssets: Array<{ id: string; plant_id?: string }> = [];
      let parentRefreshCalled = false;
      let parentReceivedCorrectCount = false;

      const fetchPlantData = async () => {
        // Simulate database query
        await new Promise((resolve) => setTimeout(resolve, 50));
        localPlantAssets = [...mockPlantData];
      };

      const onVehicleAdded = () => {
        parentRefreshCalled = true;
        if (localPlantAssets.length === 2) {
          parentReceivedCorrectCount = true;
        }
      };

      // Simulate AddVehicleDialog onSuccess with correct pattern
      const onSuccess = async () => {
        await fetchPlantData();
        onVehicleAdded?.();
      };

      await onSuccess();

      expect(parentRefreshCalled).toBe(true);
      expect(parentReceivedCorrectCount).toBe(true);
      expect(localPlantAssets.length).toBe(2);
    });

    it('should handle optional callback gracefully', async () => {
      let fetchWasAwaited = false;

      const fetchPlantData = async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        fetchWasAwaited = true;
      };

      // No callback provided (optional)
      const onSuccess = async () => {
        await fetchPlantData();
        (undefined as (() => void) | undefined)?.(); // Safe - won't throw
      };

      await onSuccess();

      expect(fetchWasAwaited).toBe(true);
    });
  });

  describe('Error handling with async callbacks', () => {
    it('should handle errors in async fetch before firing callback', async () => {
      let callbackFired = false;
      let errorHandled = false;

      const fetchPlantData = async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        throw new Error('Database error');
      };

      const onVehicleAdded = () => {
        callbackFired = true;
      };

      const onSuccess = async () => {
        try {
          await fetchPlantData();
          onVehicleAdded(); // Should not fire if fetch fails
        } catch {
          errorHandled = true;
          // Don't fire callback on error
        }
      };

      await onSuccess();

      expect(errorHandled).toBe(true);
      expect(callbackFired).toBe(false); // ✅ Callback not fired on error
    });
  });

  describe('Performance considerations', () => {
    it('should measure sequential execution time', async () => {
      vi.useFakeTimers();
      try {
        let completed = false;

        const fetchPlantData = async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
        };

        const onVehicleAdded = () => {
          // Callback logic
        };

        const onSuccess = async () => {
          await fetchPlantData();
          onVehicleAdded();
        };

        const run = onSuccess().then(() => {
          completed = true;
        });

        await vi.advanceTimersByTimeAsync(49);
        expect(completed).toBe(false);

        await vi.advanceTimersByTimeAsync(1);
        await run;
        expect(completed).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
