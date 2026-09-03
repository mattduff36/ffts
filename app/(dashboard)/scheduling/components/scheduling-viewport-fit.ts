export const SCHEDULING_BOARD_MIN_SCALE = 0.67;

/** Fallback when the board has not been measured yet. Fits nowrap title rows plus the 350px Resources column. */
export const SCHEDULING_BOARD_MIN_CONTENT_WIDTH_PX = 1480;

/** Tailwind `md` is 768px; MobileNavBar uses `md:hidden`. */
export const SCHEDULING_MOBILE_MAX_WIDTH_PX = 767;

const RESOURCES_COLUMN_PX = 350;
const GRID_GAP_PX = 16;
const CARD_X_PADDING_PX = 48;

export type SchedulingViewportFitMode = 'full' | 'scaled' | 'blocked';

export interface SchedulingViewportFit {
  mode: SchedulingViewportFitMode;
  scale: number;
}

export function getSchedulingViewportFit(input: {
  availableWidth: number;
  minContentWidth: number;
  isMobile: boolean;
}): SchedulingViewportFit {
  if (input.isMobile) {
    return { mode: 'blocked', scale: 0 };
  }

  if (input.availableWidth <= 0) {
    return { mode: 'full', scale: 1 };
  }

  const minWidth = Math.max(1, input.minContentWidth);
  const raw = input.availableWidth / minWidth;
  if (raw < SCHEDULING_BOARD_MIN_SCALE) {
    return { mode: 'blocked', scale: raw };
  }
  if (raw >= 1) {
    return { mode: 'full', scale: 1 };
  }
  return { mode: 'scaled', scale: raw };
}

function measureFlexChildrenWidth(el: HTMLElement, gapPx: number): number {
  const children = Array.from(el.children) as HTMLElement[];
  if (children.length === 0) {
    return Math.ceil(el.scrollWidth);
  }
  const childrenWidth = children.reduce((sum, child) => sum + child.offsetWidth, 0);
  return Math.ceil(childrenWidth + gapPx * Math.max(0, children.length - 1));
}

export function getRemainingViewportHeight(input: {
  top: number;
  viewportHeight: number;
  bottomInset: number;
}): number {
  return Math.max(0, Math.floor(input.viewportHeight - input.top - input.bottomInset));
}

export function readMainBottomInset(el: HTMLElement): number {
  const main = el.closest('main');
  if (!main || typeof window.getComputedStyle !== 'function') {
    return 0;
  }
  const paddingBottom = Number.parseFloat(window.getComputedStyle(main).paddingBottom);
  return Number.isFinite(paddingBottom) ? paddingBottom : 0;
}

export function measureSchedulingMinContentWidth(root: HTMLElement): number {
  const headerRoot = root.querySelector<HTMLElement>('[data-testid="schedule-page-header"]');
  const headerRow = headerRoot?.querySelector<HTMLElement>('.flex.flex-row.flex-nowrap');
  const titleRow = root.querySelector<HTMLElement>('[data-testid="schedule-board-title-row"]');
  const headerMin = headerRow
    ? measureFlexChildrenWidth(headerRow, 12) + CARD_X_PADDING_PX
    : 0;
  const boardMin = titleRow
    ? measureFlexChildrenWidth(titleRow, 12) + CARD_X_PADDING_PX + RESOURCES_COLUMN_PX + GRID_GAP_PX
    : 0;
  return Math.max(SCHEDULING_BOARD_MIN_CONTENT_WIDTH_PX, headerMin, boardMin);
}
