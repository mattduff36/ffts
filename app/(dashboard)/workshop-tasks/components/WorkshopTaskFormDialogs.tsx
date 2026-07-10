import { useEffect, useMemo, useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectGroup, SelectLabel, SelectSeparator, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FileText } from 'lucide-react';
import { splitVehiclesByRecent } from '@/lib/utils/recentVehicles';
import { triggerShakeAnimation } from '@/lib/utils/animations';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import { useWorkshopDraftPersistence } from '@/lib/hooks/useWorkshopDraftPersistence';
import { WORKSHOP_TASK_COMMENT_MIN_LENGTH } from '@/lib/workshop-tasks/validation';
import {
  TabletAwareButton,
  TabletAwareSelectContent,
  TabletAwareSelectItem,
  TabletAwareSelectTrigger,
} from '@/components/ui/tablet-mode-controls';
import type { Action, AssetTab, Category, Subcategory, Vehicle } from '../types';

interface AttachmentTemplate {
  id: string;
  name: string;
  applies_to?: string[] | null;
}

function normalizeTemplateAppliesTo(rawValues?: string[] | null): string[] {
  const normalizedValues = (rawValues || [])
    .map((value) => value.trim().toLowerCase())
    .map((value) => (value === 'vehicle' ? 'van' : value))
    .filter(Boolean);

  if (normalizedValues.length === 0) return ['van', 'hgv', 'plant'];
  return Array.from(new Set(normalizedValues));
}

interface WorkshopTaskFormDialogsProps {
  userId?: string | null;
  showAddModal: boolean;
  onShowAddModalChange: (open: boolean) => void;
  assetTab: AssetTab;
  selectedVehicleId: string;
  onSelectedVehicleIdChange: (value: string) => void;
  vehicles: Vehicle[];
  getAssetDisplay: (asset?: { reg_number?: string | null; plant_id?: string | null; nickname?: string | null }) => string;
  selectedCategoryId: string;
  onSelectedCategoryIdChange: (value: string) => void;
  activeCategories: Category[];
  categoryHasSubcategories: boolean;
  selectedSubcategoryId: string;
  onSelectedSubcategoryIdChange: (value: string) => void;
  filteredSubcategories: Subcategory[];
  meterReadingType: 'mileage' | 'hours';
  newMeterReading: string;
  onNewMeterReadingChange: (value: string) => void;
  currentMeterReading: number | null;
  workshopComments: string;
  onWorkshopCommentsChange: (value: string) => void;
  attachmentTemplates: AttachmentTemplate[];
  selectedAttachmentTemplateIds: string[];
  onSelectedAttachmentTemplateIdsChange: (ids: string[]) => void;
  submitting: boolean;
  onResetAddForm: () => void;
  onFetchCurrentMeterReading: (vehicleId: string) => void;
  onCreateTask: () => void;
  showEditModal: boolean;
  onShowEditModalChange: (open: boolean) => void;
  editingTask: Action | null;
  editVehicleId: string;
  onEditVehicleIdChange: (value: string) => void;
  recentVehicleIds: string[];
  editCategoryId: string;
  onEditCategoryIdChange: (value: string) => void;
  categories: Category[];
  plantCategories: Category[];
  hgvCategories: Category[];
  editSubcategoryId: string;
  onEditSubcategoryIdChange: (value: string) => void;
  subcategories: Subcategory[];
  plantSubcategories: Subcategory[];
  hgvSubcategories: Subcategory[];
  initialEditCategoryId: string;
  initialEditHadSubcategory: boolean;
  editMileage: string;
  onEditMileageChange: (value: string) => void;
  editCurrentMileage: number | null;
  editComments: string;
  onEditCommentsChange: (value: string) => void;
  isSaveEditDisabled: boolean;
  onSaveEdit: () => void;
  onResetEditForm: () => void;
}

