import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { NumericInputBehavior } from '@/components/layout/NumericInputBehavior';
import { Input } from '@/components/ui/input';

function CoercedZeroField({
  onChange,
  onBlur,
}: {
  onChange?: (value: string) => void;
  onBlur?: () => void;
}) {
  const [value, setValue] = useState(0);

  return (
    <Input
      aria-label="Quantity"
      type="number"
      value={value}
      onChange={(event) => {
        onChange?.(event.target.value);
        const raw = event.target.value;
        setValue(raw === '' ? 0 : Number(raw));
      }}
      onBlur={() => onBlur?.()}
    />
  );
}

describe('controlled numeric Input', () => {
  it('lets a cleared zero be typed as 100 without a forced leading zero', () => {
    const onChange = vi.fn();
    render(<CoercedZeroField onChange={onChange} />);
    const input = screen.getByRole('spinbutton', { name: 'Quantity' });

    expect(input).toHaveValue(0);

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    expect(input).toHaveValue(null);
    expect(onChange).toHaveBeenLastCalledWith('');

    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.change(input, { target: { value: '10' } });
    fireEvent.change(input, { target: { value: '100' } });

    expect(input).toHaveValue(100);
    expect(onChange.mock.calls.map(([value]) => value)).toEqual(['', '1', '10', '100']);
  });

  it('reconciles an empty numeric draft to the parent value on blur', () => {
    const onChange = vi.fn();
    const onBlur = vi.fn();
    render(<CoercedZeroField onChange={onChange} onBlur={onBlur} />);
    const input = screen.getByRole('spinbutton', { name: 'Quantity' });

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    expect(input).toHaveValue(null);

    fireEvent.blur(input);

    expect(onBlur).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue(0);
  });

  it('shows a genuine external value while a local draft is active', () => {
    function Harness() {
      const [value, setValue] = useState<number>(1);

      return (
        <>
          <Input
            aria-label="Amount"
            type="number"
            value={value}
            onChange={(event) => {
              const raw = event.target.value;
              setValue(raw === '' ? 0 : Number(raw));
            }}
          />
          <button type="button" onClick={() => setValue(42)}>
            Set external
          </button>
        </>
      );
    }

    render(<Harness />);
    const input = screen.getByRole('spinbutton', { name: 'Amount' });

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '3' } });
    expect(input).toHaveValue(3);

    fireEvent.click(screen.getByRole('button', { name: 'Set external' }));
    expect(input).toHaveValue(42);
  });

  it('applies an external value when the field is not being edited', () => {
    const { rerender } = render(<Input aria-label="Amount" type="number" value={1} onChange={() => undefined} />);
    rerender(<Input aria-label="Amount" type="number" value={8} onChange={() => undefined} />);

    expect(screen.getByRole('spinbutton', { name: 'Amount' })).toHaveValue(8);
  });

  it('leaves non-numeric input unchanged', () => {
    function Harness() {
      const [value, setValue] = useState('keep');

      return (
        <Input
          aria-label="Note"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      );
    }

    render(<Harness />);
    const input = screen.getByRole('textbox', { name: 'Note' });

    fireEvent.change(input, { target: { value: 'keep me' } });

    expect(input).toHaveValue('keep me');
    expect((input as HTMLInputElement).type).toBe('text');
  });
});

describe('NumericInputBehavior', () => {
  it('blocks wheel changes on number inputs and scrolls the page instead', () => {
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    render(<NumericInputBehavior />);
    const input = document.createElement('input');
    input.type = 'number';
    input.value = '5';
    document.body.appendChild(input);

    const event = new WheelEvent('wheel', { deltaY: 40, bubbles: true, cancelable: true });
    input.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(input.value).toBe('5');
    expect(scrollBy).toHaveBeenCalledWith(0, 40);

    input.remove();
    scrollBy.mockRestore();
  });

  it('does not intercept keyboard changes or modified wheel zoom', () => {
    render(<NumericInputBehavior />);
    const input = document.createElement('input');
    input.type = 'number';
    document.body.appendChild(input);

    const textInput = document.createElement('input');
    textInput.type = 'text';
    document.body.appendChild(textInput);

    const keyEvent = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true });
    const textWheelEvent = new WheelEvent('wheel', { deltaY: 40, bubbles: true, cancelable: true });
    const zoomEvent = new WheelEvent('wheel', {
      deltaY: 40,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(zoomEvent, 'ctrlKey', { value: true });

    input.dispatchEvent(keyEvent);
    textInput.dispatchEvent(textWheelEvent);
    input.dispatchEvent(zoomEvent);

    expect(keyEvent.defaultPrevented).toBe(false);
    expect(textWheelEvent.defaultPrevented).toBe(false);
    expect(zoomEvent.ctrlKey).toBe(true);
    expect(zoomEvent.defaultPrevented).toBe(false);

    input.remove();
    textInput.remove();
  });
});
