/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScheduleBoardQuickAddDialog } from '@/app/(dashboard)/scheduling/components/ScheduleBoardQuickAddDialog';

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe('ScheduleBoardQuickAddDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('SCHED-INSTANT-002 emits one quick-add intent without awaiting persistence', async () => {
    const onSubmit = vi.fn();
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
        onSubmit={onSubmit}
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

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        manager_profile_id: 'manager-1',
        project_title: 'Emergency works',
        customer_id: 'customer-1',
        start_date: '2026-07-14',
        initial_visit: expect.objectContaining({
          starts_at: expect.any(String),
          ends_at: expect.any(String),
        }),
        request_id: expect.any(String),
      }));
  });
});
