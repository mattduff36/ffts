/** @vitest-environment happy-dom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TestFleetDebugPanel } from '@/app/(dashboard)/debug/components/TestFleetDebugPanel';

const { toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}));

const testVehicles = [
  {
    id: 'van-1',
    reg_number: 'TE57 ABC',
    nickname: 'Test Van',
    status: 'active',
    fleet_type: 'van' as const,
  },
];

describe('TestFleetDebugPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url === '/api/debug/test-vehicles?prefix=TE57&type=all') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            vehicles: testVehicles,
          }),
        } as Response;
      }

      if (url === '/api/debug/test-vehicles' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        expect(body).toEqual({
          mode: 'execute',
          vehicle_ids: ['van-1'],
          prefix: 'TE57',
          actions: {
            inspections: true,
            workshop_tasks: true,
            maintenance: true,
            attachments: true,
            archives: true,
          },
          fleet_type: 'vans',
        });

        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            affected_vehicles: 1,
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
  });

  it('requires a timed second click before quick purging TE57 assets', async () => {
    render(<TestFleetDebugPanel />);

    await waitFor(() => {
      expect(screen.getByText('TE57 ABC')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /quick purge te57 assets/i }));

    expect(screen.getByRole('button', { name: /confirm purge of te57 assets/i })).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /confirm purge of te57 assets/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(4);
    });

    expect(global.fetch).toHaveBeenNthCalledWith(1, '/api/debug/test-vehicles?prefix=TE57&type=all');
    expect(global.fetch).toHaveBeenNthCalledWith(
      3,
      '/api/debug/test-vehicles',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(4, '/api/debug/test-vehicles?prefix=TE57&type=all');
    expect(toastSuccessMock).toHaveBeenCalledWith('Purged records for 1 fleet item(s)');
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it('resets the quick purge confirm label after a few seconds', async () => {
    vi.useFakeTimers();
    try {
      render(<TestFleetDebugPanel />);
      await act(async () => {
        await Promise.resolve();
      });

      fireEvent.click(screen.getByRole('button', { name: /quick purge te57 assets/i }));
      expect(screen.getByRole('button', { name: /confirm purge of te57 assets/i })).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });

      expect(screen.getByRole('button', { name: /quick purge te57 assets/i })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses fixed TE57 loading controls without exposing a prefix field or extra load button', async () => {
    render(<TestFleetDebugPanel />);

    await waitFor(() => {
      expect(screen.getByText('TE57 ABC')).toBeInTheDocument();
    });

    expect(screen.queryByLabelText(/fleet registration prefix/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^load fleet$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /quick purge te57 assets/i })).toBeInTheDocument();
    expect(global.fetch).toHaveBeenNthCalledWith(1, '/api/debug/test-vehicles?prefix=TE57&type=all');
  });

  it('shows bordered destructive purge buttons', async () => {
    render(<TestFleetDebugPanel />);

    await waitFor(() => {
      expect(screen.getByText('TE57 ABC')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /quick purge te57 assets/i }).className).toContain('border-red-500/60');

    fireEvent.click(screen.getByRole('button', { name: /^select all$/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /purge selected records/i }).className).toContain('border-red-500/60');
    });
  });

  it('allows direct checkbox clicks as well as row clicks', async () => {
    render(<TestFleetDebugPanel />);

    await waitFor(() => {
      expect(screen.getByText('TE57 ABC')).toBeInTheDocument();
    });

    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;

    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
    expect(screen.getByText('Select Fleet (1 of 1 selected)')).toBeInTheDocument();

    fireEvent.click(screen.getByText('TE57 ABC'));
    expect(checkbox.checked).toBe(false);
    expect(screen.getByText('Select Fleet (0 of 1 selected)')).toBeInTheDocument();
  });

  it('keeps hard delete disabled until selected records have been purged', async () => {
    render(<TestFleetDebugPanel />);

    await waitFor(() => {
      expect(screen.getByText('TE57 ABC')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /^select all$/i }));
    expect(screen.getByRole('button', { name: /hard delete fleet/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /quick purge te57 assets/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm purge of te57 assets/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /hard delete fleet/i })).not.toBeDisabled();
    });
  });
});
