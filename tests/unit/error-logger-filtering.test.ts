import { describe, expect, it } from 'vitest';
import {
  shouldIgnoreConsoleErrorForLogging,
  shouldIgnoreRuntimeErrorForLogging,
} from '@/lib/utils/error-logger';

describe('error logger filtering', () => {
  it('ignores generic script errors with no source location', () => {
    expect(shouldIgnoreRuntimeErrorForLogging('Script error.')).toBe(true);
  });

  it('keeps script errors that include a source location', () => {
    expect(shouldIgnoreRuntimeErrorForLogging('Script error.', '/_next/static/chunk.js')).toBe(false);
  });

  it('ignores Next router RSC fetch fallback console noise', () => {
    expect(
      shouldIgnoreConsoleErrorForLogging(
        'Failed to fetch RSC payload for https://your-app.example.com/plant-inspections. Falling back to browser navigation. TypeError: Load failed'
      )
    ).toBe(true);
  });
});
