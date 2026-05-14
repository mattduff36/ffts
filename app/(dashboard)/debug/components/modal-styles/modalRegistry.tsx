'use client';

import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ProcessTimesheetModal } from '@/app/(dashboard)/approvals/components/ProcessTimesheetModal';
import { ConfirmationModal } from '@/app/(dashboard)/timesheets/components/ConfirmationModal';
import { ErrorDetailsModal } from '@/components/ui/error-details-modal';
import { QuoteFormDialog } from '@/app/(dashboard)/quotes/components/QuoteFormDialog';
import { QuoteDetailsModal } from '@/app/(dashboard)/quotes/components/QuoteDetailsModal';
import { VehicleCategoryDialog } from '@/app/(dashboard)/fleet/components/VehicleCategoryDialog';
import { HgvCategoryDialog } from '@/app/(dashboard)/fleet/components/HgvCategoryDialog';
import { AddAssetFlowDialog } from '@/app/(dashboard)/maintenance/components/add-asset/AddAssetFlowDialog';
import { AddAssetTypeDialog } from '@/app/(dashboard)/maintenance/components/add-asset/AddAssetTypeDialog';
import { AddPlantDialog } from '@/app/(dashboard)/maintenance/components/add-asset/AddPlantDialog';
import { AddVanDialog } from '@/app/(dashboard)/maintenance/components/add-asset/AddVanDialog';
import { AddHgvDialog } from '@/app/(dashboard)/maintenance/components/add-asset/AddHgvDialog';
import { DeleteVehicleDialog } from '@/app/(dashboard)/maintenance/components/DeleteVehicleDialog';
import { DeletePlantDialog } from '@/app/(dashboard)/maintenance/components/DeletePlantDialog';
import { MaintenanceHistoryDialog } from '@/app/(dashboard)/maintenance/components/MaintenanceHistoryDialog';
import { MotHistoryDialog } from '@/app/(dashboard)/maintenance/components/MotHistoryDialog';
import { OfficeActionDialog } from '@/app/(dashboard)/maintenance/components/OfficeActionDialog';
import { CategoryDialog } from '@/app/(dashboard)/maintenance/components/CategoryDialog';
import { CategoryRecipientsDialog } from '@/app/(dashboard)/maintenance/components/CategoryRecipientsDialog';
import { CustomerFormDialog } from '@/app/(dashboard)/customers/components/CustomerFormDialog';
import { AssignRecipientsModal } from '@/components/messages/AssignRecipientsModal';
import { ReminderModal } from '@/components/messages/ReminderModal';
import { TimesheetAdjustmentModal } from '@/components/timesheets/TimesheetAdjustmentModal';
import { AssetLocationMapModal } from '@/components/fleet/AssetLocationMapModal';
import {
  DEMO_CUSTOMER_FORM,
  DEMO_CUSTOMERS,
  DEMO_ERROR_DETAILS,
  DEMO_MAINTENANCE_CATEGORY,
  DEMO_REMINDER_MESSAGE,
  DEMO_TIMESHEET_ENTRIES,
} from './fixtures';
import { createSafeAction } from './safeActions';

export type ModalKind = 'dialog' | 'alert-dialog' | 'drawer' | 'composite';
export type ModalStatus = 'implemented' | 'placeholder' | 'blocked-by-context';
const PRIMARY_CTA_CLASS = 'bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90 font-semibold';

export interface ModalVariant {
  id: string;
  label: string;
  description?: string;
}

export interface ModalRenderContext {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variantId: string;
}

export interface ModalShowcaseEntry {
  id: string;
  label: string;
  feature: string;
  kind: ModalKind;
  status: ModalStatus;
  sourcePath: string;
  notes?: string;
  variants: ModalVariant[];
  render: (context: ModalRenderContext) => ReactNode;
}

const defaultVariant: ModalVariant[] = [{ id: 'default', label: 'Default' }];

