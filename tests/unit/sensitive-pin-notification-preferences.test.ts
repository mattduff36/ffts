import { describe, expect, it } from 'vitest';
import { NOTIFICATION_MODULES } from '@/types/notifications';

describe('sensitive PIN notification preference', () => {
  it('is available only to admins on profile notification settings', () => {
    const notificationModule = NOTIFICATION_MODULES.find((entry) => entry.key === 'sensitive_pin_security');

    expect(notificationModule).toBeDefined();
    expect(notificationModule?.availableFor).toBe('admin');
  });
});
