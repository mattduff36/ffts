// @vitest-environment happy-dom
/// <reference types="@testing-library/jest-dom/vitest" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SuggestionCreateDialog } from '@/components/suggestions/suggestion-create-dialog';
import type { SubmitterSuggestion } from '@/types/faq';

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const createdSuggestion: SubmitterSuggestion = {
  id: 'suggestion-1',
  created_by: 'manager-1',
  title: 'Improve scheduling',
  body: 'Add a weekly overview.',
  page_hint: 'Scheduling',
  status: 'new',
  created_at: '2026-07-21T20:00:00Z',
  updated_at: '2026-07-21T20:00:00Z',
};

function fillSuggestionForm() {
  fireEvent.change(screen.getByLabelText(/title/i), {
    target: { value: createdSuggestion.title },
  });
  fireEvent.change(screen.getByLabelText(/description/i), {
    target: { value: createdSuggestion.body },
  });
  fireEvent.change(screen.getByLabelText(/related page\/feature/i), {
    target: { value: createdSuggestion.page_hint },
  });
}

describe('SuggestionCreateDialog', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('guards duplicate submissions, refreshes through onCreated, and closes', async () => {
    let resolveRequest: ((value: unknown) => void) | undefined;
    const fetchMock = vi.fn(() => new Promise((resolve) => {
      resolveRequest = resolve;
    }));
    const onCreated = vi.fn(async () => undefined);
    const onOpenChange = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(
      <SuggestionCreateDialog
        open
        onOpenChange={onOpenChange}
        onCreated={onCreated}
      />
    );

    fillSuggestionForm();
    const submitButton = screen.getByRole('button', { name: 'Submit Suggestion' });
    const form = submitButton.closest('form');
    expect(form).not.toBeNull();

    fireEvent.submit(form!);
    fireEvent.submit(form!);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveRequest?.({
      ok: true,
      status: 201,
      json: vi.fn().mockResolvedValue({
        success: true,
        suggestion: createdSuggestion,
      }),
    });

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(createdSuggestion);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/suggestions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: createdSuggestion.title,
        body: createdSuggestion.body,
        page_hint: createdSuggestion.page_hint,
      }),
    });
  });

  it('keeps a stable server error visible and does not report creation', async () => {
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: vi.fn().mockResolvedValue({
        error: 'Suggestion service is temporarily unavailable.',
      }),
    }));

    render(
      <SuggestionCreateDialog
        open
        onOpenChange={onOpenChange}
        onCreated={onCreated}
      />
    );

    fillSuggestionForm();
    fireEvent.click(screen.getByRole('button', { name: 'Submit Suggestion' }));

    expect(
      await screen.findByText('Suggestion service is temporarily unavailable.')
    ).toBeVisible();
    expect(screen.getByTestId('manage-suggestion-server-error')).toBeVisible();
    expect(onCreated).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
