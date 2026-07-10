import { HardHat, Truck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReminderAssetType } from '@/types/reminders';

export const FLEET_INSPECTION_OVERDUE_WORKFLOW_KEY = 'fleet_inspection_overdue';
export const VAN_DRAFT_SUBMISSION_WORKFLOW_KEY = 'van_draft_submission';
export const TOOLBOX_TALK_MANUAL_REMINDER_WORKFLOW_KEY = 'toolbox_talk_manual';

export interface ReminderOverviewTabConfig {
  id: string;
  label: string;
  icon: LucideIcon;
  workflowKey: string;
  assetType?: ReminderAssetType;
}

export interface ReminderWorkflowConfig {
  key: string;
  label: string;
  description: string;
  settingsPanelId: string;
}

export const REMINDER_OVERVIEW_TABS: ReminderOverviewTabConfig[] = [
  {
    id: 'vans',
    label: 'Vans',
    icon: Truck,
    workflowKey: FLEET_INSPECTION_OVERDUE_WORKFLOW_KEY,
    assetType: 'van',
  },
  {
    id: 'plant',
    label: 'Plant',
    icon: HardHat,
    workflowKey: FLEET_INSPECTION_OVERDUE_WORKFLOW_KEY,
    assetType: 'plant',
  },
  {
    id: 'hgvs',
    label: 'HGVs',
    icon: Truck,
    workflowKey: FLEET_INSPECTION_OVERDUE_WORKFLOW_KEY,
    assetType: 'hgv',
  },
];

export const REMINDER_WORKFLOWS: ReminderWorkflowConfig[] = [
  {
    key: FLEET_INSPECTION_OVERDUE_WORKFLOW_KEY,
    label: 'Fleet inspections',
    description: 'Overdue daily check reminders for vans, plant, and HGVs.',
    settingsPanelId: 'fleet-inspection',
  },
];

export const REMINDER_OVERVIEW_TAB_IDS = REMINDER_OVERVIEW_TABS.map((tab) => tab.id);

export function getReminderOverviewTab(id: string): ReminderOverviewTabConfig | undefined {
  return REMINDER_OVERVIEW_TABS.find((tab) => tab.id === id);
}

export function getReminderWorkflow(key: string): ReminderWorkflowConfig | undefined {
  return REMINDER_WORKFLOWS.find((workflow) => workflow.key === key);
}

export function isValidReminderOverviewTabId(id: string): boolean {
  return REMINDER_OVERVIEW_TAB_IDS.includes(id);
}

export function isValidReminderWorkflowKey(key: string): boolean {
  return REMINDER_WORKFLOWS.some((workflow) => workflow.key === key);
}
