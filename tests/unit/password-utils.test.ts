import { describe, expect, it } from 'vitest';
import { generateSecurePassword, validatePasswordStrength } from '@/lib/utils/password';

describe('password utilities', () => {
  it('generates temporary passwords that always meet strength requirements', () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const password = generateSecurePassword();

      expect(password).toHaveLength(8);
      expect(password.startsWith('TMP')).toBe(true);
      expect(validatePasswordStrength(password).valid).toBe(true);
    }
  });
});
