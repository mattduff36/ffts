/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationPanel } from '@/components/messages/NotificationPanel';
import type { NotificationItem } from '@/types/messages';

const pushMock = vi.hoisted(() => vi.fn());

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({
    push: pushMock,
  }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

function makeNotification(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: 'recipient-1',
    message_id: 'message-1',
    type: 'NOTIFICATION',
    priority: 'LOW',
    created_via: null,
    module_key: 'general_notifications',
    subject: 'Processed absence deleted',
    body: 'Joe Divito absence was deleted.',
    pdf_file_path: null,
    acceptance_delay_minutes: 0,
    sender_name: 'System',
    sender_id: null,
    status: 'PENDING',
    created_at: '2026-06-09T16:50:00.000Z',
    signed_at: null,
    first_shown_at: null,
    signature_data: null,
    ...overrides,
  };
}

describe('NotificationPanel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('marks an unread dropdown notification as read without opening the notification', async () => {
    const onClose = vi.fn();
    const notificationDismissed = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes('/api/messages/notifications')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            notifications: [makeNotification()],
          }),
        } as Response;
      }

      if (url.includes('/api/messages/recipient-1/dismiss')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            recipient: {
              first_shown_at: '2026-06-09T17:00:00.000Z',
            },
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    window.addEventListener('notification-dismissed', notificationDismissed);

    try {
      render(<NotificationPanel open onClose={onClose} />);

      expect(await screen.findByText('Processed absence deleted')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /mark processed absence deleted as read/i }));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          '/api/messages/recipient-1/dismiss',
          expect.objectContaining({ method: 'POST' }),
        );
        expect(screen.queryByRole('button', { name: /mark processed absence deleted as read/i })).not.toBeInTheDocument();
      });

      expect(notificationDismissed).toHaveBeenCalledTimes(1);
      expect(pushMock).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('notification-dismissed', notificationDismissed);
    }
  });
});