export function WorkshopTaskFormDialogs({
  userId,
  showAddModal,
  onShowAddModalChange,
  assetTab,
  selectedVehicleId,
  onSelectedVehicleIdChange,
  vehicles,
  getAssetDisplay,
  selectedCategoryId,
  onSelectedCategoryIdChange,
  activeCategories,
  categoryHasSubcategories,
  selectedSubcategoryId,
  onSelectedSubcategoryIdChange,
  filteredSubcategories,
  meterReadingType,
  newMeterReading,
  onNewMeterReadingChange,
  currentMeterReading,
  workshopComments,
  onWorkshopCommentsChange,
  attachmentTemplates,
  selectedAttachmentTemplateIds,
  onSelectedAttachmentTemplateIdsChange,
  submitting,
  onResetAddForm,
  onFetchCurrentMeterReading,
  onCreateTask,
  showEditModal,
  onShowEditModalChange,
  editingTask,
  editVehicleId,
  onEditVehicleIdChange,
  recentVehicleIds,
  editCategoryId,
  onEditCategoryIdChange,
  categories,
  plantCategories,
  hgvCategories,
  editSubcategoryId,
  onEditSubcategoryIdChange,
  subcategories,
  plantSubcategories,
  hgvSubcategories,
  initialEditCategoryId,
  initialEditHadSubcategory,
  editMileage,
  onEditMileageChange,
  editCurrentMileage,
  editComments,
  onEditCommentsChange,
  isSaveEditDisabled,
  onSaveEdit,
  onResetEditForm,
}: WorkshopTaskFormDialogsProps) {
  const { tabletModeEnabled } = useTabletMode();
  const addDialogContentRef = useRef<HTMLDivElement>(null);
  const editDialogContentRef = useRef<HTMLDivElement>(null);

  const isAddFormDirty = Boolean(
    selectedVehicleId ||
      selectedCategoryId ||
      selectedSubcategoryId ||
      newMeterReading.trim() ||
      workshopComments.trim() ||
      selectedAttachmentTemplateIds.length > 0
  );

  const editTaskVehicleId = editingTask?.van_id ?? editingTask?.hgv_id ?? editingTask?.plant_id ?? '';
  const editTaskComments = editingTask?.workshop_comments ?? '';
  const editTaskSubcategoryId = editingTask?.workshop_subcategory_id ?? '';
  const isEditFormDirty = Boolean(
    editVehicleId !== editTaskVehicleId ||
      editCategoryId !== initialEditCategoryId ||
      editSubcategoryId !== editTaskSubcategoryId ||
      editComments !== editTaskComments ||
      editMileage.trim()
  );
  const selectedAddVehicle = vehicles.find((vehicle) => vehicle.id === selectedVehicleId);
  const selectedAddAssetType =
    selectedAddVehicle?.asset_type === 'van' || selectedAddVehicle?.asset_type === 'plant' || selectedAddVehicle?.asset_type === 'hgv'
      ? selectedAddVehicle.asset_type
      : assetTab === 'all'
        ? null
        : assetTab;
  const filteredAttachmentTemplates = useMemo(() => {
    if (!selectedAddAssetType) return [];
    return attachmentTemplates.filter((template) =>
      normalizeTemplateAppliesTo(template.applies_to).includes(selectedAddAssetType),
    );
  }, [attachmentTemplates, selectedAddAssetType]);
  const addUsesKm = meterReadingType === 'mileage' && selectedAddVehicle?.asset_type === 'hgv';
  const addMeterLabel = meterReadingType === 'hours' ? 'Current Hours' : addUsesKm ? 'Current KM' : 'Current Mileage';
  const addMeterPlaceholder = meterReadingType === 'hours' ? 'hours' : addUsesKm ? 'KM' : 'mileage';
  const addMeterUnit = meterReadingType === 'hours' ? 'hours' : addUsesKm ? 'km' : 'miles';
  const editUsesKm = !editingTask?.plant_id && Boolean(editingTask?.hgv_id);
  const editMeterLabel = editingTask?.plant_id ? 'Current Hours' : editUsesKm ? 'Current KM' : 'Current Mileage';
  const editMeterPlaceholder = editingTask?.plant_id ? 'hours' : editUsesKm ? 'KM' : 'mileage';
  const editMeterUnit = editingTask?.plant_id ? 'hours' : editUsesKm ? 'km' : 'miles';
  const { clearDraft: clearAddDraft } = useWorkshopDraftPersistence({
    enabled: showAddModal,
    draftId: `workshop-task-add:${userId || 'anonymous'}:${assetTab}`,
    kind: 'workshop-task-add',
    ownerId: userId,
    value: {
      selectedVehicleId,
      selectedCategoryId,
      selectedSubcategoryId,
      newMeterReading,
      workshopComments,
      selectedAttachmentTemplateIds,
    },
    isDirty: isAddFormDirty,
    onRestore: (draft) => {
      onSelectedVehicleIdChange(draft.selectedVehicleId || '');
      if (draft.selectedVehicleId) onFetchCurrentMeterReading(draft.selectedVehicleId);
      onSelectedCategoryIdChange(draft.selectedCategoryId || '');
      onSelectedSubcategoryIdChange(draft.selectedSubcategoryId || '');
      onNewMeterReadingChange(draft.newMeterReading || '');
      onWorkshopCommentsChange(draft.workshopComments || '');
      onSelectedAttachmentTemplateIdsChange(draft.selectedAttachmentTemplateIds || []);
    },
  });
  const { clearDraft: clearEditDraft } = useWorkshopDraftPersistence({
    enabled: showEditModal && Boolean(editingTask),
    draftId: `workshop-task-edit:${userId || 'anonymous'}:${editingTask?.id || 'none'}`,
    kind: 'workshop-task-edit',
    ownerId: userId,
    value: {
      editVehicleId,
      editCategoryId,
      editSubcategoryId,
      editMileage,
      editComments,
    },
    isDirty: isEditFormDirty,
    onRestore: (draft) => {
      onEditVehicleIdChange(draft.editVehicleId || '');
      onEditCategoryIdChange(draft.editCategoryId || '');
      onEditSubcategoryIdChange(draft.editSubcategoryId || '');
      onEditMileageChange(draft.editMileage || '');
      onEditCommentsChange(draft.editComments || '');
    },
  });

  useEffect(() => {
    if (!showAddModal && !isAddFormDirty) {
      void clearAddDraft();
    }
  }, [clearAddDraft, isAddFormDirty, showAddModal]);

  useEffect(() => {
    if (!showEditModal && !isEditFormDirty) {
      void clearEditDraft();
    }
  }, [clearEditDraft, isEditFormDirty, showEditModal]);

  function handleAddDialogOpenChange(open: boolean) {
    if (!open && isAddFormDirty) {
      triggerShakeAnimation(addDialogContentRef.current);
      return;
    }

    onShowAddModalChange(open);
    if (!open) {
      onResetAddForm();
    }
  }

  function handleEditDialogOpenChange(open: boolean) {
    if (!open && isEditFormDirty) {
      triggerShakeAnimation(editDialogContentRef.current);
      return;
    }

    onShowEditModalChange(open);
  }

  useEffect(() => {
    if (selectedAttachmentTemplateIds.length === 0) return;
    const visibleTemplateIds = new Set(filteredAttachmentTemplates.map((template) => template.id));
    const nextSelectedTemplateIds = selectedAttachmentTemplateIds.filter((id) => visibleTemplateIds.has(id));
    if (nextSelectedTemplateIds.length !== selectedAttachmentTemplateIds.length) {
      onSelectedAttachmentTemplateIdsChange(nextSelectedTemplateIds);
    }
  }, [filteredAttachmentTemplates, onSelectedAttachmentTemplateIdsChange, selectedAttachmentTemplateIds]);

  return (
    <>
      <Dialog
        open={showAddModal}
        onOpenChange={handleAddDialogOpenChange}
      >
        <DialogContent
          ref={addDialogContentRef}
          className={`bg-white dark:bg-slate-900 border-border text-foreground max-w-lg overflow-y-auto max-h-[92vh] ${
            tabletModeEnabled ? 'max-w-xl p-5 sm:p-6' : ''
          }`}
          onInteractOutside={(event) => {
            if (isAddFormDirty) {
              event.preventDefault();
              triggerShakeAnimation(addDialogContentRef.current);
            }
          }}
          onEscapeKeyDown={(event) => {
            if (isAddFormDirty) {
              event.preventDefault();
              triggerShakeAnimation(addDialogContentRef.current);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-foreground text-xl">Create Workshop Task</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Add a new {assetTab === 'plant' ? 'plant' : assetTab === 'hgv' ? 'HGV' : assetTab === 'all' ? '' : 'van'} repair or maintenance task
            </DialogDescription>
          </DialogHeader>

          <div className={tabletModeEnabled ? 'space-y-5' : 'space-y-4'}>
            <div className="space-y-2">
              <Label htmlFor="vehicle" className="text-foreground">
                {assetTab === 'plant' ? 'Plant' : assetTab === 'hgv' ? 'HGV' : assetTab === 'all' ? 'Asset' : 'Van'} <span className="text-red-500">*</span>
              </Label>
              <Select value={selectedVehicleId} onValueChange={(value) => {
                onSelectedVehicleIdChange(value);
                if (value) {
                  onFetchCurrentMeterReading(value);
                }
              }}>
                <TabletAwareSelectTrigger id="vehicle" className="bg-white dark:bg-slate-800 border-border text-foreground">
                  <SelectValue placeholder={`Select ${assetTab === 'plant' ? 'plant' : assetTab === 'hgv' ? 'HGV' : assetTab === 'all' ? 'asset' : 'van'}`} />
                </TabletAwareSelectTrigger>
                <TabletAwareSelectContent>
                  {vehicles
                    .filter(v => assetTab === 'all' ? true : assetTab === 'plant' ? v.asset_type === 'plant' : assetTab === 'hgv' ? v.asset_type === 'hgv' : v.asset_type === 'van')
                    .map((vehicle) => (
                      <TabletAwareSelectItem key={vehicle.id} value={vehicle.id}>
                        {getAssetDisplay(vehicle)}
                      </TabletAwareSelectItem>
                    ))}
                </TabletAwareSelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="category" className="text-foreground">
                Category <span className="text-red-500">*</span>
              </Label>
              <Select value={selectedCategoryId} onValueChange={onSelectedCategoryIdChange}>
                <TabletAwareSelectTrigger id="category" className="bg-white dark:bg-slate-800 border-border text-foreground">
                  <SelectValue placeholder="Select category" />
                </TabletAwareSelectTrigger>
                <TabletAwareSelectContent>
                  {activeCategories.map((category) => (
                    <TabletAwareSelectItem key={category.id} value={category.id}>
                      {category.name}
                    </TabletAwareSelectItem>
                  ))}
                </TabletAwareSelectContent>
              </Select>
            </div>

            {categoryHasSubcategories && (
              <div className="space-y-2">
                <Label htmlFor="subcategory" className="text-foreground">
                  Subcategory <span className="text-red-500">*</span>
                </Label>
                <Select
                  value={selectedSubcategoryId}
                  onValueChange={onSelectedSubcategoryIdChange}
                  disabled={!selectedCategoryId}
                >
                  <TabletAwareSelectTrigger id="subcategory" className="bg-white dark:bg-slate-800 border-border text-foreground">
                    <SelectValue placeholder={selectedCategoryId ? 'Select subcategory' : 'Select a category first'} />
                  </TabletAwareSelectTrigger>
                  <TabletAwareSelectContent>
                    {filteredSubcategories.map((subcategory) => (
                      <TabletAwareSelectItem key={subcategory.id} value={subcategory.id}>
                        {subcategory.name}
                      </TabletAwareSelectItem>
                    ))}
                  </TabletAwareSelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="mileage" className="text-foreground">
                {addMeterLabel} <span className="text-red-500">*</span>
              </Label>
              <Input
                id="mileage"
                type="number"
                value={newMeterReading}
                onChange={(e) => onNewMeterReadingChange(e.target.value)}
                placeholder={`Enter current ${addMeterPlaceholder}`}
                className="bg-white dark:bg-slate-800 border-border text-foreground"
                min="0"
                step="1"
              />
              {currentMeterReading !== null && (
                <p className="text-xs text-muted-foreground">
                  Last recorded: {currentMeterReading.toLocaleString()} {addMeterUnit}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="comments" className="text-foreground">
                Task Details <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="comments"
                value={workshopComments}
                onChange={(e) => onWorkshopCommentsChange(e.target.value)}
                placeholder={`Describe the work needed (minimum ${WORKSHOP_TASK_COMMENT_MIN_LENGTH} characters)`}
                className="bg-white dark:bg-slate-800 border-border text-foreground min-h-[100px]"
                maxLength={300}
              />
              <p className="text-xs text-muted-foreground">
                {workshopComments.length}/300 characters (minimum {WORKSHOP_TASK_COMMENT_MIN_LENGTH})
              </p>
            </div>

            {attachmentTemplates.length > 0 && (
              <div className="space-y-2">
                <Label className="text-foreground flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Attachments (Optional)
                </Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Add service checklists or documentation to complete later
                </p>
                <div className={`space-y-2 max-h-40 overflow-y-auto p-2 border border-border rounded-md bg-muted/30 ${tabletModeEnabled ? 'p-3' : ''}`}>
                  {!selectedAddAssetType && (
                    <p className="text-xs text-muted-foreground">
                      Select an asset first to see relevant attachments.
                    </p>
                  )}
                  {selectedAddAssetType && filteredAttachmentTemplates.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No templates are available for this {selectedAddAssetType.toUpperCase()} asset.
                    </p>
                  )}
                  {filteredAttachmentTemplates.map((template) => (
                    <div key={template.id} className={`flex items-center ${tabletModeEnabled ? 'space-x-3 py-1' : 'space-x-2'}`}>
                      <input
                        type="checkbox"
                        id={`template-inline-${template.id}`}
                        checked={selectedAttachmentTemplateIds.includes(template.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            onSelectedAttachmentTemplateIdsChange([...selectedAttachmentTemplateIds, template.id]);
                          } else {
                            onSelectedAttachmentTemplateIdsChange(selectedAttachmentTemplateIds.filter(id => id !== template.id));
                          }
                        }}
                        className={`rounded border-gray-300 text-workshop focus:ring-workshop ${tabletModeEnabled ? 'h-5 w-5' : 'h-4 w-4'}`}
                      />
                      <label
                        htmlFor={`template-inline-${template.id}`}
                        className={`font-normal cursor-pointer text-foreground ${tabletModeEnabled ? 'text-base' : 'text-sm'}`}
                      >
                        {template.name}
                      </label>
                    </div>
                  ))}
                </div>
                {selectedAttachmentTemplateIds.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {selectedAttachmentTemplateIds.length} attachment{selectedAttachmentTemplateIds.length > 1 ? 's' : ''} will be added to this task
                  </p>
                )}
              </div>
            )}
          </div>

          <DialogFooter className={tabletModeEnabled ? 'gap-3 pt-2' : 'gap-3'}>
            <TabletAwareButton
              variant="outline"
              onClick={() => {
                void clearAddDraft();
                onShowAddModalChange(false);
                onResetAddForm();
              }}
              className="border-border text-foreground hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {isAddFormDirty ? 'Discard Changes' : 'Cancel'}
            </TabletAwareButton>
            <TabletAwareButton
              onClick={onCreateTask}
              disabled={submitting || !selectedVehicleId || !selectedCategoryId || (categoryHasSubcategories && !selectedSubcategoryId) || workshopComments.trim().length < WORKSHOP_TASK_COMMENT_MIN_LENGTH || !newMeterReading.trim()}
              className="bg-workshop hover:bg-workshop-dark text-white"
            >
              {submitting ? 'Creating...' : 'Create Task'}
            </TabletAwareButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditModal} onOpenChange={handleEditDialogOpenChange}>
        <DialogContent
          ref={editDialogContentRef}
          className={`bg-white dark:bg-slate-900 border-border text-foreground max-w-lg overflow-y-auto max-h-[92vh] ${
            tabletModeEnabled ? 'max-w-xl p-5 sm:p-6' : ''
          }`}
          onInteractOutside={(event) => {
            if (isEditFormDirty) {
              event.preventDefault();
              triggerShakeAnimation(editDialogContentRef.current);
            }
          }}
          onEscapeKeyDown={(event) => {
            if (isEditFormDirty) {
              event.preventDefault();
              triggerShakeAnimation(editDialogContentRef.current);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-foreground text-xl">Edit Workshop Task</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Update the workshop task details
            </DialogDescription>
          </DialogHeader>

          <div className={tabletModeEnabled ? 'space-y-5' : 'space-y-4'}>
            <div className="space-y-2">
              <Label htmlFor="edit-vehicle" className="text-foreground">
                {editingTask?.plant_id ? 'Plant' : editingTask?.hgv_id ? 'HGV' : 'Van'} <span className="text-red-500">*</span>
              </Label>
              <Select value={editVehicleId} onValueChange={onEditVehicleIdChange}>
                <TabletAwareSelectTrigger id="edit-vehicle" className="bg-white dark:bg-slate-800 border-border text-foreground">
                  <SelectValue placeholder={editingTask?.plant_id ? 'Select plant' : editingTask?.hgv_id ? 'Select HGV' : 'Select van'} />
                </TabletAwareSelectTrigger>
                <TabletAwareSelectContent>
                  {(() => {
                    const isEditingPlant = !!editingTask?.plant_id;
                    const isEditingHgv = !!editingTask?.hgv_id;
                    const filteredVehicles = vehicles.filter(v =>
                      isEditingPlant ? v.asset_type === 'plant' : isEditingHgv ? v.asset_type === 'hgv' : v.asset_type === 'van'
                    );
                    const { recentVehicles, otherVehicles } = splitVehiclesByRecent(filteredVehicles, recentVehicleIds);
                    return (
                      <>
                        {recentVehicles.length > 0 && (
                          <SelectGroup>
                            <SelectLabel className="text-muted-foreground text-xs px-2 py-1.5">Recent</SelectLabel>
                            {recentVehicles.map((vehicle) => (
                              <TabletAwareSelectItem key={vehicle.id} value={vehicle.id}>
                                {getAssetDisplay(vehicle)}
                              </TabletAwareSelectItem>
                            ))}
                          </SelectGroup>
                        )}
                        {recentVehicles.length > 0 && otherVehicles.length > 0 && (
                          <SelectSeparator />
                        )}
                        {otherVehicles.length > 0 && (
                          <SelectGroup>
                            {recentVehicles.length > 0 && (
                              <SelectLabel className="text-muted-foreground text-xs px-2 py-1.5">All {isEditingPlant ? 'Plant' : isEditingHgv ? 'HGVs' : 'Vans'}</SelectLabel>
                            )}
                            {otherVehicles.map((vehicle) => (
                              <TabletAwareSelectItem key={vehicle.id} value={vehicle.id}>
                                {getAssetDisplay(vehicle)}
                              </TabletAwareSelectItem>
                            ))}
                          </SelectGroup>
                        )}
                      </>
                    );
                  })()}
                </TabletAwareSelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-category" className="text-foreground">
                Category <span className="text-red-500">*</span>
              </Label>
              <Select value={editCategoryId} onValueChange={onEditCategoryIdChange}>
                <TabletAwareSelectTrigger id="edit-category" className="bg-white dark:bg-slate-800 border-border text-foreground">
                  <SelectValue placeholder="Select category" />
                </TabletAwareSelectTrigger>
                <TabletAwareSelectContent>
                  {(() => {
                    const editCategories = editingTask?.plant_id ? plantCategories : editingTask?.hgv_id ? hgvCategories : categories;
                    return editCategories.map((category) => (
                      <TabletAwareSelectItem key={category.id} value={category.id}>
                        {category.name}
                      </TabletAwareSelectItem>
                    ));
                  })()}
                </TabletAwareSelectContent>
              </Select>
            </div>

            {(() => {
              const editSubcategoriesArray = editingTask?.plant_id ? plantSubcategories : editingTask?.hgv_id ? hgvSubcategories : subcategories;
              const editFilteredSubcategories = editSubcategoriesArray.filter(s => s.category_id === editCategoryId);
              if (editFilteredSubcategories.length === 0) return null;

              const categoryChanged = editCategoryId !== initialEditCategoryId;
              const isRequired = initialEditHadSubcategory || categoryChanged;

              return (
                <div className="space-y-2">
                  <Label htmlFor="edit-subcategory" className="text-foreground">
                    Subcategory {isRequired && <span className="text-red-500">*</span>}
                  </Label>
                  <Select value={editSubcategoryId} onValueChange={onEditSubcategoryIdChange}>
                    <TabletAwareSelectTrigger id="edit-subcategory" className="bg-white dark:bg-slate-800 border-border text-foreground">
                      <SelectValue placeholder="Select subcategory" />
                    </TabletAwareSelectTrigger>
                    <TabletAwareSelectContent>
                      {editFilteredSubcategories.map((sub) => (
                        <TabletAwareSelectItem key={sub.id} value={sub.id}>
                          {sub.name}
                        </TabletAwareSelectItem>
                      ))}
                    </TabletAwareSelectContent>
                  </Select>
                </div>
              );
            })()}

            <div className="space-y-2">
              <Label htmlFor="edit-mileage" className="text-foreground">
                {editMeterLabel} <span className="text-red-500">*</span>
              </Label>
              <Input
                id="edit-mileage"
                type="number"
                value={editMileage}
                onChange={(e) => onEditMileageChange(e.target.value)}
                placeholder={`Enter current ${editMeterPlaceholder}`}
                className="bg-white dark:bg-slate-800 border-border text-foreground"
                min="0"
                step="1"
              />
              {editCurrentMileage !== null && (
                <p className="text-xs text-muted-foreground">
                  Last recorded: {editCurrentMileage.toLocaleString()} {editMeterUnit}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-comments" className="text-foreground">
                Task Details <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="edit-comments"
                value={editComments}
                onChange={(e) => onEditCommentsChange(e.target.value)}
                placeholder={`Describe the work needed (minimum ${WORKSHOP_TASK_COMMENT_MIN_LENGTH} characters)`}
                className="bg-white dark:bg-slate-800 border-border text-foreground min-h-[100px]"
                maxLength={300}
              />
              <p className="text-xs text-muted-foreground">
                {editComments.length}/300 characters (minimum {WORKSHOP_TASK_COMMENT_MIN_LENGTH})
              </p>
            </div>
          </div>

          <DialogFooter className={tabletModeEnabled ? 'gap-3 pt-2' : 'gap-3'}>
            <TabletAwareButton
              variant="outline"
              onClick={() => {
                void clearEditDraft();
                onResetEditForm();
              }}
              className="border-border text-foreground hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {isEditFormDirty ? 'Discard Changes' : 'Cancel'}
            </TabletAwareButton>
            <TabletAwareButton
              onClick={onSaveEdit}
              disabled={isSaveEditDisabled}
              className="bg-workshop hover:bg-workshop-dark text-white"
            >
              {submitting ? 'Saving...' : 'Save Changes'}
            </TabletAwareButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
