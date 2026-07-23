/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SampleDataDebugPanel } from '@/app/(dashboard)/debug/components/SampleDataDebugPanel';

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock('sonner', () => ({
  toast: {
    success: toastSuccess,
    error: toastError,
  },
}));

const scheduling = {
  fixtureKey: 'scheduling-sample-v1',
  label: 'Scheduling Sample Data',
  description: 'Scheduling fixture',
  toolingVersion: 'v1',
  state: 'absent',
  available: true,
  expected: { base_quotes: 22, queue_quotes: 12 },
  observed: { base_quotes: 0, queue_quotes: 0 },
  blockers: [],
  availabilityReason: null,
  variants: {
    base: { state: 'absent', expected: { quotes: 22 }, observed: { quotes: 0 } },
    queue: { state: 'absent', expected: { quotes: 12 }, observed: { quotes: 0 } },
  },
  lastOperation: null,
};

const fleet = {
  fixtureKey: 'fleet-inventory-sample-v1',
  label: 'Fleet and Inventory Sample Data',
  description: 'Fleet fixture',
  toolingVersion: 'v1',
  state: 'absent',
  available: true,
  expected: { plant_rows: 18, inventory_rows: 20 },
  observed: { plant_rows: 0, inventory_rows: 0 },
  blockers: [],
  availabilityReason: null,
  lastOperation: null,
};

const registry = {
  generatedAt: '2026-07-23T19:00:00.000Z',
  fixtures: [scheduling, fleet],
  clearAll: {
    canRemove: true,
    blockers: [],
    fixtureKeys: [
      'scheduling-sample-v1',
      'fleet-inventory-sample-v1',
    ],
  },
};

function response(payload: unknown, ok = true) {
  return {
    ok,
    json: vi.fn().mockResolvedValue(payload),
  };
}

describe('SampleDataDebugPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response({ success: true, status: registry }))
    );
  });

  it('shows only the two managed fixture keys and explicit exclusions', async () => {
    render(<SampleDataDebugPanel />);

    expect(await screen.findByText('Scheduling Sample Data')).toBeInTheDocument();
    expect(screen.getByText('Fleet and Inventory Sample Data')).toBeInTheDocument();
    expect(
      screen.getByText(/Historical samples, testsuite users, operational seeds and unmanaged ZZ99 records are excluded/i)
    ).toBeInTheDocument();
    expect(screen.queryByText('Quick Purge ZZ99 Assets')).not.toBeInTheDocument();
  });

  it('offers Base, Queue and Complete Scheduling actions', async () => {
    render(<SampleDataDebugPanel />);
    await screen.findByText('Scheduling Sample Data');

    expect(screen.getByRole('button', { name: 'Create Base' })).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Create Queue Extension' })
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Create Complete Sample Set' })
    ).toBeEnabled();
  });

  it('requires the exact typed phrase before executing a fresh preview', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(response({ success: true, status: registry }) as never)
      .mockResolvedValueOnce(
        response({
          success: true,
          preview: {
            fixtureKey: 'scheduling-sample-v1',
            action: 'create-complete',
            confirmationPhrase: 'CREATE COMPLETE SCHEDULING SAMPLE SET',
            fingerprint: 'signed-preview',
            expiresAt: '2026-07-23T20:00:00.000Z',
            status: scheduling,
            blockers: [],
            canExecute: true,
          },
        }) as never
      )
      .mockResolvedValueOnce(
        response({
          success: true,
          result: {
            success: true,
            outcome: 'succeeded',
            fixtureKey: 'scheduling-sample-v1',
            action: 'create-complete',
            message: 'Scheduling sample data created.',
            completedFixtures: ['scheduling-sample-v1'],
            failedFixture: null,
            recovery: null,
            status: registry,
          },
        }) as never
      );

    render(<SampleDataDebugPanel />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Create Complete Sample Set' })
    );

    const executeButton = await screen.findByRole('button', {
      name: 'Execute exact operation',
    });
    expect(executeButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Typed confirmation'), {
      target: { value: 'CREATE COMPLETE SCHEDULING SAMPLE SET' },
    });
    expect(executeButton).toBeEnabled();
    fireEvent.click(executeButton);

    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith('Scheduling sample data created.');
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/debug/sample-data/execute',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          fixtureKey: 'scheduling-sample-v1',
          action: 'create-complete',
          confirmation: 'CREATE COMPLETE SCHEDULING SAMPLE SET',
          fingerprint: 'signed-preview',
        }),
      })
    );
  });

  it('disables Clear All when any fixture preflight is blocked', async () => {
    const blockedRegistry = {
      ...registry,
      clearAll: {
        ...registry.clearAll,
        canRemove: false,
        blockers: ['Scheduling Sample Data: plant assignments: 1'],
      },
    };
    vi.mocked(fetch).mockResolvedValue(
      response({ success: true, status: blockedRegistry }) as never
    );
    render(<SampleDataDebugPanel />);

    expect(
      await screen.findByRole('button', {
        name: 'Clear All Managed Sample Data',
      })
    ).toBeDisabled();
    expect(
      screen.getByText(/Scheduling Sample Data: plant assignments: 1/)
    ).toBeInTheDocument();
  });
});
