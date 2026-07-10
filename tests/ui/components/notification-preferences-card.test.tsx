/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NotificationPreferencesCard } from '@/components/notifications/NotificationPreferencesCard';
import {
  NOTIFICATION_MODULES,
  type NotificationModule,
  type NotificationPreference,
} from '@/types/notifications';

function getModule(key: NotificationModule['key']) {
  const notificationModule = NOTIFICATION_MODULES.find((entry) => entry.key === key);
  if (!notificationModule) throw new Error(`Missing notification module: ${key}`);
  return notificationModule;
}

function makePreference(
  moduleKey: NotificationModule['key'],
  overrides: Partial<NotificationPreference> = {}
): NotificationPreference {
  return {
    id: `pref-${moduleKey}`,
    user_id: 'user-1',
    module_key: moduleKey,
    enabled: true,
    notify_in_app: true,
    notify_email: true,
    created_at: '2026-06-04T10:00:00.000Z',
    updated_at: '2026-06-04T10:00:00.000Z',
    ...overrides,
  };
}

describe('NotificationPreferencesCard', () => {
  it('renders every provided current notification category', () => {
    render(
      <NotificationPreferencesCard
        modules={NOTIFICATION_MODULES}
        preferences={[]}
        isLoadingPreferences={false}
        savingPreferenceModules={[]}
        onTogglePreference={vi.fn()}
      />
    );

    for (const notificationModule of NOTIFICATION_MODULES) {
      expect(screen.getByText(notificationModule.label)).toBeInTheDocument();
    }
  });

  it('sends the intended module key and channel field when toggles are clicked', () => {
    const onTogglePreference = vi.fn();

    render(
      <NotificationPreferencesCard
        modules={[getModule('reminders')]}
        preferences={[makePreference('reminders', { notify_in_app: false, notify_email: true })]}
        isLoadingPreferences={false}
        savingPreferenceModules={[]}
        onTogglePreference={onTogglePreference}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /in-app off/i }));
    fireEvent.click(screen.getByRole('button', { name: /email on/i }));

    expect(onTogglePreference).toHaveBeenNthCalledWith(1, 'reminders', 'notify_in_app', true);
    expect(onTogglePreference).toHaveBeenNthCalledWith(2, 'reminders', 'notify_email', false);
  });

  it('defaults missing saved preferences to enabled before toggling', () => {
    const onTogglePreference = vi.fn();

    render(
      <NotificationPreferencesCard
        modules={[getModule('quotes')]}
        preferences={[]}
        isLoadingPreferences={false}
        savingPreferenceModules={[]}
        onTogglePreference={onTogglePreference}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /in-app on/i }));

    expect(onTogglePreference).toHaveBeenCalledWith('quotes', 'notify_in_app', false);
  });

  it('hides channel toggles when the current user cannot disable notifications', () => {
    const onTogglePreference = vi.fn();

    render(
      <NotificationPreferencesCard
        modules={[getModule('reminders')]}
        preferences={[]}
        isLoadingPreferences={false}
        savingPreferenceModules={[]}
        canDisableNotifications={false}
        onTogglePreference={onTogglePreference}
      />
    );

    expect(screen.queryByRole('button', { name: /in-app on/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /email on/i })).not.toBeInTheDocument();
    expect(screen.getByText(/supervisors and above/i)).toBeInTheDocument();
    expect(onTogglePreference).not.toHaveBeenCalled();
  });

  it('keeps Toolbox Talk notification controls locked for everyone', () => {
    const onTogglePreference = vi.fn();

    render(
      <NotificationPreferencesCard
        modules={[getModule('toolbox_talks')]}
        preferences={[]}
        isLoadingPreferences={false}
        savingPreferenceModules={[]}
        canDisableNotifications
        onTogglePreference={onTogglePreference}
      />
    );

    expect(screen.queryByRole('button', { name: /in-app on/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /email on/i })).not.toBeInTheDocument();
    expect(screen.getByText(/required and cannot be disabled/i)).toBeInTheDocument();
  });
});
