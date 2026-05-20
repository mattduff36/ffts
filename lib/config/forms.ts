import { 
  FileText, 
  ClipboardCheck,
  Wrench,
  FileCheck2,
  CalendarDays,
  Settings,
  HelpCircle,
  Truck,
  PackageSearch,
  LucideIcon
} from 'lucide-react';

/**
 * Form Type Configuration
 * 
 * This file defines all available form types in the system.
 * To add a new form type:
 * 1. Add route handlers in app/(dashboard)/[formtype]/...
 * 2. Add entry to FORM_TYPES array below
 * 3. Add corresponding color variables to globals.css if needed
 * 
 * The system will automatically:
 * - Show the form in dashboard quick actions
 * - Include it in navigation (if desired)
 * - Track it in recent activity
 * - Include it in reports
 */

export interface FormType {
  id: string;
  title: string;
  subtitle?: string;
  description: string;
  icon: LucideIcon;
  href: string;
  listHref: string;
  color: string; // Must match CSS custom property in globals.css
  enabled: boolean; // Toggle to enable/disable without removing code
}

export const FORM_TYPES: FormType[] = [
  {
    id: 'timesheet',
    title: 'Timesheets',
    description: 'Weekly time tracking',
    icon: FileText,
    href: '/timesheets',
    listHref: '/timesheets',
    color: 'timesheet',
    enabled: true,
  },
  {
    id: 'inspection',
    title: 'Van Daily Checks',
    description: 'Safety checklist',
    icon: ClipboardCheck,
    href: '/van-inspections',
    listHref: '/van-inspections',
    color: 'inspection',
    enabled: true,
  },
  {
    id: 'plant-inspection',
    title: 'Plant Daily Checks',
    description: 'Plant machinery safety checklist',
    icon: ClipboardCheck,
    href: '/plant-inspections',
    listHref: '/plant-inspections',
    color: 'plant-inspection',
    enabled: true,
  },
  {
    id: 'hgv-inspection',
    title: 'HGV Daily Checks',
    description: 'Daily 25-point safety checklist',
    icon: ClipboardCheck,
    href: '/hgv-inspections',
    listHref: '/hgv-inspections',
    color: 'hgv-inspection',
    enabled: true,
  },
  {
    id: 'rams',
    title: 'Projects',
    description: 'Project documents & compliance',
    icon: FileCheck2,
    href: '/projects',
    listHref: '/projects',
    color: 'rams',
    enabled: true,
  },
  {
    id: 'absence',
    title: 'Absence & Leave',
    description: 'Request and manage annual leave',
    icon: CalendarDays,
    href: '/absence',
    listHref: '/absence',
    color: 'absence',
    enabled: true,
  },
  {
    id: 'maintenance',
    title: 'Maintenance & Service',
    description: 'Vehicle maintenance tracking',
    icon: Wrench,
    href: '/maintenance',
    listHref: '/maintenance',
    color: 'maintenance',
    enabled: true,
  },
  {
    id: 'fleet',
    title: 'Fleet',
    description: 'Manage vans, HGVs and plant',
    icon: Truck,
    href: '/fleet',
    listHref: '/fleet',
    color: 'fleet',
    enabled: true,
  },
  {
    id: 'workshop',
    title: 'Workshop Tasks',
    description: 'Van & plant repairs and workshop work',
    icon: Settings,
    href: '/workshop-tasks',
    listHref: '/workshop-tasks',
    color: 'workshop',
    enabled: true,
  },
  {
    id: 'inventory',
    title: 'Inventory',
    description: 'Small tools, equipment & locations',
    icon: PackageSearch,
    href: '/inventory',
    listHref: '/inventory',
    color: 'inventory',
    enabled: true,
  },
  {
    id: 'help',
    title: 'Help',
    description: 'FAQs and support resources',
    icon: HelpCircle,
    href: '/help',
    listHref: '/help',
    color: 'brand-yellow', // Brand yellow color
    enabled: true,
  },
  // Add future form types here only after their app routes exist.
];

/**
 * Get only enabled form types
 */
export function getEnabledForms(): FormType[] {
  return FORM_TYPES.filter(form => form.enabled);
}

/**
 * Get form type by ID
 */
export function getFormType(id: string): FormType | undefined {
  return FORM_TYPES.find(form => form.id === id);
}

/**
 * Get form type by path
 */
export function getFormTypeByPath(path: string): FormType | undefined {
  return FORM_TYPES.find(form => 
    path.startsWith(form.listHref) || path.startsWith(form.href)
  );
}

