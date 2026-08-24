/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { handleEnterAdvancesFields } from '@/lib/forms/enter-advances-fields';

function Harness({ onSubmit }: { onSubmit: () => void }) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      onKeyDown={handleEnterAdvancesFields}
    >
      <input aria-label="First" />
      <input aria-label="Second" />
      <textarea aria-label="Notes" />
      <input aria-label="Third" />
      <button type="submit">Save</button>
    </form>
  );
}

describe('handleEnterAdvancesFields', () => {
  it('moves focus to the next field on Enter instead of submitting', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    const first = screen.getByLabelText('First');
    const second = screen.getByLabelText('Second');
    first.focus();
    fireEvent.keyDown(first, { key: 'Enter' });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(second).toHaveFocus();
  });

  it('keeps Enter as a newline in a textarea', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    const notes = screen.getByLabelText('Notes');
    notes.focus();
    fireEvent.keyDown(notes, { key: 'Enter' });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(notes).toHaveFocus();
  });

  it('still submits when the primary button is clicked', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
