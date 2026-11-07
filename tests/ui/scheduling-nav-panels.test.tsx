/** @vitest-environment happy-dom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { notifySchedulingPanelLocked, notifySchedulingPanelSaved, schedulingPanelForLink, SCHEDULING_PANEL_LOCKED } from '@/lib/client/scheduling-panel-events';
import { panelRecordAcknowledged, usePanelList } from '@/components/scheduling-panels/panel-data';
import { buildAttachmentResponseError } from '@/app/(dashboard)/quotes/quote-attachment-client';

const ordinary = { button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
const record = { id: 'fictional', updated_at: '2026-11-05T08:00:02Z', name: 'Saved fictional customer' };
const response = (items: typeof record[], status = 200) => new Response(JSON.stringify({ customers: items, error: status === 200 ? undefined : 'Fictional network error' }), { status });

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('scheduling-only navigation interception', () => {
  it('intercepts only the two exact links on the main scheduling route', () => {
    expect(schedulingPanelForLink('/scheduling', '/quotes', ordinary)).toBe('quotes');
    expect(schedulingPanelForLink('/scheduling', '/customers', ordinary)).toBe('customers');
    for (const path of ['/dashboard', '/scheduling/tablet', '/quotes', '/scheduling/']) {
      expect(schedulingPanelForLink(path, '/quotes', ordinary)).toBeNull();
    }
    expect(schedulingPanelForLink('/scheduling', '/quotes/archive', ordinary)).toBeNull();
  });
  it.each(['ctrlKey', 'metaKey', 'shiftKey', 'altKey', 'defaultPrevented'] as const)('preserves %s browser behavior', key => {
    expect(schedulingPanelForLink('/scheduling', '/customers', { ...ordinary, [key]: true })).toBeNull();
  });
  it('preserves middle-click new tabs', () => {
    expect(schedulingPanelForLink('/scheduling', '/quotes', { ...ordinary, button: 1 })).toBeNull();
  });
});

describe('panel reconciliation', () => {
  it('retains saved server results through a stale refresh and accepts newer data', async () => {
    const stale = { ...record, name: 'Old customer', updated_at: '2026-11-05T08:00:01Z' };
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(response([stale])));
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(() => usePanelList<typeof record>('/api/customers', 'customers'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { result.current.saved(record); });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(result.current.items).toEqual([record]);
    const newer = { ...record, name: 'Newer authoritative value', updated_at: '2026-11-05T08:00:03Z' };
    fetcher.mockImplementation(() => Promise.resolve(response([newer])));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.items).toEqual([newer]);
  });
  it('keeps the successful save when reconciliation fails', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response([])).mockImplementation(() => Promise.resolve(response([], 503)));
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(() => usePanelList<typeof record>('/api/customers', 'customers'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { result.current.saved(record); });
    expect(result.current.items).toEqual([record]);
    expect(result.current.error?.message).toContain('Changes saved. Refresh failed');
  });
  it('discards responses started before a save and responds immediately to external saves', async () => {
    let resolveOld!: (value: Response) => void;
    const old = new Promise<Response>(resolve => { resolveOld = resolve; });
    const fetcher = vi.fn().mockReturnValueOnce(old).mockImplementation(() => Promise.resolve(response([record])));
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(() => usePanelList<typeof record>('/api/customers', 'customers'));
    await act(async () => { result.current.saved(record); });
    await act(async () => { resolveOld(response([])); });
    expect(result.current.items).toEqual([record]);
    act(() => notifySchedulingPanelSaved());
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  });
  it('does not erase a newly saved site with an older customer hydration', () => {
    const saved = { ...record, sites: [{ id: 'fictional-site', updated_at: record.updated_at }] };
    expect(panelRecordAcknowledged({ ...record, sites: [] }, saved)).toBe(false);
    expect(panelRecordAcknowledged(saved, saved)).toBe(true);
    expect(panelRecordAcknowledged(
      { ...record, updated_at: '2026-11-05T08:00:03Z', sites: [] },
      { ...record, sites: [{ id: 'fictional-site', updated_at: '2026-11-05T08:00:04Z' }] },
    )).toBe(false);
  });
  it('reports access loss only to the affected module', () => {
    const listener = vi.fn();
    window.addEventListener(SCHEDULING_PANEL_LOCKED, listener);
    notifySchedulingPanelLocked('/api/customers/fictional/sites', 428);
    expect(listener.mock.calls[0][0].detail).toEqual({ module: 'customers', status: 428 });
    notifySchedulingPanelLocked('/api/quotes', 503);
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(SCHEDULING_PANEL_LOCKED, listener);
  });
  it('locks quote contents when an attachment write loses access', async () => {
    const listener = vi.fn();
    window.addEventListener(SCHEDULING_PANEL_LOCKED, listener);
    const error = await buildAttachmentResponseError(new Response(JSON.stringify({ error: 'Fictional locked attachment' }), { status: 428 }), 'Upload failed');
    expect(error.message).toBe('Fictional locked attachment');
    expect(listener.mock.calls[0][0].detail).toEqual({ module: 'quotes', status: 428 });
    window.removeEventListener(SCHEDULING_PANEL_LOCKED, listener);
  });
});
