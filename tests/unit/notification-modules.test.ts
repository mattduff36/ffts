import { describe, expect, it } from 'vitest';
import {
  canDisableNotificationModule,
  getAvailableNotificationModules,
  NOTIFICATION_MODULE_KEYS,
  NOTIFICATION_MODULES,
} from '@/types/notifications';

function keysFor(context: Parameters<typeof getAvailableNotificationModules>[0]) {
  return getAvailableNotificationModules(context).map((module) => module.key);
}

describe('notification module settings', () => {
  it('has preference metadata for every supported notification module key', () => {
    const moduleKeys = NOTIFICATION_MODULES.map((module) => module.key);

    expect(moduleKeys).toEqual(NOTIFICATION_MODULE_KEYS);
    expect(new Set(moduleKeys).size).toBe(NOTIFICATION_MODULE_KEYS.length);
  });

  it('shows employee-safe notification categories by default', () => {
    const moduleKeys = keysFor({
      isAdmin: false,
      isManager: false,
      permissionLevels: null,
    });

    expect(moduleKeys).toContain('toolbox_talks');
    expect(moduleKeys).toContain('reminders');
    expect(moduleKeys).toContain('general_notifications');
    expect(moduleKeys).not.toContain('errors');
    expect(moduleKeys).not.toContain('rams');
    expect(moduleKeys).not.toContain('approvals');
    expect(moduleKeys).not.toContain('sensitive_pin_security');
  });

  it('shows role-restricted categories when module permissions grant access', () => {
    const moduleKeys = keysFor({
      isAdmin: false,
      isManager: false,
      permissionLevels: {
        'error-reports': 1,
        'admin-settings': 4,
        approvals: 3,
        rams: 3,
      },
    });

    expect(moduleKeys).toContain('errors');
    expect(moduleKeys).toContain('rams');
    expect(moduleKeys).toContain('approvals');
    expect(moduleKeys).toContain('sensitive_pin_security');
  });

  it('keeps elevated categories hidden below their permission thresholds', () => {
    const moduleKeys = keysFor({
      isAdmin: false,
      isManager: false,
      permissionLevels: {
        'error-reports': 0,
        'admin-settings': 3,
        approvals: 2,
        rams: 2,
      },
    });

    expect(moduleKeys).not.toContain('errors');
    expect(moduleKeys).not.toContain('rams');
    expect(moduleKeys).not.toContain('approvals');
    expect(moduleKeys).not.toContain('sensitive_pin_security');
  });

  it('treats Toolbox Talks as a required notification module', () => {
    expect(canDisableNotificationModule('toolbox_talks')).toBe(false);
    expect(canDisableNotificationModule('reminders')).toBe(true);
  });
});
