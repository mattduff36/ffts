/** @vitest-environment happy-dom */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QuoteMarkAsAcceptedDialog } from '@/app/(dashboard)/quotes/components/QuoteMarkAsAcceptedDialog';

describe('QuoteMarkAsAcceptedDialog', () => {
  it('asks whether RAMS are required and offers Yes, No, and Cancel', () => {
    render(
      <QuoteMarkAsAcceptedDialog
        open
        onOpenChange={vi.fn()}
        onAcceptWithoutRams={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { name: 'Are RAMS required for this job?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('closes without progressing when Cancel is chosen', () => {
    const onOpenChange = vi.fn();
    const onAcceptWithoutRams = vi.fn();

    render(
      <QuoteMarkAsAcceptedDialog
        open
        onOpenChange={onOpenChange}
        onAcceptWithoutRams={onAcceptWithoutRams}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onAcceptWithoutRams).not.toHaveBeenCalled();
    expect(screen.queryByText(/still being developed/i)).not.toBeInTheDocument();
  });

  it('progresses without RAMS when No is chosen', () => {
    const onAcceptWithoutRams = vi.fn();

    render(
      <QuoteMarkAsAcceptedDialog
        open
        onOpenChange={vi.fn()}
        onAcceptWithoutRams={onAcceptWithoutRams}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'No' }));

    expect(onAcceptWithoutRams).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/still being developed/i)).not.toBeInTheDocument();
  });

  it('does not progress when Yes is chosen and shows the in-progress message', () => {
    const onOpenChange = vi.fn();
    const onAcceptWithoutRams = vi.fn();

    render(
      <QuoteMarkAsAcceptedDialog
        open
        onOpenChange={onOpenChange}
        onAcceptWithoutRams={onAcceptWithoutRams}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));

    expect(onAcceptWithoutRams).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.getByRole('heading', { name: 'RAMS workflow still being developed' })).toBeInTheDocument();
    expect(screen.getByText(/This workflow is still being developed/)).toBeInTheDocument();
  });
});
