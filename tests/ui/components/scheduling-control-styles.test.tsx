import { describe, expect, it } from 'vitest';
import { schedulingControlStyles } from '@/app/(dashboard)/scheduling/components/scheduling-control-styles';

describe('schedulingControlStyles', () => {
  it('pairs every control state with emitted surface, foreground, border and focus classes', () => {
    expect(schedulingControlStyles.primary).toContain('bg-[#34d399]');
    expect(schedulingControlStyles.primary).toContain('text-[#020617]');
    expect(schedulingControlStyles.primary).toContain('border-[#34d399]');
    expect(schedulingControlStyles.primary).toContain('disabled:opacity-100');

    expect(schedulingControlStyles.outline).toContain('bg-[#0f172a]');
    expect(schedulingControlStyles.outline).toContain('text-[#f1f5f9]');
    expect(schedulingControlStyles.ghost).toContain('hover:bg-[#334155]');
    expect(schedulingControlStyles.danger).toContain('bg-[#b91c1c]');
    expect(schedulingControlStyles.warning).toContain('bg-[#fbbf24]');
    expect(schedulingControlStyles.checkbox).toContain(
      'data-[state=checked]:bg-[#34d399]'
    );
  });

  it('does not rely on missing shared semantic color utilities', () => {
    const styles = Object.values(schedulingControlStyles).join(' ');
    expect(styles).not.toMatch(
      /\b(?:bg|text|border)-(?:primary|secondary|background|accent)(?:\b|\/)/
    );
  });
});
