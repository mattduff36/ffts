/** @vitest-environment happy-dom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TrainingPersonDialog } from '@/app/(dashboard)/training/components/TrainingPersonDialog';
import type { TrainingPerson } from '@/types/training';

const LINKED_PROFILE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OPTION_PROFILE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function makePerson(profileId = ''): TrainingPerson & {
  profile?: { id: string; full_name: string | null; employee_id: string | null } | null;
} {
  return {
    id: 'person-1',
    employee_key: 'ADA LOVELACE',
    employee_name_raw: 'Ada Lovelace',
    profile_id: profileId || null,
    profile_match_status: profileId ? 'matched' : 'unmatched',
    profile_match_notes: null,
    date_of_births: [],
    source_sheets: ['CPCS'],
    record_count: 1,
    profile: profileId
      ? { id: profileId, full_name: 'Historical Ada', employee_id: 'OLD-1' }
      : null,
  } as TrainingPerson & {
    profile?: { id: string; full_name: string | null; employee_id: string | null } | null;
  };
}

function jsonResponse(profiles: Array<{ id: string; full_name: string; employee_id: string | null }>, ok = true) {
  return Promise.resolve({
    ok,
    json: async () => (ok ? { profiles } : { error: 'Failed to load employees' }),
  } as Response);
}

describe('TrainingPersonDialog employee selector', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('loads employees only while open and keeps an unavailable current link', async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse([
      { id: OPTION_PROFILE_ID, full_name: 'Grace Hopper', employee_id: 'EMP-2' },
    ]));
    vi.stubGlobal('fetch', fetchMock);
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    const { rerender } = render(
      <TrainingPersonDialog open={false} person={makePerson(LINKED_PROFILE_ID)} onClose={vi.fn()} onSubmit={onSubmit} />
    );
    expect(fetchMock).not.toHaveBeenCalled();

    rerender(
      <TrainingPersonDialog open person={makePerson(LINKED_PROFILE_ID)} onClose={vi.fn()} onSubmit={onSubmit} />
    );

    fireEvent.click(await screen.findByRole('combobox', { name: 'Employee' }));
    expect(await screen.findByRole('option', { name: 'Grace Hopper (EMP-2)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Historical Ada (OLD-1) (unavailable)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'No linked employee' })).toBeTruthy();

    fireEvent.click(screen.getByRole('option', { name: 'No linked employee' }));
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      employee_name_raw: 'Ada Lovelace',
      profile_id: '',
      profile_match_status: 'matched',
    })));
  });

  it('shows a load error and ignores a stale employee response', async () => {
    let resolveFirst: (response: Response) => void = () => {};
    const first = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => jsonResponse([
        { id: OPTION_PROFILE_ID, full_name: 'Grace Hopper', employee_id: 'EMP-2' },
      ]));
    vi.stubGlobal('fetch', fetchMock);

    const view = render(
      <TrainingPersonDialog open person={makePerson()} onClose={vi.fn()} onSubmit={vi.fn()} />
    );
    view.rerender(
      <TrainingPersonDialog open={false} person={makePerson()} onClose={vi.fn()} onSubmit={vi.fn()} />
    );
    view.rerender(
      <TrainingPersonDialog open person={makePerson()} onClose={vi.fn()} onSubmit={vi.fn()} />
    );

    fireEvent.click(await screen.findByRole('combobox', { name: 'Employee' }));
    expect(await screen.findByRole('option', { name: 'Grace Hopper (EMP-2)' })).toBeTruthy();

    resolveFirst({
      ok: true,
      json: async () => ({ profiles: [{ id: LINKED_PROFILE_ID, full_name: 'Stale Name', employee_id: 'STALE' }] }),
    } as Response);
    await Promise.resolve();
    expect(screen.queryByRole('option', { name: /Stale Name/ })).toBeNull();

    fetchMock.mockImplementationOnce(() => jsonResponse([], false));
    view.rerender(
      <TrainingPersonDialog open={false} person={makePerson(LINKED_PROFILE_ID)} onClose={vi.fn()} onSubmit={vi.fn()} />
    );
    view.rerender(
      <TrainingPersonDialog open person={makePerson(LINKED_PROFILE_ID)} onClose={vi.fn()} onSubmit={vi.fn()} />
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load employees');
    fireEvent.click(screen.getByRole('combobox', { name: 'Employee' }));
    expect(await screen.findByRole('option', { name: 'Historical Ada (OLD-1) (unavailable)' })).toBeTruthy();
  });
});
