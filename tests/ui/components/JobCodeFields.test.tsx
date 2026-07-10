/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CSSProperties, ReactNode } from 'react';
import { JobCodeFields, JobCodePicker } from '@/components/timesheets/JobCodeFields';
import type { TimesheetJobCodeOption } from '@/lib/client/timesheet-job-codes';

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: ReactNode; open?: boolean }) => (
    open ? <div data-testid="job-code-dialog">{children}</div> : null
  ),
  DialogContent: ({
    children,
    className,
    style,
  }: {
    children: ReactNode;
    className?: string;
    style?: CSSProperties;
  }) => (
    <div
      className={className}
      data-testid="job-code-dialog-panel"
      data-top-style={String(style?.top || '')}
    >
      {children}
    </div>
  ),
  DialogTitle: ({ children, className }: { children: ReactNode; className?: string }) => (
    <h2 className={className}>{children}</h2>
  ),
}));

describe('JobCodeFields', () => {
  const jobCodeOptions: TimesheetJobCodeOption[] = [
    {
      value: '40001-GH',
      label: '40001-GH',
      customerName: 'Omexom',
      quoteTitle: 'Cable repairs',
      source: 'live_quote',
    },
    {
      value: '4323-GH',
      label: '4323-GH',
      customerName: 'Saint Gobain East Leake',
      quoteTitle: 'ATV hire',
      source: 'legacy_quote',
    },
  ];

  it('selects an active quote job code from the modal picker', () => {
    const handleChange = vi.fn();

    render(
      <JobCodeFields
        values={[]}
        onChange={handleChange}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        placeholder="Select job code"
        jobCodeOptions={jobCodeOptions}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select job code' }));
    fireEvent.change(screen.getByPlaceholderText('Search code, customer, or name'), {
      target: { value: '400' },
    });
    fireEvent.click(screen.getByRole('button', { name: /40001-GH/ }));

    expect(handleChange).toHaveBeenCalledWith(0, '40001-GH');
  });

  it('requires at least three characters before showing filtered results', () => {
    const handleChange = vi.fn();

    render(
      <JobCodeFields
        values={[]}
        onChange={handleChange}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        placeholder="Select job code"
        jobCodeOptions={jobCodeOptions}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select job code' }));
    expect(screen.getByText('Start typing a job code, customer, or quote name to filter the list.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /4323-GH/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search code, customer, or name'), {
      target: { value: 'sa' },
    });
    expect(screen.queryByRole('button', { name: /4323-GH/ })).not.toBeInTheDocument();
  });

  it('shows square add and remove controls only after a primary code is selected', () => {
    const handleAdd = vi.fn();
    const handleRemove = vi.fn();
    const { rerender } = render(
      <JobCodeFields
        values={[]}
        onChange={vi.fn()}
        onAdd={handleAdd}
        onRemove={handleRemove}
        placeholder="Select job code"
        jobCodeOptions={jobCodeOptions}
      />
    );

    expect(screen.queryByRole('button', { name: 'Add another job code' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove job code 1' })).not.toBeInTheDocument();

    rerender(
      <JobCodeFields
        values={['40001-GH']}
        onChange={vi.fn()}
        onAdd={handleAdd}
        onRemove={handleRemove}
        placeholder="Select job code"
        jobCodeOptions={jobCodeOptions}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove job code 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add another job code' }));
    expect(handleRemove).toHaveBeenCalledWith(0);
    expect(handleAdd).not.toHaveBeenCalled();
  });

  it('shows delete on every populated row and add only on the last row', () => {
    render(
      <JobCodeFields
        values={['40001-GH', '4323-GH']}
        onChange={vi.fn()}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        placeholder="Select job code"
        jobCodeOptions={jobCodeOptions}
      />
    );

    expect(screen.getByRole('button', { name: 'Remove job code 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove job code 2' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add another job code' })).toHaveLength(1);
  });

  it('opens the picker for a newly added row and removes it when closed empty', async () => {
    const handleChange = vi.fn();
    const handleRemove = vi.fn();
    render(
      <JobCodeFields
        values={['40001-GH']}
        onChange={handleChange}
        onAdd={vi.fn()}
        onRemove={handleRemove}
        placeholder="Select job code"
        jobCodeOptions={jobCodeOptions}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add another job code' }));

    await waitFor(() => expect(screen.getByTestId('job-code-dialog')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Select job code' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close job code search' }));

    expect(handleRemove).not.toHaveBeenCalled();
    expect(handleChange).not.toHaveBeenCalled();
  });

  it('writes a newly selected job code into the next index', async () => {
    const handleChange = vi.fn();
    render(
      <JobCodeFields
        values={['40001-GH']}
        onChange={handleChange}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        placeholder="Select job code"
        jobCodeOptions={jobCodeOptions}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add another job code' }));
    await waitFor(() => expect(screen.getByTestId('job-code-dialog')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('Search code, customer, or name'), {
      target: { value: 'gob' },
    });
    fireEvent.click(screen.getByRole('button', { name: /4323-GH/ }));

    expect(handleChange).toHaveBeenCalledWith(1, '4323-GH');
  });

  it('closes the picker from the inline close button', () => {
    const handleChange = vi.fn();

    render(
      <JobCodeFields
        values={[]}
        onChange={handleChange}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        placeholder="Select job code"
        jobCodeOptions={jobCodeOptions}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select job code' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close job code search' }));

    expect(screen.queryByTestId('job-code-dialog')).not.toBeInTheDocument();
  });

  it('positions the picker below the mobile safe area', () => {
    render(
      <JobCodeFields
        values={[]}
        onChange={vi.fn()}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        placeholder="Select job code"
        jobCodeOptions={jobCodeOptions}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select job code' }));

    expect(screen.getByTestId('job-code-dialog-panel')).toHaveClass(
      'top-[calc(env(safe-area-inset-top,0px)+0.5rem)]'
    );
    expect(screen.getByTestId('job-code-dialog-panel')).toHaveAttribute(
      'data-top-style',
      'max(8px, calc(env(safe-area-inset-top, 0px) + 8px))'
    );
  });

  it('filters and selects a legacy job code by customer or quote name', () => {
    const handleChange = vi.fn();

    render(
      <JobCodeFields
        values={[]}
        onChange={handleChange}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        placeholder="Select job code"
        jobCodeOptions={jobCodeOptions}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select job code' }));
    fireEvent.change(screen.getByPlaceholderText('Search code, customer, or name'), {
      target: { value: 'gob' },
    });

    expect(screen.getByText('Saint Gobain East Leake - ATV hire')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /4323-GH/ }));

    expect(handleChange).toHaveBeenCalledWith(0, '4323-GH');
    expect(screen.queryByTestId('job-code-dialog')).not.toBeInTheDocument();
  });

  it('supports server-side search options in the single job-code picker', () => {
    const handleChange = vi.fn();
    const handleSearchChange = vi.fn();

    render(
      <JobCodePicker
        value=""
        onChange={handleChange}
        placeholder="Select stored code"
        jobCodeOptions={[jobCodeOptions[1]]}
        onSearchChange={handleSearchChange}
        serverSideFiltering
        ariaLabel="Select stored source job code"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select stored source job code' }));
    fireEvent.change(screen.getByPlaceholderText('Search code, customer, or name'), {
      target: { value: 'incorrect code' },
    });

    expect(handleSearchChange).toHaveBeenLastCalledWith('incorrect code');
    fireEvent.click(screen.getByRole('button', { name: /4323-GH/ }));
    expect(handleChange).toHaveBeenCalledWith('4323-GH');
  });
});
