import { describe, expect, it } from 'vitest';
import {
  getUsageModuleFromPath,
  isUserUsageEventName,
  sanitizeAnalyticsMetadata,
} from '@/lib/analytics/events';

describe('user analytics event helpers', () => {
  it('allowlists usage event names', () => {
    expect(isUserUsageEventName('page_view')).toBe(true);
    expect(isUserUsageEventName('typed_password')).toBe(false);
  });

  it('redacts sensitive metadata fields before storage', () => {
    const sanitized = sanitizeAnalyticsMetadata({
      action: 'submit',
      password: 'secret',
      nested: {
        authToken: 'token',
        safe: 'value',
      },
    });

    expect(sanitized).toEqual({
      action: 'submit',
      password: '[redacted]',
      nested: {
        authToken: '[redacted]',
        safe: 'value',
      },
    });
  });

  it('derives stable modules from tracked paths', () => {
    expect(getUsageModuleFromPath('/timesheets/new?tab=current')).toBe('timesheets');
    expect(getUsageModuleFromPath('/admin/users?tab=roles')).toBe('admin/users');
    expect(getUsageModuleFromPath('/absence/manage?tab=allowances')).toBe('absence/manage');
  });
});
