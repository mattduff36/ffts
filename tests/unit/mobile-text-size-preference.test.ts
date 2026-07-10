import { describe, expect, it } from 'vitest';
import {
  MOBILE_TEXT_SIZE_DEFAULT_STEP,
  applyMobileTextSizePreference,
  normalizeMobileTextSizeStep,
} from '@/lib/config/mobile-text-size-preference';

describe('mobile text size preference helpers', () => {
  it('normalizes valid text size steps', () => {
    expect(normalizeMobileTextSizeStep(1)).toBe(1);
    expect(normalizeMobileTextSizeStep('2')).toBe(2);
    expect(normalizeMobileTextSizeStep(5)).toBe(5);
  });

  it('falls back to the default step for invalid values', () => {
    expect(normalizeMobileTextSizeStep(null)).toBe(MOBILE_TEXT_SIZE_DEFAULT_STEP);
    expect(normalizeMobileTextSizeStep(0)).toBe(MOBILE_TEXT_SIZE_DEFAULT_STEP);
    expect(normalizeMobileTextSizeStep(6)).toBe(MOBILE_TEXT_SIZE_DEFAULT_STEP);
    expect(normalizeMobileTextSizeStep('large')).toBe(MOBILE_TEXT_SIZE_DEFAULT_STEP);
  });

  it('writes the normalized step to the supplied element dataset', () => {
    const target = { dataset: {} } as HTMLElement;

    applyMobileTextSizePreference(5, target);
    expect(target.dataset.mobileTextSize).toBe('5');
  });
});
