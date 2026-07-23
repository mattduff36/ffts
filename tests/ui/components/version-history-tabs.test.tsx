/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VersionHistoryTabs } from '@/app/(dashboard)/help/version-history/components/VersionHistoryTabs';
import type { ReleaseHistoryEntry } from '@/lib/config/release-version-logic';

function makeEntry(version: string, detail: string): ReleaseHistoryEntry {
  return {
    version,
    updateKind: 'minor',
    title: `Version ${version} update`,
    description: `Summary for ${version}`,
    summary: `Summary for ${version}`,
    details: [detail],
    areas: ['Help'],
    pushedAt: '2026-07-23T12:00:00.000Z',
  };
}

describe('VersionHistoryTabs', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps every version collapsed until the user expands it', async () => {
    const entriesByMonth: Record<string, ReleaseHistoryEntry[]> = {
      '0726': [
        makeEntry('0726.2.0', 'Newest version detail'),
        makeEntry('0726.1.1', 'Earlier version detail'),
      ],
      '0626': [makeEntry('0626.3.0', 'Previous month detail')],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      const month = new URL(url, 'https://example.test').searchParams.get('month') ?? '';

      return {
        ok: true,
        json: async () => ({
          entries: entriesByMonth[month] ?? [],
          month: { key: month, label: month },
        }),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <VersionHistoryTabs
        months={[
          { key: '0726', label: 'July 2026' },
          { key: '0626', label: 'June 2026' },
        ]}
        initialMonthKey="0726"
      />,
    );

    const newestVersionButton = await screen.findByRole('button', { name: 'Version 0726.2.0' });
    const earlierVersionButton = screen.getByRole('button', { name: 'Version 0726.1.1' });

    expect(newestVersionButton).toHaveAttribute('aria-expanded', 'false');
    expect(earlierVersionButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Newest version detail')).not.toBeInTheDocument();

    fireEvent.click(newestVersionButton);
    expect(newestVersionButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Newest version detail')).toBeInTheDocument();

    fireEvent.click(newestVersionButton);
    expect(newestVersionButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Newest version detail')).not.toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'June 2026' }), {
      button: 0,
      ctrlKey: false,
    });

    const previousMonthButton = await screen.findByRole('button', { name: 'Version 0626.3.0' });
    expect(previousMonthButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Previous month detail')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/version-history?month=0626',
        expect.objectContaining({ cache: 'no-store' }),
      );
    });
  });
});
