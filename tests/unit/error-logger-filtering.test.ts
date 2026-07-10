import { describe, expect, it } from 'vitest';
import {
  shouldIgnoreConsoleErrorForLogging,
  shouldIgnoreUnhandledPromiseRejectionForLogging,
  shouldIgnoreRuntimeErrorForLogging,
} from '@/lib/utils/error-logger';

describe('error logger filtering', () => {
  it('ignores generic script errors with no source location', () => {
    expect(shouldIgnoreRuntimeErrorForLogging('Script error.')).toBe(true);
  });

  it('keeps script errors that include a source location', () => {
    expect(shouldIgnoreRuntimeErrorForLogging('Script error.', '/third-party/widget.js')).toBe(false);
  });

  it('ignores generic script errors from minified Next assets', () => {
    expect(shouldIgnoreRuntimeErrorForLogging('Script error.', '/_next/static/chunks/app/page.js')).toBe(true);
  });

  it('ignores stale Next chunk load failures', () => {
    expect(
      shouldIgnoreRuntimeErrorForLogging(
        'Loading chunk 2773 failed.\n(error: https://forest-farm.example.test/_next/static/chunks/2773.js)'
      )
    ).toBe(true);
  });

  it('ignores Next router RSC fetch fallback console noise', () => {
    expect(
      shouldIgnoreConsoleErrorForLogging(
        'Failed to fetch RSC payload for https://your-app.example.com/plant-inspections. Falling back to browser navigation. TypeError: Load failed'
      )
    ).toBe(true);
  });

  it('ignores handled message signing network failures', () => {
    expect(
      shouldIgnoreConsoleErrorForLogging(
        'Error signing message: TypeError: Load failed'
      )
    ).toBe(true);
  });

  it('ignores handled PDF load network failures', () => {
    expect(
      shouldIgnoreConsoleErrorForLogging(
        'Failed to load PDF document: UnknownErrorException: Load failed'
      )
    ).toBe(true);
  });

  it('ignores handled RAMS document fetch network failures', () => {
    expect(
      shouldIgnoreConsoleErrorForLogging(
        'Error fetching RAMS documents: Error: Load failed'
      )
    ).toBe(true);
  });

  it('ignores handled notification fetch network failures', () => {
    expect(
      shouldIgnoreConsoleErrorForLogging(
        'Error fetching notifications: TypeError: Load failed'
      )
    ).toBe(true);
  });

  it('ignores handled timesheet duplicate check network failures', () => {
    expect(
      shouldIgnoreConsoleErrorForLogging(
        'Error checking for existing timesheet: TypeError: Load failed'
      )
    ).toBe(true);
  });

  it('ignores handled timesheet type lookup network failures', () => {
    expect(
      shouldIgnoreConsoleErrorForLogging(
        'Error fetching timesheet type: Error: TypeError: Load failed'
      )
    ).toBe(true);
  });

  it('keeps application type errors without a transient network marker', () => {
    expect(
      shouldIgnoreConsoleErrorForLogging(
        'Error signing message: TypeError: Cannot read properties of undefined'
      )
    ).toBe(false);
  });

  it('ignores unhandled promise rejections caused by message-less browser events', () => {
    const loadEvent = new Event('error');

    expect(shouldIgnoreUnhandledPromiseRejectionForLogging(loadEvent)).toBe(true);
  });

  it('keeps unhandled promise rejections with actionable messages', () => {
    expect(shouldIgnoreUnhandledPromiseRejectionForLogging(new Error('Cannot read properties of undefined'))).toBe(false);
  });
});
