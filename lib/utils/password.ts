/**
 * Password generation and management utilities
 */

function getSecureRandomIndex(max: number): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] % max;
}

function pickRandomCharacter(characters: string): string {
  return characters[getSecureRandomIndex(characters.length)];
}

function shuffleCharacters(characters: string[]): string[] {
  const result = [...characters];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = getSecureRandomIndex(index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
}

/**
 * Generate a secure random password
 * Format: TMP + 5 random characters (e.g., "TMPfeh5J")
 * - Always starts with "TMP"
 * - Always contains at least one lowercase letter and one number
 * - Followed by 5 random letters (upper/lower) and numbers
 * - Total length: 8 characters
 */
export function generateSecurePassword(): string {
  const lowercaseCharacters = 'abcdefghijklmnopqrstuvwxyz';
  const mixedCharacters = `${lowercaseCharacters}ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789`;
  const numericCharacters = '0123456789';

  const requiredCharacters = [
    pickRandomCharacter(lowercaseCharacters),
    pickRandomCharacter(numericCharacters),
    pickRandomCharacter(mixedCharacters),
    pickRandomCharacter(mixedCharacters),
    pickRandomCharacter(mixedCharacters),
  ];

  return `TMP${shuffleCharacters(requiredCharacters).join('')}`;
}

/**
 * Validate password strength
 * Requirements:
 * - At least 8 characters
 * - Contains uppercase
 * - Contains lowercase
 * - Contains number
 */
export function validatePasswordStrength(password: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }
  
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Format password requirements for display
 */
export function getPasswordRequirements(): string[] {
  return [
    'At least 8 characters long',
    'Contains at least one uppercase letter',
    'Contains at least one lowercase letter',
    'Contains at least one number'
  ];
}