function PlaceholderModal({
  open,
  onOpenChange,
  label,
  sourcePath,
  notes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  sourcePath: string;
  notes?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            Replica preview for styling. This entry cannot be mounted directly, so this dialog mirrors typical modal structure.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md border border-border p-3 text-sm text-muted-foreground">
            <p>Source: `{sourcePath}`</p>
            {notes ? <p className="mt-1">{notes}</p> : null}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Sample Field</p>
              <div className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm text-muted-foreground">
                Demo value
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Sample Select</p>
              <div className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm text-muted-foreground">
                Option A
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Sample Body Content</p>
            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
              Use this replica to tune dialog container, spacing, typography, and footer actions while a dedicated adapter is added.
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button className={PRIMARY_CTA_CLASS} onClick={createSafeAction(`${label} secondary action`)}>
            Secondary
          </Button>
          <Button className={PRIMARY_CTA_CLASS} onClick={createSafeAction(`${label} primary action`)}>
            Primary
          </Button>
          <Button className={PRIMARY_CTA_CLASS} onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function createPlaceholderEntry(config: {
  id: string;
  label: string;
  feature: string;
  kind: ModalKind;
  status?: ModalStatus;
  sourcePath: string;
  notes?: string;
}): ModalShowcaseEntry {
  return {
    ...config,
    status: config.status ?? 'placeholder',
    variants: defaultVariant,
    render: ({ open, onOpenChange }) => (
      <PlaceholderModal
        open={open}
        onOpenChange={onOpenChange}
        label={config.label}
        sourcePath={config.sourcePath}
        notes={config.notes}
      />
    ),
  };
}

const placeholderEntries: ModalShowcaseEntry[] = [
  createPlaceholderEntry({
    id: 'quote-details-modal',
    label: 'QuoteDetailsModal',
    feature: 'Quotes',
    kind: 'dialog',
    sourcePath: 'app/(dashboard)/quotes/components/QuoteDetailsModal.tsx',
    notes: 'Fetches quote data and supports status transitions; needs mocked API or adapter.',
  }),
  createPlaceholderEntry({
    id: 'quote-form-dialog',
    label: 'QuoteFormDialog',
    feature: 'Quotes',
    kind: 'dialog',
    sourcePath: 'app/(dashboard)/quotes/components/QuoteFormDialog.tsx',
  }),
  createPlaceholderEntry({
    id: 'workshop-task-modal',
    label: 'WorkshopTaskModal',
    feature: 'Workshop Tasks',
    kind: 'dialog',
    sourcePath: 'components/workshop-tasks/WorkshopTaskModal.tsx',
  }),
  createPlaceholderEntry({
    id: 'create-workshop-task-dialog',
    label: 'CreateWorkshopTaskDialog',
    feature: 'Workshop Tasks',
    kind: 'dialog',
    sourcePath: 'components/workshop-tasks/CreateWorkshopTaskDialog.tsx',
  }),
  createPlaceholderEntry({
    id: 'subcategory-dialog',
    label: 'SubcategoryDialog',
    feature: 'Workshop Tasks',
    kind: 'dialog',
    sourcePath: 'components/workshop-tasks/SubcategoryDialog.tsx',
  }),
  createPlaceholderEntry({
    id: 'mark-task-complete-dialog',
    label: 'MarkTaskCompleteDialog',
    feature: 'Workshop Tasks',
    kind: 'dialog',
    sourcePath: 'components/workshop-tasks/MarkTaskCompleteDialog.tsx',
  }),
  createPlaceholderEntry({
    id: 'attachment-form-modal',
    label: 'AttachmentHybridFormModal',
    feature: 'Workshop Tasks',
    kind: 'dialog',
    sourcePath: 'components/workshop-tasks/AttachmentHybridFormModal.tsx',
  }),
  createPlaceholderEntry({
    id: 'task-comments-drawer',
    label: 'TaskCommentsDrawer',
    feature: 'Workshop Tasks',
    kind: 'drawer',
    sourcePath: 'components/workshop-tasks/TaskCommentsDrawer.tsx',
    notes: 'Loads timeline and mutates comments through API calls.',
  }),
  createPlaceholderEntry({
    id: 'assign-employees-modal',
    label: 'AssignEmployeesModal',
    feature: 'RAMS',
    kind: 'dialog',
    sourcePath: 'components/rams/AssignEmployeesModal.tsx',
  }),
  createPlaceholderEntry({
    id: 'upload-rams-modal',
    label: 'UploadRAMSModal',
    feature: 'RAMS',
    kind: 'dialog',
    sourcePath: 'components/rams/UploadRAMSModal.tsx',
  }),
  createPlaceholderEntry({
    id: 'sign-rams-modal',
    label: 'SignRAMSModal',
    feature: 'RAMS',
    kind: 'dialog',
    sourcePath: 'components/rams/SignRAMSModal.tsx',
  }),
  createPlaceholderEntry({
    id: 'record-visitor-signature-modal',
    label: 'RecordVisitorSignatureModal',
    feature: 'RAMS',
    kind: 'dialog',
    sourcePath: 'components/rams/RecordVisitorSignatureModal.tsx',
  }),
  createPlaceholderEntry({
    id: 'asset-location-map-modal',
    label: 'AssetLocationMapModal',
    feature: 'Fleet',
    kind: 'dialog',
    sourcePath: 'components/fleet/AssetLocationMapModal.tsx',
    notes: 'Depends on MapTiler API key and live location fetches.',
  }),
  createPlaceholderEntry({
    id: 'vehicle-category-dialog',
    label: 'VehicleCategoryDialog',
    feature: 'Fleet',
    kind: 'dialog',
    sourcePath: 'app/(dashboard)/fleet/components/VehicleCategoryDialog.tsx',
  }),
  createPlaceholderEntry({
    id: 'hgv-category-dialog',
    label: 'HgvCategoryDialog',
    feature: 'Fleet',
    kind: 'dialog',
    sourcePath: 'app/(dashboard)/fleet/components/HgvCategoryDialog.tsx',
  }),
  createPlaceholderEntry({
    id: 'fleet-category-dialogs',
    label: 'FleetCategoryDialogs',
    feature: 'Fleet',
    kind: 'composite',
    sourcePath: 'app/(dashboard)/fleet/components/FleetCategoryDialogs.tsx',
    notes: 'Wrapper containing multiple category modals.',
  }),
  createPlaceholderEntry({
    id: 'add-vehicle-dialog',
    label: 'AddVehicleDialog',
    feature: 'Maintenance',
    kind: 'dialog',
    sourcePath: 'app/(dashboard)/maintenance/components/AddVehicleDialog.tsx',
  }),
  createPlaceholderEntry({
    id: 'delete-vehicle-dialog',
    label: 'DeleteVehicleDialog',
    feature: 'Maintenance',
    kind: 'alert-dialog',
    sourcePath: 'app/(dashboard)/maintenance/components/DeleteVehicleDialog.tsx',
  }),
  createPlaceholderEntry({
    id: 'maintenance-history-dialog',
    label: 'MaintenanceHistoryDialog',
    feature: 'Maintenance',
    kind: 'dialog',
    sourcePath: 'app/(dashboard)/maintenance/components/MaintenanceHistoryDialog.tsx',
  }),
  createPlaceholderEntry({
    id: 'mot-history-dialog',
    label: 'MotHistoryDialog',
    feature: 'Maintenance',
    kind: 'dialog',
    sourcePath: 'app/(dashboard)/maintenance/components/MotHistoryDialog.tsx',
  }),
  createPlaceholderEntry({
    id: 'edit-maintenance-dialog',
    label: 'EditMaintenanceDialog',
    feature: 'Maintenance',
    kind: 'dialog',
    sourcePath: 'app/(dashboard)/maintenance/components/EditMaintenanceDialog.tsx',
  }),
  createPlaceholderEntry({
    id: 'edit-plant-record-dialog',
    label: 'EditPlantRecordDialog',
    feature: 'Maintenance',
    kind: 'dialog',
    sourcePath: 'app/(dashboard)/maintenance/components/EditPlantRecordDialog.tsx',
  }),
  createPlaceholderEntry({
    id: 'office-action-dialog',
    label: 'OfficeActionDialog',
    feature: 'Maintenance',
    kind: 'dialog',
    sourcePath: 'app/(dashboard)/maintenance/components/OfficeActionDialog.tsx',
  }),
  createPlaceholderEntry({
    id: 'delete-plant-dialog',
    label: 'DeletePlantDialog',
    feature: 'Maintenance',
    kind: 'alert-dialog',
    sourcePath: 'app/(dashboard)/maintenance/components/DeletePlantDialog.tsx',
  }),
  createPlaceholderEntry({
    id: 'category-dialog',
    label: 'CategoryDialog',
    feature: 'Maintenance',
    kind: 'dialog',
    sourcePath: 'app/(dashboard)/maintenance/components/CategoryDialog.tsx',
  }),
  createPlaceholderEntry({
    id: 'category-recipients-dialog',
    label: 'CategoryRecipientsDialog',
    feature: 'Maintenance',
    kind: 'dialog',
    sourcePath: 'app/(dashboard)/maintenance/components/CategoryRecipientsDialog.tsx',
  }),
  createPlaceholderEntry({
    id: 'add-asset-flow-dialog',
    label: 'AddAssetFlowDialog',
    feature: 'Maintenance',
    kind: 'dialog',
    sourcePath: 'app/(dashboard)/maintenance/components/add-asset/AddAssetFlowDialog.tsx',
  }),
  createPlaceholderEntry({
    id: 'add-asset-type-dialog',
    label: 'AddAssetTypeDialog',
    feature: 'Maintenance',
    kind: 'dialog',
    sourcePath: 'app/(dashboard)/maintenance/components/add-asset/AddAssetTypeDialog.tsx',
  }),
  createPlaceholderEntry({
    id: 'add-plant-dialog',
    label: 'AddPlantDialog',
    feature: 'Maintenance',
    kind: 'dialog',
    sourcePath: 'app/(dashboard)/maintenance/components/add-asset/AddPlantDialog.tsx',
  }),
  createPlaceholderEntry({
    id: 'add-van-dialog',
    label: 'AddVanDialog',
    feature: 'Maintenance',
    kind: 'dialog',
    sourcePath: 'app/(dashboard)/maintenance/components/add-asset/AddVanDialog.tsx',
  }),
  createPlaceholderEntry({
    id: 'add-hgv-dialog',
    label: 'AddHgvDialog',
    feature: 'Maintenance',
    kind: 'dialog',
    sourcePath: 'app/(dashboard)/maintenance/components/add-asset/AddHgvDialog.tsx',
  }),
  createPlaceholderEntry({
    id: 'customer-form-dialog',
    label: 'CustomerFormDialog',
    feature: 'Customers',
    kind: 'dialog',
    sourcePath: 'app/(dashboard)/customers/components/CustomerFormDialog.tsx',
  }),
  createPlaceholderEntry({
    id: 'assign-recipients-modal',
    label: 'AssignRecipientsModal',
    feature: 'Messages',
    kind: 'dialog',
    sourcePath: 'components/messages/AssignRecipientsModal.tsx',
  }),
  createPlaceholderEntry({
    id: 'blocking-message-modal',
    label: 'BlockingMessageModal',
    feature: 'Messages',
    kind: 'dialog',
    sourcePath: 'components/messages/BlockingMessageModal.tsx',
    notes: 'Intentionally blocks interaction and posts signature to API.',
  }),
  createPlaceholderEntry({
    id: 'reminder-modal',
    label: 'ReminderModal',
    feature: 'Messages',
    kind: 'dialog',
    sourcePath: 'components/messages/ReminderModal.tsx',
    notes: 'Marks notifications as dismissed when opened.',
  }),
  createPlaceholderEntry({
    id: 'timesheet-adjustment-modal',
    label: 'TimesheetAdjustmentModal',
    feature: 'Timesheets',
    kind: 'dialog',
    sourcePath: 'components/timesheets/TimesheetAdjustmentModal.tsx',
  }),
  createPlaceholderEntry({
    id: 'workshop-task-admin-dialogs',
    label: 'WorkshopTaskAdminDialogs',
    feature: 'Workshop Tasks',
    kind: 'composite',
    sourcePath: 'app/(dashboard)/workshop-tasks/components/WorkshopTaskAdminDialogs.tsx',
  }),
  createPlaceholderEntry({
    id: 'workshop-task-status-dialogs',
    label: 'WorkshopTaskStatusDialogs',
    feature: 'Workshop Tasks',
    kind: 'composite',
    sourcePath: 'app/(dashboard)/workshop-tasks/components/WorkshopTaskStatusDialogs.tsx',
  }),
  createPlaceholderEntry({
    id: 'workshop-task-form-dialogs',
    label: 'WorkshopTaskFormDialogs',
    feature: 'Workshop Tasks',
    kind: 'composite',
    sourcePath: 'app/(dashboard)/workshop-tasks/components/WorkshopTaskFormDialogs.tsx',
  }),
  createPlaceholderEntry({
    id: 'timesheets-page-inline-modals',
    label: 'Timesheets Page Inline Modals',
    feature: 'Timesheets',
    kind: 'composite',
    sourcePath: 'app/(dashboard)/timesheets/page.tsx',
    notes: 'Inline stateful modal composition within page container.',
  }),
  createPlaceholderEntry({
    id: 'approvals-page-inline-modals',
    label: 'Approvals Page Inline Modals',
    feature: 'Approvals',
    kind: 'composite',
    sourcePath: 'app/(dashboard)/approvals/page.tsx',
  }),
  createPlaceholderEntry({
    id: 'van-inspections-page-inline-modals',
    label: 'Van Inspections Inline Modals',
    feature: 'Inspections',
    kind: 'composite',
    sourcePath: 'app/(dashboard)/van-inspections/page.tsx',
  }),
  createPlaceholderEntry({
    id: 'fleet-page-inline-modals',
    label: 'Fleet Page Inline Modals',
    feature: 'Fleet',
    kind: 'composite',
    sourcePath: 'app/(dashboard)/fleet/page.tsx',
  }),
  createPlaceholderEntry({
    id: 'maintenance-page-inline-modals',
    label: 'Maintenance Page Inline Modals',
    feature: 'Maintenance',
    kind: 'composite',
    sourcePath: 'app/(dashboard)/maintenance/page.tsx',
  }),
  createPlaceholderEntry({
    id: 'quotes-page-inline-modals',
    label: 'Quotes Page Inline Modals',
    feature: 'Quotes',
    kind: 'composite',
    sourcePath: 'app/(dashboard)/quotes/page.tsx',
  }),
  createPlaceholderEntry({
    id: 'projects-settings-inline-dialogs',
    label: 'Projects Settings Inline Dialogs',
    feature: 'Projects',
    kind: 'composite',
    sourcePath: 'app/(dashboard)/projects/settings/page.tsx',
  }),
  createPlaceholderEntry({
    id: 'admin-users-inline-dialogs',
    label: 'Admin Users Inline Dialogs',
    feature: 'Admin',
    kind: 'composite',
    sourcePath: 'app/(dashboard)/admin/users/page.tsx',
  }),
];

const liveContextEntries: ModalShowcaseEntry[] = [
  {
    id: 'quote-form-dialog',
    label: 'QuoteFormDialog',
    feature: 'Quotes',
    kind: 'dialog',
    status: 'implemented',
    sourcePath: 'app/(dashboard)/quotes/components/QuoteFormDialog.tsx',
    variants: [{ id: 'create', label: 'Create' }, { id: 'edit', label: 'Edit' }],
    render: ({ open, onOpenChange, variantId }) => (
      <QuoteFormDialog
        open={open}
        onClose={() => onOpenChange(false)}
        onSubmit={async () => {
          createSafeAction('Quote form submit')();
        }}
        quote={variantId === 'edit' ? ({
          ...DEMO_CUSTOMER_FORM,
          id: 'quote-1',
          quote_reference: '40000-GH',
          base_quote_reference: '40000-GH',
          quote_thread_id: 'quote-1',
          parent_quote_id: null,
          customer_id: 'customer-1',
          requester_id: 'manager-1',
          requester_initials: 'GH',
          quote_date: '2026-03-01',
          attention_name: 'Jordan Smith',
          attention_email: 'jordan.smith@example.com',
          subject_line: 'Demo quote',
          project_description: 'Demo quote project',
          salutation: 'Dear Jordan,',
          site_address: '1 Demo Street\nIndustrial Estate\nNottingham, Nottinghamshire\nNG1 1AA',
          validity_days: 30,
          subtotal: 100,
          total: 100,
          status: 'draft',
          accepted: false,
          po_number: null,
          po_received_at: null,
          po_value: null,
          started: false,
          start_date: '',
          start_alert_days: null,
          start_alert_sent_at: null,
          invoice_number: null,
          invoice_notes: null,
          last_invoice_at: null,
          signoff_name: 'Example User One',
          signoff_title: 'Contracts Manager',
          custom_footer_text: '',
          revision_number: 0,
          revision_type: 'original',
          version_label: 'Original',
          version_notes: null,
          is_latest_version: true,
          duplicate_source_quote_id: null,
          manager_name: 'Example User One',
          manager_email: 'george@example.com',
          approver_profile_id: 'approver-1',
          approved_by: null,
          approved_at: null,
          returned_at: null,
          return_comments: null,
          customer_sent_at: null,
          customer_sent_by: null,
          completion_status: 'not_completed',
          completion_comments: null,
          commercial_status: 'open',
          closed_at: null,
          rams_requested_at: null,
          created_at: '2026-03-01T10:00:00.000Z',
          updated_at: '2026-03-01T10:00:00.000Z',
          created_by: 'manager-1',
          updated_by: 'manager-1',
          sent_at: null,
          accepted_at: null,
          invoiced_at: null,
          line_items: [{ description: 'Line item', quantity: 1, unit: 'each', unit_rate: 100, line_total: 100, sort_order: 0 }],
        } as never) : null}
        customers={DEMO_CUSTOMERS}
        managerOptions={[{
          profile_id: 'manager-1',
          initials: 'GH',
          next_number: 40001,
          number_start: 40000,
          signoff_name: 'Example User One',
          signoff_title: 'Contracts Manager',
          manager_email: 'george@example.com',
          approver_profile_id: 'approver-1',
          is_active: true,
          profile: { id: 'manager-1', full_name: 'Example User One', email: 'george@example.com' },
          approver: { id: 'approver-1', full_name: 'Example Approver', email: 'debug.user@example.com' },
        }]}
        approvers={[{ id: 'approver-1', full_name: 'Example Approver', email: 'debug.user@example.com' }]}
      />
    ),
  },
  {
    id: 'quote-details-modal',
    label: 'QuoteDetailsModal',
    feature: 'Quotes',
    kind: 'dialog',
    status: 'implemented',
    sourcePath: 'app/(dashboard)/quotes/components/QuoteDetailsModal.tsx',
    variants: defaultVariant,
    render: ({ open, onOpenChange }) => (
      <QuoteDetailsModal
        open={open}
        onClose={() => onOpenChange(false)}
        quoteId="demo-quote-id"
        onQuoteChange={createSafeAction('Quote change')}
        onEdit={createSafeAction('Quote edit')}
        onRefresh={createSafeAction('Quote refresh')}
      />
    ),
  },
  {
    id: 'vehicle-category-dialog',
    label: 'VehicleCategoryDialog',
    feature: 'Fleet',
    kind: 'dialog',
    status: 'implemented',
    sourcePath: 'app/(dashboard)/fleet/components/VehicleCategoryDialog.tsx',
    variants: [{ id: 'create', label: 'Create' }, { id: 'edit', label: 'Edit' }],
    render: ({ open, onOpenChange, variantId }) => (
      <VehicleCategoryDialog
        open={open}
        onOpenChange={onOpenChange}
        mode={variantId === 'edit' ? 'edit' : 'create'}
        category={variantId === 'edit' ? { id: 'cat-1', name: 'Demo Fleet Category', description: 'Demo description', applies_to: ['van', 'plant'] } : null}
        onSuccess={createSafeAction('Vehicle category success')}
      />
    ),
  },
  {
    id: 'hgv-category-dialog',
    label: 'HgvCategoryDialog',
    feature: 'Fleet',
    kind: 'dialog',
    status: 'implemented',
    sourcePath: 'app/(dashboard)/fleet/components/HgvCategoryDialog.tsx',
    variants: [{ id: 'create', label: 'Create' }, { id: 'edit', label: 'Edit' }],
    render: ({ open, onOpenChange, variantId }) => (
      <HgvCategoryDialog
        open={open}
        onOpenChange={onOpenChange}
        mode={variantId === 'edit' ? 'edit' : 'create'}
        category={variantId === 'edit' ? { id: 'hgv-cat-1', name: 'Rigid', description: 'Demo HGV category' } : null}
        onSuccess={createSafeAction('HGV category success')}
      />
    ),
  },
  {
    id: 'add-asset-flow-dialog',
    label: 'AddAssetFlowDialog',
    feature: 'Maintenance',
    kind: 'dialog',
    status: 'implemented',
    sourcePath: 'app/(dashboard)/maintenance/components/add-asset/AddAssetFlowDialog.tsx',
    variants: defaultVariant,
    render: ({ open, onOpenChange }) => (
      <AddAssetFlowDialog open={open} onOpenChange={onOpenChange} onSuccess={createSafeAction('Add asset success')} />
    ),
  },
  {
    id: 'add-asset-type-dialog',
    label: 'AddAssetTypeDialog',
    feature: 'Maintenance',
    kind: 'dialog',
    status: 'implemented',
    sourcePath: 'app/(dashboard)/maintenance/components/add-asset/AddAssetTypeDialog.tsx',
    variants: defaultVariant,
    render: ({ open, onOpenChange }) => (
      <AddAssetTypeDialog
        open={open}
        onOpenChange={onOpenChange}
        onSelectType={() => {
          createSafeAction('Select asset type')();
        }}
      />
    ),
  },
  {
    id: 'add-plant-dialog',
    label: 'AddPlantDialog',
    feature: 'Maintenance',
    kind: 'dialog',
    status: 'implemented',
    sourcePath: 'app/(dashboard)/maintenance/components/add-asset/AddPlantDialog.tsx',
    variants: defaultVariant,
    render: ({ open, onOpenChange }) => (
      <AddPlantDialog open={open} onOpenChange={onOpenChange} onSuccess={createSafeAction('Add plant success')} />
    ),
  },
  {
    id: 'add-van-dialog',
    label: 'AddVanDialog',
    feature: 'Maintenance',
    kind: 'dialog',
    status: 'implemented',
    sourcePath: 'app/(dashboard)/maintenance/components/add-asset/AddVanDialog.tsx',
    variants: defaultVariant,
    render: ({ open, onOpenChange }) => (
      <AddVanDialog open={open} onOpenChange={onOpenChange} onSuccess={createSafeAction('Add van success')} />
    ),
  },
  {
    id: 'add-hgv-dialog',
    label: 'AddHgvDialog',
    feature: 'Maintenance',
    kind: 'dialog',
    status: 'implemented',
    sourcePath: 'app/(dashboard)/maintenance/components/add-asset/AddHgvDialog.tsx',
    variants: defaultVariant,
    render: ({ open, onOpenChange }) => (
      <AddHgvDialog open={open} onOpenChange={onOpenChange} onSuccess={createSafeAction('Add HGV success')} />
    ),
  },
  {
    id: 'delete-vehicle-dialog',
    label: 'DeleteVehicleDialog',
    feature: 'Maintenance',
    kind: 'alert-dialog',
    status: 'implemented',
    sourcePath: 'app/(dashboard)/maintenance/components/DeleteVehicleDialog.tsx',
    variants: defaultVariant,
    render: ({ open, onOpenChange }) => (
      <DeleteVehicleDialog
        open={open}
        onOpenChange={onOpenChange}
        vehicle={{ id: 'vehicle-1', reg_number: 'AB12 CDE', category: { name: 'Van' } }}
        endpoint="vans"
        entityLabel="Van"
      />
    ),
  },
  {
    id: 'delete-plant-dialog',
    label: 'DeletePlantDialog',
    feature: 'Maintenance',
    kind: 'alert-dialog',
    status: 'implemented',
    sourcePath: 'app/(dashboard)/maintenance/components/DeletePlantDialog.tsx',
    variants: defaultVariant,
    render: ({ open, onOpenChange }) => (
      <DeletePlantDialog
        open={open}
        onOpenChange={onOpenChange}
        plant={{ id: 'plant-1', plant_id: 'P-101', nickname: 'Demo Plant', van_categories: { name: 'Plant' } }}
      />
    ),
  },
  {
    id: 'office-action-dialog',
    label: 'OfficeActionDialog',
    feature: 'Maintenance',
    kind: 'dialog',
    status: 'implemented',
    sourcePath: 'app/(dashboard)/maintenance/components/OfficeActionDialog.tsx',
    variants: defaultVariant,
    render: ({ open, onOpenChange }) => (
      <OfficeActionDialog
        open={open}
        onOpenChange={onOpenChange}
        vehicleId="vehicle-1"
        vehicleReg="AB12 CDE"
        vehicleNickname="Demo Van"
        alertType="Tax"
        dueInfo="Overdue by 7 days"
      />
    ),
  },
  {
    id: 'maintenance-history-dialog',
    label: 'MaintenanceHistoryDialog',
    feature: 'Maintenance',
    kind: 'dialog',
    status: 'implemented',
    sourcePath: 'app/(dashboard)/maintenance/components/MaintenanceHistoryDialog.tsx',
    variants: defaultVariant,
    render: ({ open, onOpenChange }) => (
      <MaintenanceHistoryDialog open={open} onOpenChange={onOpenChange} vehicleId="vehicle-1" vehicleReg="AB12 CDE" />
    ),
  },
  {
    id: 'mot-history-dialog',
    label: 'MotHistoryDialog',
    feature: 'Maintenance',
    kind: 'dialog',
    status: 'implemented',
    sourcePath: 'app/(dashboard)/maintenance/components/MotHistoryDialog.tsx',
    variants: defaultVariant,
    render: ({ open, onOpenChange }) => (
      <MotHistoryDialog open={open} onOpenChange={onOpenChange} vehicleReg="AB12 CDE" vehicleId="vehicle-1" />
    ),
  },
  {
    id: 'category-dialog',
    label: 'CategoryDialog',
    feature: 'Maintenance',
    kind: 'dialog',
    status: 'implemented',
    sourcePath: 'app/(dashboard)/maintenance/components/CategoryDialog.tsx',
    variants: [{ id: 'create', label: 'Create' }, { id: 'edit', label: 'Edit' }],
    render: ({ open, onOpenChange, variantId }) => (
      <CategoryDialog
        open={open}
        onOpenChange={onOpenChange}
        mode={variantId === 'edit' ? 'edit' : 'create'}
        category={variantId === 'edit' ? DEMO_MAINTENANCE_CATEGORY : null}
      />
    ),
  },
  {
    id: 'category-recipients-dialog',
    label: 'CategoryRecipientsDialog',
    feature: 'Maintenance',
    kind: 'dialog',
    status: 'implemented',
    sourcePath: 'app/(dashboard)/maintenance/components/CategoryRecipientsDialog.tsx',
    variants: defaultVariant,
    render: ({ open, onOpenChange }) => (
      <CategoryRecipientsDialog open={open} onOpenChange={onOpenChange} category={DEMO_MAINTENANCE_CATEGORY} />
    ),
  },
  {
    id: 'customer-form-dialog',
    label: 'CustomerFormDialog',
    feature: 'Customers',
    kind: 'dialog',
    status: 'implemented',
    sourcePath: 'app/(dashboard)/customers/components/CustomerFormDialog.tsx',
    variants: [{ id: 'create', label: 'Create' }, { id: 'edit', label: 'Edit' }],
    render: ({ open, onOpenChange, variantId }) => (
      <CustomerFormDialog
        open={open}
        onClose={() => onOpenChange(false)}
        onSubmit={async () => {
          createSafeAction('Customer save')();
        }}
        customer={variantId === 'edit' ? (DEMO_CUSTOMER_FORM as never) : null}
      />
    ),
  },
  {
    id: 'assign-recipients-modal',
    label: 'AssignRecipientsModal',
    feature: 'Messages',
    kind: 'dialog',
    status: 'implemented',
    sourcePath: 'components/messages/AssignRecipientsModal.tsx',
    variants: defaultVariant,
    render: ({ open, onOpenChange }) => (
      <AssignRecipientsModal
        open={open}
        onClose={() => onOpenChange(false)}
        onSend={async () => {
          createSafeAction('Assign recipients send')();
        }}
        messageSubject="Demo message subject"
        messageType="REMINDER"
      />
    ),
  },
  {
    id: 'reminder-modal',
    label: 'ReminderModal',
    feature: 'Messages',
    kind: 'dialog',
    status: 'implemented',
    sourcePath: 'components/messages/ReminderModal.tsx',
    variants: defaultVariant,
    render: ({ open, onOpenChange }) => (
      <ReminderModal
        open={open}
        onClose={() => onOpenChange(false)}
        onDismissed={createSafeAction('Reminder dismissed')}
        message={DEMO_REMINDER_MESSAGE}
      />
    ),
  },
  {
    id: 'timesheet-adjustment-modal',
    label: 'TimesheetAdjustmentModal',
    feature: 'Timesheets',
    kind: 'dialog',
    status: 'implemented',
    sourcePath: 'components/timesheets/TimesheetAdjustmentModal.tsx',
    variants: defaultVariant,
    render: ({ open, onOpenChange }) => (
      <TimesheetAdjustmentModal
        open={open}
        onClose={() => onOpenChange(false)}
        onConfirm={async () => {
          createSafeAction('Timesheet adjustment confirm')();
        }}
        employeeName="Demo Employee"
        weekEnding="2026-03-15"
      />
    ),
  },
  {
    id: 'asset-location-map-modal',
    label: 'AssetLocationMapModal',
    feature: 'Fleet',
    kind: 'dialog',
    status: 'implemented',
    sourcePath: 'components/fleet/AssetLocationMapModal.tsx',
    variants: defaultVariant,
    render: ({ open, onOpenChange }) => (
      <AssetLocationMapModal
        open={open}
        onOpenChange={onOpenChange}
        assetLabel="Demo Asset"
        location={{
          vehicleId: 'vehicle-1',
          name: 'Demo Vehicle',
          vrn: 'AB12 CDE',
          lat: 52.9548,
          lng: -1.1581,
          speed: 0,
          heading: 0,
          updatedAt: new Date().toISOString(),
        }}
      />
    ),
  },
];

const LIVE_CONTEXT_IDS = new Set(liveContextEntries.map((entry) => entry.id));

export const modalShowcaseRegistry: ModalShowcaseEntry[] = [
  {
    id: 'shadcn-dialog-primitive',
    label: 'Dialog Primitive',
    feature: 'UI Primitives',
    kind: 'dialog',
    status: 'implemented',
    sourcePath: 'components/ui/dialog.tsx',
    variants: [
      { id: 'default', label: 'Default' },
      { id: 'wide', label: 'Wide Content' },
    ],
    render: ({ open, onOpenChange, variantId }) => (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={variantId === 'wide' ? 'max-w-3xl' : 'max-w-lg'}>
          <DialogHeader>
            <DialogTitle>Dialog Primitive Preview</DialogTitle>
            <DialogDescription>
              Baseline shell for all `DialogContent` styling updates.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
            Variant: <Badge variant="outline">{variantId}</Badge>
          </div>
          <DialogFooter>
            <Button className={PRIMARY_CTA_CLASS} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button className={PRIMARY_CTA_CLASS} onClick={createSafeAction('Dialog confirm')}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    ),
  },
  {
    id: 'shadcn-alert-dialog-primitive',
    label: 'AlertDialog Primitive',
    feature: 'UI Primitives',
    kind: 'alert-dialog',
    status: 'implemented',
    sourcePath: 'components/ui/alert-dialog.tsx',
    variants: [
      { id: 'default', label: 'Default' },
      { id: 'destructive-copy', label: 'Destructive Copy' },
    ],
    render: ({ open, onOpenChange, variantId }) => (
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {variantId === 'destructive-copy' ? 'Delete record?' : 'Confirm action'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {variantId === 'destructive-copy'
                ? 'This cannot be undone. Use this variant to test destructive emphasis.'
                : 'Use this variant to review default spacing and button layout.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={createSafeAction('AlertDialog confirm')}>
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    ),
  },
  {
    id: 'process-timesheet-modal',
    label: 'ProcessTimesheetModal',
    feature: 'Approvals',
    kind: 'alert-dialog',
    status: 'implemented',
    sourcePath: 'app/(dashboard)/approvals/components/ProcessTimesheetModal.tsx',
    variants: [
      { id: 'idle', label: 'Idle' },
      { id: 'processing', label: 'Processing State' },
    ],
    render: ({ open, onOpenChange, variantId }) => (
      <ProcessTimesheetModal
        open={open}
        onOpenChange={onOpenChange}
        onConfirm={createSafeAction('Process timesheet')}
        processing={variantId === 'processing'}
      />
    ),
  },
  {
    id: 'timesheet-confirmation-modal',
    label: 'ConfirmationModal',
    feature: 'Timesheets',
    kind: 'dialog',
    status: 'implemented',
    sourcePath: 'app/(dashboard)/timesheets/components/ConfirmationModal.tsx',
    variants: [
      { id: 'normal', label: 'Normal' },
      { id: 'warning', label: 'Warning-heavy' },
      { id: 'submitting', label: 'Submitting' },
    ],
    render: ({ open, onOpenChange, variantId }) => (
      <ConfirmationModal
        open={open}
        onClose={() => onOpenChange(false)}
        onConfirm={createSafeAction('Submit timesheet')}
        weekEnding="2026-03-15"
        entries={variantId === 'warning' ? DEMO_TIMESHEET_ENTRIES.warning : DEMO_TIMESHEET_ENTRIES.normal}
        regNumber="AB12 CDE"
        submitting={variantId === 'submitting'}
      />
    ),
  },
  {
    id: 'error-details-modal',
    label: 'ErrorDetailsModal',
    feature: 'Errors',
    kind: 'dialog',
    status: 'implemented',
    sourcePath: 'components/ui/error-details-modal.tsx',
    variants: [
      { id: 'loading', label: 'Loading' },
      { id: 'pending', label: 'Pending Tasks' },
      { id: 'subcategory', label: 'Subcategory Tasks' },
    ],
    render: ({ open, onOpenChange, variantId }) => (
      <ErrorDetailsModal
        open={open}
        onClose={() => onOpenChange(false)}
        loading={variantId === 'loading'}
        data={
          variantId === 'subcategory'
            ? DEMO_ERROR_DETAILS.subcategory
            : variantId === 'pending'
              ? DEMO_ERROR_DETAILS.pending
              : null
        }
        onAction={createSafeAction('Error details action')}
      />
    ),
  },
  ...liveContextEntries,
  ...placeholderEntries.filter((entry) => !LIVE_CONTEXT_IDS.has(entry.id)),
];
