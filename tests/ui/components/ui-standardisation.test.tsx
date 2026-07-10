import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DataViewToggle } from '@/components/ui/data-view-controls';
import { dialogContentViewportClassName } from '@/components/ui/dialog';

describe('UI standardisation helpers', () => {
  it('composes viewport-safe dialog classes with size variants', () => {
    const className = dialogContentViewportClassName({
      size: '3xl',
      className: 'border-border text-white',
    });

    expect(className).toContain('max-h-[calc(100dvh-1rem)]');
    expect(className).toContain('w-[calc(100vw-1rem)]');
    expect(className).toContain('overflow-y-auto');
    expect(className).toContain('max-w-3xl');
    expect(className).toContain('border-border');
    expect(className).toContain('text-white');
  });

  it('keeps table/card view toggle callbacks generic', () => {
    const onValueChange = vi.fn();

    render(<DataViewToggle value="table" onValueChange={onValueChange} />);

    fireEvent.click(screen.getByRole('button', { name: /cards/i }));

    expect(onValueChange).toHaveBeenCalledWith('cards');
  });
});
