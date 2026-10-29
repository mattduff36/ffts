/// <reference types="@testing-library/jest-dom/vitest" />
/** @vitest-environment happy-dom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, useEffect, useState } from 'react';
import { toast } from 'sonner';

import TrainingPage from '@/app/(dashboard)/training/page';

type TrainingTab = 'overview' | 'records' | 'people' | 'qualifications' | 'notes';

const { authState, permissionState, mockUseAuth, mockUsePermissionCheck, pushMock, replaceMock, routerMock, searchParamsState } = vi.hoisted(() => {
  const pushMock = vi.fn();
  const replaceMock = vi.fn();
  const routerMock = { push: pushMock, replace: replaceMock };
  const searchParamsState = { current: new URLSearchParams('tab=overview') };
  const authState = {
    user: { id: 'user-1' } as { id: string } | null,
    profile: {
      role: { name: 'manager' },
      team: { id: 'team-1', name: 'Team One' },
      team_id: 'team-1',
    } as {
      role: { name: string } | null;
      team: { id: string; name: string } | null;
      team_id: string | null;
    } | null,
    isViewingAs: false,
    effectiveRole: null as { name: string; team_id: string | null; team_name: string | null } | null,
  };
  const permissionState = { hasPermission: true, loading: false };
  const mockUseAuth = vi.fn(() => authState);
  const mockUsePermissionCheck = vi.fn(() => permissionState);
  return { authState, permissionState, mockUseAuth, mockUsePermissionCheck, pushMock, replaceMock, routerMock, searchParamsState };
});

const originalFetch = global.fetch;
const originalConfirm = window.confirm;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
const originalHasPointerCapture = Element.prototype.hasPointerCapture;
const originalReleasePointerCapture = Element.prototype.releasePointerCapture;
const originalSetPointerCapture = Element.prototype.setPointerCapture;

let searchNotify: (() => void) | null = null;
let deferReads = false;
let deferWrites = false;
let deferExport = false;
let paginateRecords = false;
let failRecords = false;

interface QueuedRead {
  url: string;
  resolve: (value: Response) => void;
  reject: (reason?: unknown) => void;
}

const queuedReads: QueuedRead[] = [];
const queuedWrites: QueuedRead[] = [];
const queuedExports: QueuedRead[] = [];

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/training',
  useSearchParams: () => searchParamsState.current,
}));

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/lib/hooks/usePermissionCheck', () => ({
  usePermissionCheck: () => mockUsePermissionCheck(),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

function TrainingHarness() {
  const [, setTick] = useState(0);
  useEffect(() => {
    searchNotify = () => setTick((tick) => tick + 1);
    return () => {
      searchNotify = null;
    };
  }, []);
  return <TrainingPage />;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestMethod(init?: RequestInit): string {
  return (init?.method || 'GET').toUpperCase();
}

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
    blob: async () => new Blob(['xlsx']),
  } as Response;
}

function summaryBody(activeRecords: number) {
  return {
    summary: {
      totalRecords: activeRecords + 5,
      activeRecords,
      archivedRecords: 0,
      expiredRecords: 0,
      expiringSoonRecords: 0,
      noExpiryRecords: 0,
      needsNvqRecords: 0,
      awaitingCardRecords: 0,
      trainingBookedRecords: 0,
      manualReviewRecords: 0,
      unlinkedPeople: 0,
    },
  };
}

function recordBody(name: string, id = name) {
  return {
    id,
    employee_name_raw: name,
    qualification_raw: `${name} qualification`,
    qualification_canonical_proposed: `${name} canonical`,
    qualification_validation_status: 'needs_manual_review',
    qualification_group: '',
    relationship: '',
    card_number: '',
    card_type_or_status: '',
    approved: '',
    issue_date: '',
    issue_raw: '',
    expiry_date: '2020-01-01',
    expiry_raw: '',
    date_of_birth: '',
    date_of_birth_raw: '',
    comments: `${name} comments`,
    record_status: 'active',
    next_review_at: '',
    cpcs_statuses: [],
    source_sheet: 'Sheet',
    source_row: 2,
    person: null,
  };
}

function peopleBody(name: string) {
  return {
    id: 'person-1',
    employee_name_raw: name,
    employee_key: 'person-key',
    profile_id: null,
    profile_match_status: 'unmatched',
    profile_match_notes: '',
    date_of_births: [],
    source_sheets: ['Sheet'],
    record_count: 1,
    profile: null,
  };
}

function qualificationBody(name: string) {
  return {
    id: 'qualification-1',
    qualification_raw: `${name} raw`,
    canonical_name: name,
    validation_status: 'needs_manual_review',
    validation_notes: '',
    record_count: 1,
  };
}

function noteBody(value: string) {
  return {
    id: 'note-1',
    source_sheet: 'Notes',
    cell_address: 'A1',
    note_value: value,
    reason: 'Kept aside',
    note_type: 'comment',
  };
}

const dataset = {
  activeRecords: 41,
  records: [recordBody('Initial Worker', 'record-1')],
  people: [peopleBody('Kept Person')],
  qualifications: [qualificationBody('Kept Qualification')],
  notes: [noteBody('Kept Note')],
};

function listPayload(itemsKey: string, items: unknown[], offset: number) {
  const page = itemsKey === 'records' && paginateRecords
    ? (offset === 0 ? items.slice(0, 1) : items.slice(1))
    : items;
  const hasMore = itemsKey === 'records' && paginateRecords && offset === 0 && items.length > 1;
  return { [itemsKey]: page, pagination: { offset, limit: 500, has_more: hasMore } };
}

function buildResponse(url: string, method: string): Response {
  const path = url.split('?')[0];
  if (path.endsWith('/api/training/profile-options')) return jsonResponse({ profiles: [] });
  if (path.endsWith('/api/reports/training/export')) return jsonResponse({});
  if (method !== 'GET') return jsonResponse({});
  if (path.endsWith('/api/training/summary')) {
    return jsonResponse(summaryBody(dataset.activeRecords));
  }
  const offset = Number(new URL(url, 'http://localhost').searchParams.get('offset') || '0');
  if (path.endsWith('/api/training/records')) {
    if (failRecords) return jsonResponse({ error: 'Failed to fetch training records' }, false);
    return jsonResponse(listPayload('records', dataset.records, offset));
  }
  if (path.endsWith('/api/training/people')) return jsonResponse(listPayload('people', dataset.people, offset));
  if (path.endsWith('/api/training/qualifications')) return jsonResponse(listPayload('qualifications', dataset.qualifications, offset));
  if (path.endsWith('/api/training/notes')) return jsonResponse(listPayload('notes', dataset.notes, offset));
  throw new Error(`Unexpected training request ${method} ${url}`);
}

function callsTo(fragment: string, method = 'GET') {
  return vi.mocked(global.fetch).mock.calls.filter((call) => {
    const url = requestUrl(call[0] as RequestInfo | URL);
    return url.includes(fragment) && requestMethod(call[1] as RequestInit | undefined) === method;
  });
}

function renderTraining(tab: TrainingTab = 'overview') {
  searchParamsState.current = new URLSearchParams(`tab=${tab}`);
  return render(<TrainingHarness />);
}

async function settleTab(marker: string) {
  await screen.findByText(marker);
}

function clickTab(name: string) {
  fireEvent.mouseDown(screen.getByRole('tab', { name }));
  fireEvent.click(screen.getByRole('tab', { name }));
}

function releaseQueued(entry: QueuedRead, body: unknown, ok = true) {
  const index = queuedReads.indexOf(entry);
  if (index >= 0) queuedReads.splice(index, 1);
  entry.resolve(jsonResponse(body, ok));
}

function releaseMatching(fragment: string, body: unknown, occurrence = 0) {
  const matches = queuedReads.filter((entry) => entry.url.includes(fragment));
  const entry = matches[occurrence];
  if (!entry) throw new Error(`No queued request matching ${fragment}`);
  releaseQueued(entry, body);
}

describe('Training page tab loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deferReads = false;
    deferWrites = false;
    deferExport = false;
    paginateRecords = false;
    failRecords = false;
    queuedReads.splice(0, queuedReads.length);
    queuedWrites.splice(0, queuedWrites.length);
    queuedExports.splice(0, queuedExports.length);
    dataset.activeRecords = 41;
    dataset.records = [recordBody('Initial Worker', 'record-1')];
    dataset.people = [peopleBody('Kept Person')];
    dataset.qualifications = [qualificationBody('Kept Qualification')];
    dataset.notes = [noteBody('Kept Note')];
    authState.user = { id: 'user-1' };
    authState.profile = {
      role: { name: 'manager' },
      team: { id: 'team-1', name: 'Team One' },
      team_id: 'team-1',
    };
    authState.isViewingAs = false;
    authState.effectiveRole = null;
    permissionState.hasPermission = true;
    permissionState.loading = false;
    mockUseAuth.mockReturnValue(authState);
    mockUsePermissionCheck.mockReturnValue(permissionState);
    searchParamsState.current = new URLSearchParams('tab=overview');
    window.confirm = vi.fn(() => true) as unknown as typeof window.confirm;
    URL.createObjectURL = vi.fn(() => 'blob:training-test') as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
    Element.prototype.hasPointerCapture ||= (() => false) as Element['hasPointerCapture'];
    Element.prototype.releasePointerCapture ||= (() => undefined) as Element['releasePointerCapture'];
    Element.prototype.setPointerCapture ||= (() => undefined) as Element['setPointerCapture'];
    replaceMock.mockImplementation((url: string) => {
      searchParamsState.current = new URL(url, 'http://localhost').searchParams;
      searchNotify?.();
    });
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      const method = requestMethod(init);
      if (deferExport && url.includes('/api/reports/training/export')) {
        return new Promise((resolve, reject) => {
          queuedExports.push({ url, resolve, reject });
        });
      }
      if (deferWrites && method !== 'GET') {
        return new Promise((resolve, reject) => {
          queuedWrites.push({ url, resolve, reject });
        });
      }
      if (deferReads && method === 'GET' && url.includes('/api/training/')) {
        return new Promise((resolve, reject) => {
          queuedReads.push({ url, resolve, reject });
        });
      }
      return buildResponse(url, method);
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    window.confirm = originalConfirm;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    Element.prototype.hasPointerCapture = originalHasPointerCapture;
    Element.prototype.releasePointerCapture = originalReleasePointerCapture;
    Element.prototype.setPointerCapture = originalSetPointerCapture;
    searchNotify = null;
  });

  it('loads the current slices after StrictMode effect replay', async () => {
    render(<StrictMode><TrainingHarness /></StrictMode>);
    expect(await screen.findByText('Initial Worker')).toBeInTheDocument();
    expect(screen.getByText('41')).toBeInTheDocument();
    expect(callsTo('/api/training/people?limit=500')).toHaveLength(0);
  });

  it('discards all pages of a read that continues after an access change', async () => {
    deferReads = true;
    const view = renderTraining('overview');
    await waitFor(() => expect(queuedReads).toHaveLength(2));
    const oldRecords = queuedReads.find((entry) => entry.url.includes('/records?'))!;
    authState.user = { id: 'replacement-user' };
    view.rerender(<TrainingHarness />);
    await waitFor(() => expect(queuedReads).toHaveLength(4));
    const newWave = queuedReads.slice(2);
    await releaseAccessWave(newWave, 'Replacement Record', 15);
    await act(async () => {
      releaseQueued(oldRecords, { records: [recordBody('Old Page One')], pagination: { has_more: true } });
    });
    await waitFor(() => expect(queuedReads.some((entry) => entry.url.includes('offset=500'))).toBe(true));
    await act(async () => {
      releaseMatching('offset=500', listPayload('records', [recordBody('Old Page Two')], 500));
    });
    expect(screen.getByText('Replacement Record')).toBeInTheDocument();
    expect(screen.queryByText('Old Page One')).not.toBeInTheDocument();
    expect(screen.queryByText('Old Page Two')).not.toBeInTheDocument();
  });

  it('loads summary and records for overview and keeps the other slices unloaded', async () => {
    renderTraining('overview');
    await settleTab('Initial Worker');

    expect(callsTo('/api/training/summary')).toHaveLength(1);
    expect(callsTo('/api/training/records?limit=500')).toHaveLength(1);
    expect(callsTo('/api/training/people?limit=500')).toHaveLength(0);
    expect(callsTo('/api/training/qualifications?limit=500')).toHaveLength(0);
    expect(callsTo('/api/training/notes?limit=500')).toHaveLength(0);
    expect(screen.getByText('41')).toBeInTheDocument();
  });

  it.each([
    ['records', 'Training Records', '/api/training/records?limit=500'],
    ['people', 'Kept Person', '/api/training/people?limit=500'],
    ['qualifications', 'Kept Qualification', '/api/training/qualifications?limit=500'],
    ['notes', 'Kept Note', '/api/training/notes?limit=500'],
  ] as const)('loads only the %s tab matrix', async (tab, marker, collection) => {
    renderTraining(tab);
    await settleTab(marker);

    expect(callsTo('/api/training/summary')).toHaveLength(1);
    expect(callsTo(collection)).toHaveLength(1);
    for (const other of ['/api/training/records?limit=500', '/api/training/people?limit=500', '/api/training/qualifications?limit=500', '/api/training/notes?limit=500']) {
      if (other === collection) continue;
      expect(callsTo(other)).toHaveLength(0);
    }
  });

  it('treats an empty records result as loaded', async () => {
    dataset.records = [];
    dataset.activeRecords = 0;
    renderTraining('overview');

    expect(await screen.findByText('No training records found.')).toBeInTheDocument();
    expect(screen.queryByText('Loading training...')).not.toBeInTheDocument();
    expect(callsTo('/api/training/records?limit=500')).toHaveLength(1);
    expect(callsTo('/api/training/people?limit=500')).toHaveLength(0);
  });

  it('keeps the existing first ten priority records', async () => {
    dataset.records = Array.from({ length: 12 }, (_, index) => recordBody(`Priority-${String(index + 1).padStart(2, '0')}`, `priority-${index + 1}`));
    renderTraining('overview');
    await screen.findByText('Priority-01');

    expect(screen.getByText('Priority-10')).toBeInTheDocument();
    expect(screen.queryByText('Priority-11')).not.toBeInTheDocument();
    expect(screen.queryByText('Priority-12')).not.toBeInTheDocument();
  });

  it('searches the fully paginated record collection', async () => {
    paginateRecords = true;
    dataset.records = [recordBody('Alpha Mason', 'record-1'), recordBody('Zeta Hidden', 'record-2')];
    renderTraining('records');
    await screen.findByText('Alpha Mason');

    const recordUrls = callsTo('/api/training/records?limit=500').map((call) => requestUrl(call[0] as RequestInfo | URL));
    expect(recordUrls.some((url) => url.includes('offset=0'))).toBe(true);
    expect(recordUrls.some((url) => url.includes('offset=500'))).toBe(true);
    expect(callsTo('/api/training/people?limit=500')).toHaveLength(0);

    fireEvent.change(screen.getByPlaceholderText('Search employee, qualification, card, sheet, comments...'), {
      target: { value: 'Zeta Hidden' },
    });

    expect(screen.getByText('Zeta Hidden')).toBeInTheDocument();
    expect(screen.queryByText('Alpha Mason')).not.toBeInTheDocument();
  });

  it('deduplicates the shared records read when the records tab is selected in flight', async () => {
    deferReads = true;
    renderTraining('overview');
    await screen.findByRole('tab', { name: 'Records' });
    expect(queuedReads.filter((entry) => entry.url.includes('/api/training/records?'))).toHaveLength(1);
    expect(queuedReads.filter((entry) => entry.url.includes('/api/training/summary'))).toHaveLength(1);

    clickTab('Records');
    expect(queuedReads.filter((entry) => entry.url.includes('/api/training/records?'))).toHaveLength(1);
    expect(queuedReads.filter((entry) => entry.url.includes('/api/training/people?'))).toHaveLength(0);

    releaseMatching('/api/training/summary', summaryBody(41));
    releaseMatching('/api/training/records?', listPayload('records', dataset.records, 0));
    expect(await screen.findByText('Initial Worker')).toBeInTheDocument();
  });

  it('applies out-of-order tab replies without dropping the earlier slice', async () => {
    renderTraining('overview');
    await settleTab('Initial Worker');
    deferReads = true;

    clickTab('People');
    clickTab('Qualifications');
    await waitFor(() => {
      expect(queuedReads.some((entry) => entry.url.includes('/api/training/qualifications?'))).toBe(true);
      expect(queuedReads.some((entry) => entry.url.includes('/api/training/people?'))).toBe(true);
    });

    releaseMatching('/api/training/qualifications?', listPayload('qualifications', [qualificationBody('Late Qualification')], 0));
    expect(await screen.findByText('Late Qualification')).toBeInTheDocument();
    expect(screen.queryByText('Late Person')).not.toBeInTheDocument();

    releaseMatching('/api/training/people?', listPayload('people', [peopleBody('Late Person')], 0));
    clickTab('People');
    expect(await screen.findByText('Late Person')).toBeInTheDocument();
    clickTab('Overview');
    expect(screen.getByText('Initial Worker')).toBeInTheDocument();
    expect(callsTo('/api/training/records?limit=500')).toHaveLength(1);
    expect(callsTo('/api/training/summary')).toHaveLength(1);
  });

  it('retains a loaded slice when another slice fails and retries only the failure', async () => {
    renderTraining('overview');
    await settleTab('Initial Worker');
    clickTab('People');
    await settleTab('Kept Person');
    clickTab('Workbook Notes');
    await settleTab('Kept Note');
    failRecords = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    clickTab('Records');

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to fetch training records');
    expect(screen.getByText('Initial Worker')).toBeInTheDocument();
    clickTab('People');
    expect(screen.getByText('Kept Person')).toBeInTheDocument();
    clickTab('Workbook Notes');
    expect(screen.getByText('Kept Note')).toBeInTheDocument();

    const recordsBeforeRetry = callsTo('/api/training/records?limit=500').length;
    const peopleBeforeRetry = callsTo('/api/training/people?limit=500').length;
    failRecords = false;
    clickTab('Overview');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(callsTo('/api/training/records?limit=500').length).toBe(recordsBeforeRetry + 1));
    expect(callsTo('/api/training/people?limit=500')).toHaveLength(peopleBeforeRetry);
    expect(screen.getByText('Initial Worker')).toBeInTheDocument();
  });

  it('redirects denied users without requesting training collections', async () => {
    permissionState.hasPermission = false;
    renderTraining('overview');

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/dashboard'));
    expect(toast.error).toHaveBeenCalledWith('Access denied', { id: 'training-access-denied' });
    expect(callsTo('/api/training/summary')).toHaveLength(0);
    expect(callsTo('/api/training/records?limit=500')).toHaveLength(0);
    expect(pushMock).toHaveBeenCalledTimes(1);
  });

  it('drops stale responses after the signed-in user changes', async () => {
    deferReads = true;
    const view = renderTraining('overview');
    await waitFor(() => expect(queuedReads.some((entry) => entry.url.includes('/api/training/records?'))).toBe(true));
    const firstWave = queuedReads.slice();

    authState.user = { id: 'user-2' };
    view.rerender(<TrainingHarness />);
    await waitFor(() => expect(queuedReads.length).toBeGreaterThan(firstWave.length));
    const secondWave = queuedReads.filter((entry) => !firstWave.includes(entry));

    for (const entry of secondWave) {
      const body = entry.url.includes('/api/training/summary')
        ? summaryBody(87)
        : entry.url.includes('/api/training/records?')
          ? listPayload('records', [recordBody('User Two Record')], 0)
          : listPayload('people', [], 0);
      releaseQueued(entry, body);
    }

    expect(await screen.findByText('User Two Record')).toBeInTheDocument();
    expect(screen.getByText('87')).toBeInTheDocument();

    for (const entry of firstWave) {
      const body = entry.url.includes('/api/training/summary')
        ? summaryBody(4)
        : listPayload('records', [recordBody('User One Record')], 0);
      releaseQueued(entry, body);
    }

    await waitFor(() => expect(screen.getByText('User Two Record')).toBeInTheDocument());
    expect(screen.queryByText('User One Record')).not.toBeInTheDocument();
    expect(screen.queryByText('4')).not.toBeInTheDocument();
    expect(screen.getByText('87')).toBeInTheDocument();
  });

  it('refreshes every slice from explicit Refresh and only loaded slices from soft refresh', async () => {
    renderTraining('overview');
    await settleTab('Initial Worker');
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(callsTo('/api/training/summary')).toHaveLength(2));
    expect(callsTo('/api/training/records?limit=500')).toHaveLength(2);
    expect(callsTo('/api/training/people?limit=500')).toHaveLength(0);
    expect(callsTo('/api/training/qualifications?limit=500')).toHaveLength(0);
    expect(callsTo('/api/training/notes?limit=500')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(callsTo('/api/training/notes?limit=500')).toHaveLength(1));
    expect(callsTo('/api/training/summary')).toHaveLength(3);
    expect(callsTo('/api/training/records?limit=500')).toHaveLength(3);
    expect(callsTo('/api/training/people?limit=500')).toHaveLength(1);
    expect(callsTo('/api/training/qualifications?limit=500')).toHaveLength(1);
  });

  it('does not soft refresh while offline, hidden, or a dialog draft is open', async () => {
    renderTraining('records');
    await settleTab('Initial Worker');
    const summaryCount = () => callsTo('/api/training/summary').length;
    const before = summaryCount();

    const onlineDescriptor = Object.getOwnPropertyDescriptor(navigator, 'onLine');
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    window.dispatchEvent(new Event('focus'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(summaryCount()).toBe(before);
    if (onlineDescriptor) Object.defineProperty(navigator, 'onLine', onlineDescriptor);

    const visibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(summaryCount()).toBe(before);
    if (visibilityDescriptor) Object.defineProperty(document, 'visibilityState', visibilityDescriptor);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const comments = await screen.findByLabelText('Comments');
    fireEvent.change(comments, { target: { value: 'draft-note' } });
    window.dispatchEvent(new Event('focus'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(summaryCount()).toBe(before);
    expect(screen.getByLabelText('Comments')).toHaveValue('draft-note');

    dataset.records = [recordBody('Refreshed Worker')];
    fireEvent.click(screen.getByRole('button', { name: 'Refresh', hidden: true }));
    await screen.findByText('Refreshed Worker');
    expect(screen.getByLabelText('Comments')).toHaveValue('draft-note');
  });

  it('refreshes summary and records after save, plus loaded people and qualification counts', async () => {
    renderTraining('records');
    await settleTab('Initial Worker');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(callsTo('/api/training/records/record-1', 'PATCH')).toHaveLength(1));
    await waitFor(() => expect(callsTo('/api/training/summary')).toHaveLength(2));
    expect(callsTo('/api/training/records?limit=500')).toHaveLength(2);
    expect(callsTo('/api/training/people?limit=500')).toHaveLength(0);
    expect(callsTo('/api/training/qualifications?limit=500')).toHaveLength(0);

    clickTab('People');
    await settleTab('Kept Person');
    clickTab('Qualifications');
    await settleTab('Kept Qualification');
    clickTab('Records');
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(callsTo('/api/training/records/record-1', 'DELETE')).toHaveLength(1));
    await waitFor(() => expect(callsTo('/api/training/summary')).toHaveLength(3));
    expect(callsTo('/api/training/records?limit=500')).toHaveLength(3);
    expect(callsTo('/api/training/people?limit=500')).toHaveLength(2);
    expect(callsTo('/api/training/qualifications?limit=500')).toHaveLength(2);
    expect(callsTo('/api/training/notes?limit=500')).toHaveLength(0);
  });

  it('starts a post-mutation read instead of reusing the in-flight pre-mutation response', async () => {
    renderTraining('records');
    await settleTab('Initial Worker');
    deferReads = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(queuedReads.filter((entry) => entry.url.includes('/api/training/records?'))).toHaveLength(1));
    const refreshRecordRead = queuedReads.find((entry) => entry.url.includes('/api/training/records?'));
    if (!refreshRecordRead) throw new Error('Expected the refresh records read');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(callsTo('/api/training/records/record-1', 'PATCH')).toHaveLength(1));
    await waitFor(() => expect(queuedReads.filter((entry) => entry.url.includes('/api/training/records?'))).toHaveLength(2));
    const mutationRecordRead = queuedReads.filter((entry) => entry.url.includes('/api/training/records?')).at(-1);
    if (!mutationRecordRead || mutationRecordRead === refreshRecordRead) throw new Error('Expected a new records read after save');

    await act(async () => {
      releaseQueued(refreshRecordRead, listPayload('records', [recordBody('Stale Worker')], 0));
    });
    expect(screen.queryByText('Stale Worker')).not.toBeInTheDocument();
    expect(screen.getByText('Initial Worker')).toBeInTheDocument();

    releaseQueued(mutationRecordRead, listPayload('records', [recordBody('Fresh Worker')], 0));
    expect(await screen.findByText('Fresh Worker')).toBeInTheDocument();
    expect(screen.queryByText('Stale Worker')).not.toBeInTheDocument();
  });

  it('refreshes a person list and loaded records, without unloaded record lists', async () => {
    renderTraining('people');
    await settleTab('Kept Person');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(callsTo('/api/training/people/person-1', 'PATCH')).toHaveLength(1));
    await waitFor(() => expect(callsTo('/api/training/people?limit=500')).toHaveLength(2));
    expect(callsTo('/api/training/summary')).toHaveLength(2);
    expect(callsTo('/api/training/records?limit=500')).toHaveLength(0);

    clickTab('Overview');
    await settleTab('Initial Worker');
    clickTab('Qualifications');
    await settleTab('Kept Qualification');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(callsTo('/api/training/qualifications/qualification-1', 'PATCH')).toHaveLength(1));
    await waitFor(() => expect(callsTo('/api/training/qualifications?limit=500')).toHaveLength(2));
    expect(callsTo('/api/training/records?limit=500')).toHaveLength(2);
    expect(callsTo('/api/training/people?limit=500')).toHaveLength(2);
  });

  it('exports from the server without loading the other training tabs', async () => {
    renderTraining('notes');
    await settleTab('Kept Note');
    fireEvent.click(screen.getByRole('button', { name: 'Export XLSX' }));

    await waitFor(() => expect(callsTo('/api/reports/training/export?status=active')).toHaveLength(1));
    expect(callsTo('/api/training/summary')).toHaveLength(1);
    expect(callsTo('/api/training/notes?limit=500')).toHaveLength(1);
    expect(callsTo('/api/training/records?limit=500')).toHaveLength(0);
    expect(callsTo('/api/training/people?limit=500')).toHaveLength(0);
    expect(callsTo('/api/training/qualifications?limit=500')).toHaveLength(0);
  });

  async function releaseAccessWave(entries: QueuedRead[], recordName: string, activeRecords: number) {
    for (const entry of entries) {
      const body = entry.url.includes('/api/training/summary')
        ? summaryBody(activeRecords)
        : entry.url.includes('/api/training/records?')
          ? listPayload('records', [recordBody(recordName)], 0)
          : listPayload('people', [], 0);
      releaseQueued(entry, body);
    }
    expect(await screen.findByText(recordName)).toBeInTheDocument();
  }

  it('drops stale slices when the same user changes view-as role and team', async () => {
    deferReads = true;
    const view = renderTraining('overview');
    await waitFor(() => expect(queuedReads.some((entry) => entry.url.includes('/api/training/records?'))).toBe(true));
    const firstWave = queuedReads.slice();

    authState.isViewingAs = true;
    authState.effectiveRole = { name: 'operative', team_id: 'team-2', team_name: 'North' };
    view.rerender(<TrainingHarness />);
    await waitFor(() => expect(queuedReads.length).toBeGreaterThan(firstWave.length));
    const secondWave = queuedReads.filter((entry) => !firstWave.includes(entry));
    await releaseAccessWave(secondWave, 'View As Record', 12);

    for (const entry of firstWave) {
      const body = entry.url.includes('/api/training/summary')
        ? summaryBody(4)
        : listPayload('records', [recordBody('Original Role Record')], 0);
      releaseQueued(entry, body);
    }

    await waitFor(() => expect(screen.getByText('View As Record')).toBeInTheDocument());
    expect(screen.queryByText('Original Role Record')).not.toBeInTheDocument();
    expect(screen.queryByText('4')).not.toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('drops stale slices when the same user profile role or team changes', async () => {
    deferReads = true;
    const view = renderTraining('overview');
    await waitFor(() => expect(queuedReads.some((entry) => entry.url.includes('/api/training/records?'))).toBe(true));
    const firstWave = queuedReads.slice();

    authState.profile = {
      role: { name: 'supervisor' },
      team: { id: 'team-9', name: 'Other Team' },
      team_id: 'team-9',
    };
    view.rerender(<TrainingHarness />);
    await waitFor(() => expect(queuedReads.length).toBeGreaterThan(firstWave.length));
    const secondWave = queuedReads.filter((entry) => !firstWave.includes(entry));
    await releaseAccessWave(secondWave, 'New Team Record', 21);

    for (const entry of firstWave) {
      const body = entry.url.includes('/api/training/summary')
        ? summaryBody(3)
        : listPayload('records', [recordBody('Old Team Record')], 0);
      releaseQueued(entry, body);
    }

    await waitFor(() => expect(screen.getByText('New Team Record')).toBeInTheDocument());
    expect(screen.queryByText('Old Team Record')).not.toBeInTheDocument();
    expect(screen.queryByText('3')).not.toBeInTheDocument();
    expect(screen.getByText('21')).toBeInTheDocument();
  });

  it('clears an open draft when view-as access changes and keeps a same-context draft', async () => {
    const view = renderTraining('records');
    await settleTab('Initial Worker');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(await screen.findByLabelText('Comments'), { target: { value: 'old-draft' } });

    authState.isViewingAs = true;
    authState.effectiveRole = { name: 'employee', team_id: 'team-4', team_name: 'South' };
    view.rerender(<TrainingHarness />);
    await screen.findByText('Initial Worker');
    expect(screen.queryByLabelText('Comments')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(await screen.findByLabelText('Comments'), { target: { value: 'kept-draft' } });
    const summaryCount = callsTo('/api/training/summary').length;
    window.dispatchEvent(new Event('focus'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.getByLabelText('Comments')).toHaveValue('kept-draft');
    expect(callsTo('/api/training/summary')).toHaveLength(summaryCount);
  });

  it('ignores a delayed record save from the previous access context', async () => {
    const view = renderTraining('records');
    await settleTab('Initial Worker');
    deferWrites = true;
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(queuedWrites).toHaveLength(1));
    const staleSave = queuedWrites[0];

    authState.profile = {
      role: { name: 'supervisor' },
      team: { id: 'team-9', name: 'Other Team' },
      team_id: 'team-9',
    };
    view.rerender(<TrainingHarness />);
    await screen.findByText('Initial Worker');
    expect(screen.queryByLabelText('Comments')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(await screen.findByLabelText('Comments'), { target: { value: 'newer-draft' } });
    const summaryCount = callsTo('/api/training/summary').length;
    const recordsCount = callsTo('/api/training/records?limit=500').length;

    await act(async () => {
      releaseQueued(staleSave, {});
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(screen.getByLabelText('Comments')).toHaveValue('newer-draft');
    expect(callsTo('/api/training/summary')).toHaveLength(summaryCount);
    expect(callsTo('/api/training/records?limit=500')).toHaveLength(recordsCount);
    expect(callsTo('/api/training/people?limit=500')).toHaveLength(0);
    expect(callsTo('/api/training/qualifications?limit=500')).toHaveLength(0);
  });

  it.each(['archive', 'person', 'qualification'] as const)('contains a delayed %s failure after replacement context', async (kind) => {
    const tab = kind === 'person' ? 'people' : kind === 'qualification' ? 'qualifications' : 'records';
    const marker = kind === 'person' ? 'Kept Person' : kind === 'qualification' ? 'Kept Qualification' : 'Initial Worker';
    const view = renderTraining(tab);
    await settleTab(marker);
    deferWrites = true;
    fireEvent.click(screen.getByRole('button', { name: kind === 'archive' ? 'Archive' : 'Edit' }));
    if (kind !== 'archive') fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(queuedWrites).toHaveLength(1));
    authState.user = { id: 'new-user' };
    view.rerender(<TrainingHarness />);
    await settleTab(marker);
    const fetchCount = vi.mocked(global.fetch).mock.calls.length;
    vi.mocked(toast.error).mockClear();
    await act(async () => { queuedWrites[0].reject(new Error('Old context failure')); });
    expect(vi.mocked(global.fetch).mock.calls.length).toBe(fetchCount);
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.getByText(marker)).toBeInTheDocument();
  });

  it('does not download an export started in an older access context', async () => {
    const view = renderTraining('notes');
    await settleTab('Kept Note');
    deferExport = true;
    fireEvent.click(screen.getByRole('button', { name: 'Export XLSX' }));
    await waitFor(() => expect(queuedExports).toHaveLength(1));
    const staleExport = queuedExports[0];

    authState.isViewingAs = true;
    authState.effectiveRole = { name: 'operative', team_id: 'team-2', team_name: 'North' };
    view.rerender(<TrainingHarness />);
    await screen.findByText('Kept Note');

    await act(async () => {
      releaseQueued(staleExport, {});
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.getByText('Kept Note')).toBeInTheDocument();
  });

  it('drops stale reads across permission loss, re-grant, and unmount', async () => {
    deferReads = true;
    const view = renderTraining('overview');
    await waitFor(() => expect(queuedReads.some((entry) => entry.url.includes('/api/training/records?'))).toBe(true));
    const deniedWave = queuedReads.slice();

    permissionState.hasPermission = false;
    view.rerender(<TrainingHarness />);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/dashboard'));
    expect(screen.queryByText('Initial Worker')).not.toBeInTheDocument();

    permissionState.hasPermission = true;
    view.rerender(<TrainingHarness />);
    await waitFor(() => expect(queuedReads.length).toBeGreaterThan(deniedWave.length));
    const grantedWave = queuedReads.filter((entry) => !deniedWave.includes(entry));
    await releaseAccessWave(grantedWave, 'Regranted Record', 9);

    for (const entry of deniedWave) {
      const body = entry.url.includes('/api/training/summary')
        ? summaryBody(4)
        : listPayload('records', [recordBody('Denied Stale Record')], 0);
      releaseQueued(entry, body);
    }

    await waitFor(() => expect(screen.getByText('Regranted Record')).toBeInTheDocument());
    expect(screen.queryByText('Denied Stale Record')).not.toBeInTheDocument();
    expect(screen.queryByText('4')).not.toBeInTheDocument();
  });

  it('invalidates in-flight reads and exports when the page unmounts', async () => {
    deferReads = true;
    deferExport = true;
    const view = renderTraining('overview');
    await waitFor(() => expect(queuedReads.some((entry) => entry.url.includes('/api/training/records?'))).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Export XLSX' }));
    await waitFor(() => expect(queuedExports).toHaveLength(1));
    const reads = queuedReads.slice();
    const staleExport = queuedExports[0];
    const fetchCount = vi.mocked(global.fetch).mock.calls.length;

    view.unmount();
    await act(async () => {
      for (const entry of reads) {
        const body = entry.url.includes('/api/training/summary')
          ? summaryBody(4)
          : listPayload('records', [recordBody('Unmounted Record')], 0);
        releaseQueued(entry, body);
      }
      releaseQueued(staleExport, {});
    });

    expect(vi.mocked(global.fetch).mock.calls.length).toBe(fetchCount);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByText('Unmounted Record')).not.toBeInTheDocument();
  });
});
