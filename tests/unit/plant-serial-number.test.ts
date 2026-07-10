import { describe, expect, it } from 'vitest';

import { validateAndNormalizePlantSerialNumber } from '@/lib/utils/plant-serial-number';

describe('validateAndNormalizePlantSerialNumber', () => {
  it('normalizes optional serial numbers for plant creation', () => {
    expect(validateAndNormalizePlantSerialNumber(' ab 123 ')).toEqual({
      value: 'AB123',
      valid: true,
    });
  });

  it('allows blank serial numbers', () => {
    expect(validateAndNormalizePlantSerialNumber('   ')).toEqual({
      value: null,
      valid: true,
    });
  });

  it('rejects non-alphanumeric serial numbers', () => {
    expect(validateAndNormalizePlantSerialNumber('AB-123')).toEqual({
      value: 'AB-123',
      valid: false,
      error: 'Serial Number must contain only letters and numbers',
    });
  });
});
