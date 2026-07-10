import { describe, expect, it } from 'vitest';
import { DEBUG_NOTIFICATION_SETTINGS_MODULES } from '@/app/(dashboard)/debug/components/NotificationSettingsDebugPanel';
import { NOTIFICATION_MODULES } from '@/types/notifications';

describe('NotificationSettingsDebugPanel module list', () => {
  it('uses the shared notification module registry', () => {
    expect(DEBUG_NOTIFICATION_SETTINGS_MODULES.map((module) => module.key)).toEqual(
      NOTIFICATION_MODULES.map((module) => module.key)
    );
  });
});
