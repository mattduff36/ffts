/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreateReminderForm } from '@/components/messages/CreateReminderForm';
import { fetchUserDirectory } from '@/lib/client/user-directory';

vi.mock('@/lib/client/user-directory', () => ({
  fetchUserDirectory: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('@/components/users/assign-users-modal', () => ({
  AssignUsersModal: ({ open }: { open: boolean }) => (open ? <div data-testid="assign-users-modal" /> : null),
}));

describe('CreateReminderForm', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('loads reminder recipients with toolbox assignment context and no module filter', async () => {
    vi.mocked(fetchUserDirectory).mockResolvedValue([]);

    render(<CreateReminderForm />);

    fireEvent.click(screen.getByRole('button', { name: /create reminder/i }));
    fireEvent.change(screen.getByLabelText(/subject/i), {
      target: { value: 'Safety follow-up' },
    });
    fireEvent.change(screen.getByLabelText(/message/i), {
      target: { value: 'Please complete this reminder.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /choose recipients/i }));

    await waitFor(() => {
      expect(fetchUserDirectory).toHaveBeenCalledWith({
        includeRole: true,
        context: 'toolbox-talks-assignment',
      });
    });

    expect(fetchUserDirectory).not.toHaveBeenCalledWith(expect.objectContaining({ module: 'reminders' }));
  });
});
