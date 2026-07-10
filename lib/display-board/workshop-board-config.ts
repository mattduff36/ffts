import type { MobileTextSizeStep } from '@/lib/config/mobile-text-size-preference';
import { templateConfig } from '@/lib/config/template-config';

export const WORKSHOP_DISPLAY_BOARD_DEVICE_TOKEN_STORAGE_KEY = 'displayboard-workshop-device-token';
export const WORKSHOP_DISPLAY_BOARD_PAIRING_TOKEN_STORAGE_KEY = 'displayboard-workshop-pairing-token';
export const WORKSHOP_DISPLAY_BOARD_TEXT_SIZE_DEFAULT_STEP: MobileTextSizeStep = 3;
export const WORKSHOP_DISPLAY_BOARD_RIGHT_PANEL_SCROLL_SPEED_MULTIPLIER = 1.6;
export const WORKSHOP_DISPLAY_BOARD_TOP_MAINTENANCE_LIMIT = 12;
export const WORKSHOP_DISPLAY_BOARD_BRAND = `${templateConfig.branding.shortAppName} Workshop`;
export const WORKSHOP_DISPLAY_BOARD_TITLE = 'Live Display Board';
export const WORKSHOP_DISPLAY_BOARD_MAINTENANCE_TITLE = 'Maintenance';
export const WORKSHOP_DISPLAY_BOARD_EMPTY_MAINTENANCE_LABEL = 'No overdue or due soon maintenance.';

export interface WorkshopDisplayBoardStatDefinition {
  id: string;
  label: string;
  tone: 'red' | 'amber' | 'blue' | 'purple' | 'green' | 'slate';
  source: 'maintenance' | 'workshop';
  valueKey: string;
}

export interface WorkshopDisplayBoardTaskPanelDefinition {
  id: 'pending' | 'inProgress' | 'onHold';
  title: string;
  tone: 'amber' | 'blue' | 'purple';
  emptyLabel: string;
  itemsKey: 'pending' | 'in_progress' | 'on_hold';
  autoScrollKey: 'pending' | 'inProgress' | 'onHold';
}

export const WORKSHOP_DISPLAY_BOARD_STAT_TILES: WorkshopDisplayBoardStatDefinition[] = [
  { id: 'all-assets', label: 'All Assets', tone: 'slate', source: 'maintenance', valueKey: 'total' },
  { id: 'maintenance-overdue', label: 'Maintenance Overdue', tone: 'red', source: 'maintenance', valueKey: 'overdue' },
  { id: 'due-soon', label: 'Due Soon', tone: 'amber', source: 'maintenance', valueKey: 'due_soon' },
  { id: 'high-priority', label: 'High Priority', tone: 'red', source: 'workshop', valueKey: 'high_priority' },
  { id: 'pending', label: 'Pending', tone: 'amber', source: 'workshop', valueKey: 'pending' },
  { id: 'in-progress', label: 'In Progress', tone: 'blue', source: 'workshop', valueKey: 'in_progress' },
  { id: 'on-hold', label: 'On Hold', tone: 'purple', source: 'workshop', valueKey: 'on_hold' },
];

export const WORKSHOP_DISPLAY_BOARD_TASK_PANELS: WorkshopDisplayBoardTaskPanelDefinition[] = [
  {
    id: 'pending',
    title: 'Pending Workshop Tasks',
    tone: 'amber',
    emptyLabel: 'No pending workshop tasks.',
    itemsKey: 'pending',
    autoScrollKey: 'pending',
  },
  {
    id: 'inProgress',
    title: 'In Progress Workshop Tasks',
    tone: 'blue',
    emptyLabel: 'No tasks in progress.',
    itemsKey: 'in_progress',
    autoScrollKey: 'inProgress',
  },
  {
    id: 'onHold',
    title: 'On Hold Workshop Tasks',
    tone: 'purple',
    emptyLabel: 'No tasks on hold.',
    itemsKey: 'on_hold',
    autoScrollKey: 'onHold',
  },
];
