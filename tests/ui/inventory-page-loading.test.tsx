/// <reference types="@testing-library/jest-dom/vitest" />
/** @vitest-environment happy-dom */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import InventoryPage from '@/app/(dashboard)/inventory/page';

const state = vi.hoisted(() => ({
  permission: { hasPermission: true, loading: false },
  params: new URLSearchParams(),
  router: { push: vi.fn() },
  softRefresh: null as null | (() => Promise<void>),
  softEnabled: false,
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/inventory', useRouter: () => state.router, useSearchParams: () => state.params }));
vi.mock('@/lib/hooks/usePermissionCheck', () => ({ usePermissionCheck: () => state.permission }));
vi.mock('@/lib/hooks/useSoftRefresh', () => ({ useSoftRefresh: (callback: () => Promise<void>, enabled: boolean) => {
  state.softRefresh = callback; state.softEnabled = enabled;
} }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/app/(dashboard)/inventory/components/InventoryEmployeeView', () => ({ InventoryEmployeeView: () => <div>Employee inventory</div> }));
vi.mock('@/app/(dashboard)/inventory/components/InventoryCategoriesPanel', () => ({ InventoryCategoriesPanel: () => null }));
vi.mock('@/app/(dashboard)/inventory/components/InventoryGroupsPanel', () => ({ InventoryGroupsPanel: () => null }));
vi.mock('@/app/(dashboard)/inventory/components/InventoryLocationsPanel', () => ({ InventoryLocationsPanel: ({ locations, fleetAssets }: { locations: { name: string }[]; fleetAssets: { label: string }[] }) => <div>Locations {locations.map(x => x.name).join(',')} Fleet {fleetAssets.map(x => x.label).join(',')}</div> }));
vi.mock('@/app/(dashboard)/inventory/components/InventoryTable', () => ({ InventoryTable: ({ items, tableLabel }: { items: { item_number: string }[]; tableLabel: string }) => <div>{tableLabel}: {items.map(x => x.item_number).join(',')}</div> }));
vi.mock('@/app/(dashboard)/inventory/components/InventoryItemDialog', () => ({ InventoryItemDialog: ({ open, locations, categories }: { open: boolean; locations: { name: string }[]; categories: { name: string }[] }) => open ? <div>Item references: {locations.map(x => x.name).join(',')}; {categories.map(x => x.name).join(',')}</div> : null }));
vi.mock('@/app/(dashboard)/inventory/components/InventoryLocationDialog', () => ({ InventoryLocationDialog: ({ open, fleetAssets }: { open: boolean; fleetAssets: { label: string }[] }) => open ? <div>Location references: {fleetAssets.map(x => x.label).join(',')}</div> : null }));
vi.mock('@/app/(dashboard)/inventory/components/ChangeInventoryLocationDialog', () => ({ ChangeInventoryLocationDialog: () => null }));
vi.mock('@/app/(dashboard)/inventory/components/InventoryRetireItemDialog', () => ({ InventoryRetireItemDialog: () => null }));
vi.mock('@/app/(dashboard)/inventory/components/MoveInventoryDialog', () => ({ MoveInventoryDialog: () => null }));
vi.mock('@/app/(dashboard)/inventory/components/InventorySiteAssignmentsPanel', () => ({ InventorySiteAssignmentsPanel: ({ users, activeSites, assignments, onAssign, onRemove }: {
  users: { full_name: string }[]; activeSites: { name: string }[]; assignments: { note: string }[];
  onAssign: (payload: { userId: string; locationId: string }) => Promise<void>;
  onRemove: (payload: { userId: string; locationId: string }) => Promise<void>;
}) => <section aria-label="Assignments"><span>{users.map(x => x.full_name).join(',')} / {activeSites.map(x => x.name).join(',')} / {assignments.map(x => x.note).join(',')}</span>
  <button onClick={() => { void onAssign({ userId: 'person', locationId: 'site' }); }}>Assign fixture</button>
  <button onClick={() => { void onRemove({ userId: 'person', locationId: 'site' }); }}>Remove fixture</button>
</section> }));

const originalFetch = global.fetch;
let context: Record<string, unknown>;
let failAssignments = false;
let failContext = false;
let deferAssignments = false;
const pending: ((response: Response) => void)[] = [];
function json(body: unknown, ok = true) { return { ok, status: ok ? 200 : 403, json: async () => body } as Response; }
function assignmentPayload(name = 'Assigned Worker') { return { users: [{ id: 'person', full_name: name }], active_sites: [{ id: 'site', name: 'Active Site' }], assignments: [{ note: 'Kept assignment' }] }; }
function count(path: string, method = 'GET') { return vi.mocked(global.fetch).mock.calls.filter(([url, init]) => String(url).split('?')[0] === path && (init?.method || 'GET') === method).length; }
async function refresh() { await act(async () => { await state.softRefresh?.(); }); }
function switchTab(name: string) { const tab = screen.getByRole('tab', { name }); fireEvent.mouseDown(tab); fireEvent.click(tab); }

beforeEach(() => {
  vi.clearAllMocks();
  state.permission = { hasPermission: true, loading: false }; state.params = new URLSearchParams();
  state.softRefresh = null; state.softEnabled = false;
  context = { user_id: 'user', is_manager_or_admin: true, can_manage_site_locations: true, role_name: 'manager', role_class: 'manager', team_id: 'one' };
  failAssignments = false; failContext = false; deferAssignments = false; pending.length = 0;
  global.fetch = vi.fn(async (input, init) => {
    const url = String(input); const path = url.split('?')[0];
    if (init?.method && init.method !== 'GET') return json({});
    if (path === '/api/inventory/context') return failContext ? json({ error: 'Not signed in' }, false) : json({ ...context });
    if (path === '/api/inventory/site-assignments') {
      if (deferAssignments) return new Promise<Response>(resolve => pending.push(resolve));
      return failAssignments ? json({ error: 'Assignments unavailable' }, false) : json(assignmentPayload());
    }
    if (path === '/api/inventory') return json({ inventory: [{ id: 'item', item_number: url.includes('retired') ? 'RETIRED-1' : 'TOOL-1', status: url.includes('retired') ? 'retired' : 'active', category: 'tools', location: null, last_checked_at: null }], pagination: { has_more: false } });
    if (path === '/api/inventory/locations') return json({ locations: [{ id: 'yard', name: 'Yard', is_active: true }, { id: 'site', name: 'Active Site', is_active: true, location_type: 'site' }] });
    if (path === '/api/inventory/fleet-assets') return json({ assets: [{ id: 'van', label: 'Van One' }] });
    if (path === '/api/inventory/categories') return json({ categories: [{ id: 'tools', slug: 'tools', name: 'Tools' }] });
    if (path === '/api/inventory/groups') return json({ groups: [] });
    throw new Error(`Unexpected request ${url}`);
  }) as typeof fetch;
});
afterEach(() => { global.fetch = originalFetch; });

describe('Inventory assignment demand loading', () => {
  it('loads cleanly after StrictMode effect replay', async () => {
    state.params = new URLSearchParams('tab=locations');
    render(<StrictMode><InventoryPage /></StrictMode>);
    expect(await screen.findByRole('region', { name: 'Assignments' })).toHaveTextContent('Assigned Worker');
    expect(screen.getByText('Locations Yard,Active Site Fleet Van One')).toBeInTheDocument();
    expect(count('/api/inventory/site-assignments')).toBe(1);
  });

  it('skips manager overview assignments while retaining retired counts and complete dialog references', async () => {
    render(<InventoryPage />);
    expect(await screen.findByText('small tools: TOOL-1')).toBeInTheDocument();
    expect(count('/api/inventory/site-assignments')).toBe(0);
    expect(screen.getByRole('tab', { name: /Retired Items \(1\)/ })).toBeInTheDocument();
    expect(count('/api/inventory')).toBe(2);
    for (const path of ['locations', 'fleet-assets', 'categories', 'groups']) expect(count(`/api/inventory/${path}`)).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: /Add Item/ }));
    expect(screen.getByText('Item references: Yard,Active Site; Tools')).toBeInTheDocument();
    expect(state.softEnabled).toBe(false);
  });

  it.each(['tab=locations', 'tab=settings&settings=locations'])('loads manager deep link %s once', async (query) => {
    state.params = new URLSearchParams(query); render(<InventoryPage />);
    expect(await screen.findByRole('region', { name: 'Assignments' })).toHaveTextContent('Assigned Worker / Active Site / Kept assignment');
    expect(count('/api/inventory/site-assignments')).toBe(1);
    expect(screen.getByText('Locations Yard,Active Site Fleet Van One')).toBeInTheDocument();
  });

  it('loads eagerly for permitted employee inline assignments', async () => {
    context.is_manager_or_admin = false; render(<InventoryPage />);
    expect(await screen.findByText('Employee inventory')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Assignments' })).toHaveTextContent('Assigned Worker');
    expect(count('/api/inventory/site-assignments')).toBe(1);
    expect(count('/api/inventory')).toBe(1);
  });

  it.each([true, false])('never requests assignments when context denies them (manager %s)', async (manager) => {
    context.is_manager_or_admin = manager; context.can_manage_site_locations = false;
    state.params = new URLSearchParams('tab=locations'); render(<InventoryPage />);
    await screen.findByText(manager ? 'Locations Yard,Active Site Fleet Van One' : 'Employee inventory');
    await refresh(); expect(count('/api/inventory/site-assignments')).toBe(0);
  });

  it('deduplicates first demand across switching and retains an empty loaded result', async () => {
    deferAssignments = true; render(<InventoryPage />); await screen.findByText('small tools: TOOL-1');
    switchTab('Locations'); await waitFor(() => expect(pending).toHaveLength(1));
    switchTab('Overview'); switchTab('Locations'); expect(pending).toHaveLength(1);
    await act(async () => { pending[0](json({ users: [], active_sites: [], assignments: [] })); });
    expect(screen.getByRole('region', { name: 'Assignments' })).toBeInTheDocument();
    switchTab('Overview'); switchTab('Locations'); expect(count('/api/inventory/site-assignments')).toBe(1);
  });

  it('isolates assignment failures, retries, and retains loaded data on refresh failure', async () => {
    failAssignments = true; state.params = new URLSearchParams('tab=locations'); render(<InventoryPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Assignments unavailable');
    expect(screen.getByText('Locations Yard,Active Site Fleet Van One')).toBeInTheDocument();
    failAssignments = false; fireEvent.click(screen.getByRole('button', { name: 'Retry Site assignments' }));
    await screen.findByRole('region', { name: 'Assignments' });
    switchTab('Overview'); failAssignments = true; await refresh(); switchTab('Locations');
    expect(screen.getByRole('alert')).toHaveTextContent('Assignments unavailable');
    expect(screen.getByRole('region', { name: 'Assignments' })).toHaveTextContent('Assigned Worker');
    expect(count('/api/inventory/site-assignments')).toBe(3);
  });

  it('refreshes loaded assignments after both assign and remove mutations', async () => {
    state.params = new URLSearchParams('tab=locations'); render(<InventoryPage />);
    await screen.findByRole('region', { name: 'Assignments' });
    fireEvent.click(screen.getByRole('button', { name: 'Assign fixture' }));
    await waitFor(() => expect(count('/api/inventory/site-assignments')).toBe(2));
    fireEvent.click(screen.getByRole('button', { name: 'Remove fixture' }));
    await waitFor(() => expect(count('/api/inventory/site-assignments')).toBe(3));
    expect(count('/api/inventory/site-assignments', 'POST')).toBe(1);
    expect(count('/api/inventory/site-assignments', 'DELETE')).toBe(1);
  });

  it('supersedes a pre-mutation assignment read with a fresh post-mutation request', async () => {
    state.params = new URLSearchParams('tab=locations'); render(<InventoryPage />);
    await screen.findByRole('region', { name: 'Assignments' });
    deferAssignments = true; await refresh(); expect(pending).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Assign fixture' }));
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => { pending[1](json(assignmentPayload('Post Mutation'))); pending[0](json(assignmentPayload('Pre Mutation'))); });
    expect(screen.getByRole('region', { name: 'Assignments' })).toHaveTextContent('Post Mutation');
    expect(screen.queryByText(/Pre Mutation/)).not.toBeInTheDocument();
  });

  it('discards assignment completions after unmount without starting further requests', async () => {
    deferAssignments = true; state.params = new URLSearchParams('tab=locations');
    const view = render(<InventoryPage />); await screen.findByText('Locations Yard,Active Site Fleet Van One');
    const reads = vi.mocked(global.fetch).mock.calls.length;
    view.unmount(); await act(async () => { pending[0](json(assignmentPayload('Unmounted'))); });
    expect(vi.mocked(global.fetch).mock.calls.length).toBe(reads);
    expect(screen.queryByText(/Unmounted/)).not.toBeInTheDocument();
  });

  it('drops old context responses and clears data on capability loss', async () => {
    deferAssignments = true; state.params = new URLSearchParams('tab=locations'); render(<InventoryPage />);
    await screen.findByText('Locations Yard,Active Site Fleet Van One');
    expect(pending).toHaveLength(1);
    context.team_id = 'replacement'; await refresh(); expect(pending).toHaveLength(2);
    await act(async () => { pending[1](json(assignmentPayload('Replacement Worker'))); pending[0](json(assignmentPayload('Old Worker'))); });
    expect(screen.getByRole('region', { name: 'Assignments' })).toHaveTextContent('Replacement Worker');
    expect(screen.queryByText(/Old Worker/)).not.toBeInTheDocument();
    context.can_manage_site_locations = false; await refresh();
    expect(screen.queryByRole('region', { name: 'Assignments' })).not.toBeInTheDocument();
    expect(count('/api/inventory/site-assignments')).toBe(2);
  });

  it('invalidates a pending assignment response across permission loss and re-grant', async () => {
    deferAssignments = true; state.params = new URLSearchParams('tab=locations'); const view = render(<InventoryPage />);
    await screen.findByText('Locations Yard,Active Site Fleet Van One');
    state.permission.hasPermission = false; view.rerender(<InventoryPage />);
    await waitFor(() => expect(state.router.push).toHaveBeenCalledWith('/dashboard'));
    state.permission.hasPermission = true; view.rerender(<InventoryPage />);
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => { pending[1](json(assignmentPayload('New Grant'))); pending[0](json(assignmentPayload('Old Grant'))); });
    expect(screen.getByRole('region', { name: 'Assignments' })).toHaveTextContent('New Grant');
    expect(screen.queryByText(/Old Grant/)).not.toBeInTheDocument();
  });

  it('preserves initial context authentication errors without assignment reads', async () => {
    failContext = true; const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<InventoryPage />); expect(await screen.findByText('Not signed in')).toBeInTheDocument();
    expect(count('/api/inventory/site-assignments')).toBe(0); consoleError.mockRestore();
  });
});
