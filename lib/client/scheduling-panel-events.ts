export const SCHEDULING_PANEL_SAVED = 'ffts:scheduling-panel-saved';
export const SCHEDULING_PANEL_LOCKED = 'ffts:scheduling-panel-locked';

export type SchedulingPanelModule = 'quotes' | 'customers';

export function schedulingPanelForLink(
  pathname: string | null,
  href: string,
  event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean },
): SchedulingPanelModule | null {
  if (pathname !== '/scheduling' || event.defaultPrevented || event.button !== 0
    || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  return href === '/quotes' ? 'quotes' : href === '/customers' ? 'customers' : null;
}

export function notifySchedulingPanelSaved() {
  window.dispatchEvent(new Event(SCHEDULING_PANEL_SAVED));
}

export function notifySchedulingPanelLocked(url: string, status: number | null) {
  if (status !== 401 && status !== 403 && status !== 428) return;
  const panelModule = url.startsWith('/api/customers') ? 'customers' : 'quotes';
  window.dispatchEvent(new CustomEvent(SCHEDULING_PANEL_LOCKED, { detail: { module: panelModule, status } }));
}
