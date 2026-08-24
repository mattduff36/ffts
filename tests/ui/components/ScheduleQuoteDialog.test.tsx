/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ScheduleQuoteDialog } from '@/app/(dashboard)/scheduling/components/ScheduleQuoteDialog';
import type { ScheduleJob } from '@/types/scheduling';

const quoteJob: ScheduleJob = {
  id: 'job-1',
  job_reference: 'Q-1001',
  title: 'Fence repairs',
  description: null,
  site_address: null,
  status: 'scheduled',
  source_type: 'quote',
  start_date: '2026-08-01',
  end_date: '2026-08-05',
  estimated_duration_minutes: null,
  quote_id: 'quote-1',
  quote_project_number_id: null,
  customer_id: null,
  customer_site_id: null,
  customer_name: 'Acme Ltd',
  is_drop_on_ready: false,
  tags: [],
  created_by: null,
  updated_by: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('ScheduleQuoteDialog', () => {
  it('keeps dirty reschedule values and requires discard after an outside close', () => {
    const onOpenChange = vi.fn();

    render(
      <ScheduleQuoteDialog
        open
        job={quoteJob}
        onOpenChange={onOpenChange}
        onSubmit={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText('Start date'), {
      target: { value: '2026-08-03' },
    });

    expect(screen.getByRole('button', { name: 'Discard Changes' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Start date')).toHaveValue('2026-08-03');

    fireEvent.click(screen.getByRole('button', { name: 'Discard Changes' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
