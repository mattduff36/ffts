/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScheduleBoardQuickAddDialog } from '@/app/(dashboard)/scheduling/components/ScheduleBoardQuickAddDialog';

const mockQuickAdd = vi.hoisted(() => vi.fn());

vi.mock('@/lib/client/scheduling', async () => {
  const actual = await vi.importActual<typeof import('@/lib/client/scheduling')>(
    '@/lib/client/scheduling'
  );
  return {
    ...actual,
    quickAddScheduleProject: mockQuickAdd,
  };
});

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe('ScheduleBoardQuickAddDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuickAdd.mockResolvedValue({
      job: {
        id: 'job-1',
        job_reference: '60010-MD',
        title: 'Emergency works',
      },
      visit: {
        id: 'visit-1',
        job_id: 'job-1',
        starts_at: '2026-07-14T08:00:00.000Z',
        ends_at: '2026-07-14T12:00:00.000Z',
      },
      project_number_id: 'project-1',
      project_reference: '60010-MD',
      was_project_created: true,
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        customers: [{
          id: 'customer-1',
          company_name: 'Example Customer',
          sites: [{
            id: 'site-1',
            site_name: 'Main yard',
            is_active: true,
            is_default: true,
          }],
        }],
      }),
    })));
  });

  it('submits one quick-add request with manager, customer, and timed visit', async () => {
    const onCreated = vi.fn();
    render(
      <ScheduleBoardQuickAddDialog
        open
        defaultDate="2026-07-14"
        managerOptions={[{
          profile_id: 'manager-1',
          initials: 'MD',
          is_active: true,
          profile: { full_name: 'Manager One' },
        } as never]}
        onClose={vi.fn()}
        onCreated={onCreated}
      />
    );

    fireEvent.change(screen.getByLabelText('Title *'), {
      target: { value: 'Emergency works' },
    });

    // Open manager select
    fireEvent.click(screen.getAllByRole('combobox')[0]);
    fireEvent.click(await screen.findByRole('option', { name: 'Manager One' }));

    // Open customer select
    fireEvent.click(screen.getAllByRole('combobox')[1]);
    fireEvent.click(await screen.findByRole('option', { name: 'Example Customer' }));

    fireEvent.click(screen.getByRole('button', { name: 'Quick add' }));

    await waitFor(() =>
      expect(mockQuickAdd).toHaveBeenCalledWith(expect.objectContaining({
        manager_profile_id: 'manager-1',
        project_title: 'Emergency works',
        customer_id: 'customer-1',
        start_date: '2026-07-14',
        initial_visit: expect.objectContaining({
          starts_at: expect.any(String),
          ends_at: expect.any(String),
        }),
        request_id: expect.any(String),
      }))
    );
    expect(onCreated).toHaveBeenCalled();
  });
});
