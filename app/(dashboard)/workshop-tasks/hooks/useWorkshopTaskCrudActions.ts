import type React from 'react';
import { toast } from 'sonner';
import { recordRecentVehicleId } from '@/lib/utils/recentVehicles';
import { showErrorWithDetails, fetchErrorDetails } from '@/lib/utils/error-details';
import { inferAssetMeterUnit } from '@/lib/workshop-tasks/asset-meter';
import { WORKSHOP_TASK_COMMENT_MIN_LENGTH } from '@/lib/workshop-tasks/validation';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ErrorDetailsResponse } from '@/types/error-details';
import type { Action, Category, Subcategory, Vehicle } from '../types';

interface UseWorkshopTaskCrudActionsParams {
  supabase: SupabaseClient;
  userId: string | null | undefined;
  categoryTaxonomyMode: 'van' | 'plant' | 'hgv';
  vehicles: Vehicle[];
  subcategories: Subcategory[];
  plantSubcategories: Subcategory[];
  hgvSubcategories: Subcategory[];
  selectedVehicleId: string;
  selectedCategoryId: string;
  selectedSubcategoryId: string;
  workshopComments: string;
  newMeterReading: string;
  currentMeterReading: number | null;
  meterReadingType: 'mileage' | 'hours';
  selectedAttachmentTemplateIds: string[];
  categoryHasSubcategories: boolean;
  editingTask: Action | null;
  editVehicleId: string;
  editCategoryId: string;
  editSubcategoryId: string;
  editComments: string;
  editMileage: string;
  editCurrentMileage: number | null;
  initialEditCategoryId: string;
  initialEditHadSubcategory: boolean;
  taskToDelete: Action | null;
  categoryName: string;
  editingCategory: Category | null;
  submitting: boolean;
  setSubmitting: (submitting: boolean) => void;
  setShowAddModal: (open: boolean) => void;
  setSelectedVehicleId: (value: string) => void;
  setSelectedCategoryId: (value: string) => void;
  setSelectedSubcategoryId: (value: string) => void;
  setWorkshopComments: (value: string) => void;
  setNewMeterReading: (value: string) => void;
  setCurrentMeterReading: (value: number | null) => void;
  setMeterReadingType: (value: 'mileage' | 'hours') => void;
  setSelectedAttachmentTemplateIds: (value: string[]) => void;
  setEditingTask: (task: Action | null) => void;
  setShowEditModal: (open: boolean) => void;
  setEditVehicleId: (value: string) => void;
  setEditCategoryId: (value: string) => void;
  setEditSubcategoryId: (value: string) => void;
  setEditComments: (value: string) => void;
  setEditMileage: (value: string) => void;
  setEditCurrentMileage: (value: number | null) => void;
  setInitialEditCategoryId: (value: string) => void;
  setInitialEditHadSubcategory: (value: boolean) => void;
  setShowDeleteConfirm: (open: boolean) => void;
  setTaskToDelete: (task: Action | null) => void;
  setTasks: React.Dispatch<React.SetStateAction<Action[]>>;
  setDeleting: (deleting: boolean) => void;
  setShowCategoryModal: (open: boolean) => void;
  setCategoryName: (value: string) => void;
  setSubmittingCategory: (submitting: boolean) => void;
  setEditingCategory: (category: Category | null) => void;
  setShowSubcategoryModal: (open: boolean) => void;
  setSubcategoryMode: (mode: 'create' | 'edit') => void;
  setSelectedCategoryForSubcategory: (category: Category | null) => void;
  setEditingSubcategory: (subcategory: Subcategory | null) => void;
  setShowErrorDetailsModal: (open: boolean) => void;
  setErrorDetailsLoading: (loading: boolean) => void;
  setErrorDetails: (details: ErrorDetailsResponse | null) => void;
  setRecentVehicleIds: (ids: string[]) => void;
  fetchTasks: () => Promise<void>;
  fetchCategories: () => Promise<void>;
  fetchPlantCategories: () => Promise<void>;
  fetchHgvCategories: () => Promise<void>;
  fetchSubcategories: () => Promise<void>;
  getAssetIdLabel: (asset?: { reg_number?: string | null; plant_id?: string | null }) => string;
}

interface CreateWorkshopTaskResponse {
  error?: string;
  task?: {
    id: string;
  };
  meter_reading_updated?: boolean;
}

export function useWorkshopTaskCrudActions({
  supabase,
  userId,
  categoryTaxonomyMode,
  vehicles,
  subcategories,
  plantSubcategories,
  hgvSubcategories,
  selectedVehicleId,
  selectedCategoryId,
  selectedSubcategoryId,
  workshopComments,
  newMeterReading,
  currentMeterReading,
  meterReadingType,
  selectedAttachmentTemplateIds,
  categoryHasSubcategories,
  editingTask,
  editVehicleId,
  editCategoryId,
  editSubcategoryId,
  editComments,
  editMileage,
  editCurrentMileage,
  initialEditCategoryId,
  initialEditHadSubcategory,
  taskToDelete,
  categoryName,
  editingCategory,
  submitting,
  setSubmitting,
  setShowAddModal,
  setSelectedVehicleId,
  setSelectedCategoryId,
  setSelectedSubcategoryId,
  setWorkshopComments,
  setNewMeterReading,
  setCurrentMeterReading,
  setMeterReadingType,
  setSelectedAttachmentTemplateIds,
  setEditingTask,
  setShowEditModal,
  setEditVehicleId,
  setEditCategoryId,
  setEditSubcategoryId,
  setEditComments,
  setEditMileage,
  setEditCurrentMileage,
  setInitialEditCategoryId,
  setInitialEditHadSubcategory,
  setShowDeleteConfirm,
  setTaskToDelete,
  setTasks,
  setDeleting,
  setShowCategoryModal,
  setCategoryName,
  setSubmittingCategory,
  setEditingCategory,
  setShowSubcategoryModal,
  setSubcategoryMode,
  setSelectedCategoryForSubcategory,
  setEditingSubcategory,
  setShowErrorDetailsModal,
  setErrorDetailsLoading,
  setErrorDetails,
  setRecentVehicleIds,
  fetchTasks,
  fetchCategories,
  fetchPlantCategories,
  fetchHgvCategories,
  fetchSubcategories,
  getAssetIdLabel,
}: UseWorkshopTaskCrudActionsParams) {
  const resetAddForm = () => {
    setSelectedVehicleId('');
    setSelectedCategoryId('');
    setSelectedSubcategoryId('');
    setWorkshopComments('');
    setNewMeterReading('');
    setCurrentMeterReading(null);
    setMeterReadingType('mileage');
    setSelectedAttachmentTemplateIds([]);
  };

  const handleAddTask = async () => {
    if (!userId) {
      toast.error('You must be logged in to create tasks');
      return;
    }

    const needsSubcategory = categoryHasSubcategories;
    if (!selectedVehicleId || !selectedCategoryId || (needsSubcategory && !selectedSubcategoryId) || !workshopComments.trim() || !newMeterReading.trim()) {
      toast.error('Please fill in all required fields');
      return;
    }

    if (workshopComments.trim().length < WORKSHOP_TASK_COMMENT_MIN_LENGTH) {
      toast.error(`Comments must be at least ${WORKSHOP_TASK_COMMENT_MIN_LENGTH} characters`);
      return;
    }

    const readingValue = parseInt(newMeterReading);
    const selectedVehicleForValidation = vehicles.find(v => v.id === selectedVehicleId);
    const usesKm = selectedVehicleForValidation?.asset_type === 'hgv';
    const meterDescriptor = meterReadingType === 'hours' ? 'hours' : usesKm ? 'KM' : 'mileage';
    const meterLabel = meterReadingType === 'hours' ? 'Hours' : usesKm ? 'KM' : 'Mileage';
    const meterUnit = meterReadingType === 'hours' ? 'hours' : usesKm ? 'km' : 'miles';
    if (isNaN(readingValue) || readingValue < 0) {
      toast.error(`Please enter a valid ${meterDescriptor}`);
      return;
    }

    if (currentMeterReading !== null && readingValue < currentMeterReading) {
      toast.error(`${meterLabel} must be equal to or greater than current reading (${currentMeterReading.toLocaleString()} ${meterUnit})`);
      return;
    }

    try {
      setSubmitting(true);

      const selectedVehicle = vehicles.find(v => v.id === selectedVehicleId);
      const selectedAssetType = selectedVehicle?.asset_type;
      if (selectedAssetType !== 'van' && selectedAssetType !== 'plant' && selectedAssetType !== 'hgv') {
        toast.error('Please select a valid asset');
        return;
      }

      const isHgv = selectedAssetType === 'hgv';
      const taskTitle = `Workshop Task - ${getAssetIdLabel(selectedVehicle)}`;

      const createTaskResponse = await fetch('/api/workshop-tasks/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicle_id: selectedVehicleId,
          asset_type: selectedAssetType,
          workshop_category_id: selectedCategoryId,
          workshop_subcategory_id: categoryHasSubcategories ? selectedSubcategoryId : null,
          workshop_comments: workshopComments.trim(),
          meter_reading: readingValue,
          title: taskTitle,
        }),
      });

      const createTaskPayload = await createTaskResponse.json().catch(() => ({})) as CreateWorkshopTaskResponse;

      if (!createTaskResponse.ok) {
        const errorMessage = createTaskPayload.error || 'Failed to create task';
        if (createTaskResponse.status === 401 || createTaskResponse.status === 403) {
          toast.error(errorMessage);
          return;
        }
        throw new Error(errorMessage);
      }

      const newTask = createTaskPayload.task;

      if (newTask && selectedAttachmentTemplateIds.length > 0) {
        const attachmentErrors: string[] = [];

        for (const templateId of selectedAttachmentTemplateIds) {
          const attachmentResponse = await fetch(`/api/workshop-tasks/attachments/task/${newTask.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ template_id: templateId }),
          });

          if (!attachmentResponse.ok) {
            const attachmentError = await attachmentResponse.json().catch(() => ({}));
            console.error('Error creating attachment with V2 snapshot:', attachmentError);
            attachmentErrors.push(templateId);
          }
        }

        if (attachmentErrors.length > 0) {
          toast.error(`Task created but ${attachmentErrors.length} attachment(s) failed to link`);
        }
      }

      if (createTaskPayload.meter_reading_updated === false) {
        toast.error(`Task created but failed to update ${meterReadingType === 'hours' ? 'hours' : (isHgv ? 'KM' : 'mileage')}`);
      } else {
        toast.success('Workshop task created successfully');
      }

      setShowAddModal(false);
      resetAddForm();
      fetchTasks();
    } catch (err) {
      console.error('Error creating task:', err instanceof Error ? err.message : JSON.stringify(err));
      toast.error('Failed to create task');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCategoryChange = (categoryId: string) => {
    setSelectedCategoryId(categoryId);
    setSelectedSubcategoryId('');
  };

  const handleEditTask = async (task: Action) => {
    setEditingTask(task);
    setEditVehicleId(task.van_id ?? task.hgv_id ?? task.plant_id ?? '');

    let resolvedCategoryId = task.workshop_category_id || '';
    if (!resolvedCategoryId && task.workshop_subcategory_id) {
      const allSubs = [...subcategories, ...plantSubcategories, ...hgvSubcategories];
      const matchedSub = allSubs.find(s => s.id === task.workshop_subcategory_id);
      if (matchedSub) resolvedCategoryId = matchedSub.category_id;
    }

    setEditCategoryId(resolvedCategoryId);
    setEditSubcategoryId(task.workshop_subcategory_id || '');
    setEditComments(task.workshop_comments || '');
    setEditMileage('');
    setInitialEditCategoryId(resolvedCategoryId);
    setInitialEditHadSubcategory(!!task.workshop_subcategory_id);

    const assetId = task.van_id ?? task.hgv_id ?? task.plant_id;
    if (assetId) {
      const isPlantTask = !!task.plant_id;
      const isHgvTask = !!task.hgv_id;
      const fieldToSelect = isPlantTask ? 'current_hours' : 'current_mileage';
      const idColumn = isPlantTask ? 'plant_id' : (isHgvTask ? 'hgv_id' : 'van_id');

      try {
        const { data, error } = await supabase
          .from('vehicle_maintenance')
          .select(fieldToSelect)
          .eq(idColumn, assetId)
          .single();

        if (error && error.code !== 'PGRST116') throw error;
        const meterData = data as { current_hours?: number | null; current_mileage?: number | null } | null;
        setEditCurrentMileage(fieldToSelect === 'current_hours' ? (meterData?.current_hours ?? null) : (meterData?.current_mileage ?? null));
      } catch (err) {
        console.error('Error fetching meter reading:', err instanceof Error ? err.message : JSON.stringify(err));
        setEditCurrentMileage(null);
      }
    }

    setShowEditModal(true);
  };

  const handleEditVehicleChange = (value: string) => {
    setEditVehicleId(value);
    if (value && userId) {
      const updatedRecent = recordRecentVehicleId(userId, value);
      setRecentVehicleIds(updatedRecent);
    }
    if (value) {
      const selectedVehicle = vehicles.find(v => v.id === value);
      const isPlant = selectedVehicle?.asset_type === 'plant';
      const isHgv = selectedVehicle?.asset_type === 'hgv';
      const fieldToSelect = isPlant ? 'current_hours' : 'current_mileage';

      supabase
        .from('vehicle_maintenance')
        .select(fieldToSelect)
        .eq(isPlant ? 'plant_id' : (isHgv ? 'hgv_id' : 'van_id'), value)
        .single()
        .then((result: { data: Record<string, number | null> | null; error: { code?: string } | null }) => {
          const { data, error } = result;
          if (error && error.code !== 'PGRST116') {
            console.error('Error fetching meter reading:', error);
          }
          setEditCurrentMileage(data?.[fieldToSelect] ?? null);
        });
    } else {
      setEditCurrentMileage(null);
    }
  };

  const resetEditForm = () => {
    setShowEditModal(false);
    setEditingTask(null);
    setEditVehicleId('');
    setEditCategoryId('');
    setEditSubcategoryId('');
    setEditComments('');
    setEditMileage('');
    setEditCurrentMileage(null);
    setInitialEditCategoryId('');
    setInitialEditHadSubcategory(false);
  };

  const handleSaveEdit = async () => {
    if (!userId) {
      toast.error('You must be logged in to edit tasks');
      return;
    }

    const editSubcategoriesArray = editingTask?.plant_id ? plantSubcategories : editingTask?.hgv_id ? hgvSubcategories : subcategories;
    const editFilteredSubs = editSubcategoriesArray.filter(s => s.category_id === editCategoryId);
    const editCategoryHasSubcategories = editFilteredSubs.length > 0;

    const categoryChanged = editCategoryId !== initialEditCategoryId;
    const editNeedsSubcategory = editCategoryHasSubcategories && (initialEditHadSubcategory || categoryChanged);

    if (!editVehicleId || !editCategoryId || (editNeedsSubcategory && !editSubcategoryId) || !editComments.trim() || !editMileage.trim()) {
      toast.error('Please fill in all fields');
      return;
    }

    if (editComments.trim().length < WORKSHOP_TASK_COMMENT_MIN_LENGTH) {
      toast.error(`Comments must be at least ${WORKSHOP_TASK_COMMENT_MIN_LENGTH} characters`);
      return;
    }

    const mileageValue = parseInt(editMileage);
    const selectedEditVehicle = vehicles.find(v => v.id === editVehicleId);
    const editIsPlant = selectedEditVehicle?.asset_type === 'plant';
    const editIsHgv = selectedEditVehicle?.asset_type === 'hgv';
    const editMeterLabel = editIsPlant ? 'hours' : editIsHgv ? 'KM' : 'mileage';
    const editMeterUnit = editIsPlant ? 'hours' : editIsHgv ? 'km' : 'miles';
    const editMeterTitleLabel = editIsPlant ? 'Hours' : editIsHgv ? 'KM' : 'Mileage';
    if (isNaN(mileageValue) || mileageValue < 0) {
      toast.error(`Please enter a valid ${editMeterLabel}`);
      return;
    }

    if (editCurrentMileage !== null && mileageValue < editCurrentMileage) {
      toast.error(`${editMeterTitleLabel} must be equal to or greater than current reading (${editCurrentMileage.toLocaleString()} ${editMeterUnit})`);
      return;
    }

    if (!editingTask) return;

    try {
      setSubmitting(true);

      const selectedVehicle = vehicles.find(v => v.id === editVehicleId);
      const isPlant = selectedVehicle?.asset_type === 'plant';
      const isHgv = selectedVehicle?.asset_type === 'hgv';
      const assetType =
        selectedVehicle?.asset_type === 'van' || selectedVehicle?.asset_type === 'plant' || selectedVehicle?.asset_type === 'hgv'
          ? selectedVehicle.asset_type
          : null;
      const assetMeterUnit = inferAssetMeterUnit(assetType);

      const updateData: Record<string, unknown> = {
        workshop_comments: editComments,
        title: `Workshop Task - ${getAssetIdLabel(selectedVehicle)}`,
        description: editComments.substring(0, 200),
        asset_meter_reading: mileageValue,
        asset_meter_unit: assetMeterUnit,
      };

      if (editCategoryHasSubcategories && editSubcategoryId) {
        updateData.workshop_subcategory_id = editSubcategoryId;
        updateData.workshop_category_id = null;
      } else {
        updateData.workshop_category_id = editCategoryId;
        updateData.workshop_subcategory_id = null;
      }

      if (isPlant) {
        updateData.plant_id = editVehicleId;
        updateData.van_id = null;
        updateData.hgv_id = null;
      } else if (isHgv) {
        updateData.hgv_id = editVehicleId;
        updateData.van_id = null;
        updateData.plant_id = null;
      } else {
        updateData.van_id = editVehicleId;
        updateData.plant_id = null;
        updateData.hgv_id = null;
      }

      const { error } = await supabase
        .from('actions')
        .update(updateData)
        .eq('id', editingTask.id);

      if (error) throw error;

      const editIdColumn = isPlant ? 'plant_id' : (isHgv ? 'hgv_id' : 'van_id');
      const { data: existingEditMaintenance } = await supabase
        .from('vehicle_maintenance')
        .select('id')
        .eq(editIdColumn, editVehicleId)
        .maybeSingle();

      const meterUpdateFields: Record<string, unknown> = {
        last_updated_at: new Date().toISOString(),
        last_updated_by: userId,
      };

      if (isPlant) {
        meterUpdateFields.plant_id = editVehicleId;
        meterUpdateFields.current_hours = mileageValue;
        meterUpdateFields.last_hours_update = new Date().toISOString();
      } else if (isHgv) {
        meterUpdateFields.hgv_id = editVehicleId;
        meterUpdateFields.current_mileage = mileageValue;
        meterUpdateFields.last_mileage_update = new Date().toISOString();
      } else {
        meterUpdateFields.van_id = editVehicleId;
        meterUpdateFields.current_mileage = mileageValue;
        meterUpdateFields.last_mileage_update = new Date().toISOString();
      }

      const { error: mileageError } = existingEditMaintenance
        ? await supabase
            .from('vehicle_maintenance')
            .update(meterUpdateFields)
            .eq('id', existingEditMaintenance.id)
        : await supabase
            .from('vehicle_maintenance')
            .insert(meterUpdateFields);

      if (mileageError) {
        console.error('Error updating meter reading:', mileageError);
        toast.error('Task updated but failed to update meter reading');
      } else {
        toast.success('Workshop task updated successfully');
      }

      resetEditForm();
      fetchTasks();
    } catch (err) {
      console.error('Error updating task:', err instanceof Error ? err.message : JSON.stringify(err));
      toast.error('Failed to update task');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteTask = (task: Action) => {
    setTaskToDelete(task);
    setShowDeleteConfirm(true);
  };

  const confirmDeleteTask = async () => {
    if (!taskToDelete) return;

    try {
      setDeleting(true);

      const { data: deleted, error } = await supabase
        .from('actions')
        .delete()
        .eq('id', taskToDelete.id)
        .select('id');

      if (error) throw error;
      if (!deleted?.length) {
        toast.error('Task could not be deleted. You may not have permission.');
        return;
      }

      const deletedId = taskToDelete.id;
      setShowDeleteConfirm(false);
      setTaskToDelete(null);
      setTasks(prev => prev.filter(t => t.id !== deletedId));
      toast.success('Task deleted successfully');
      await fetchTasks();
    } catch (err) {
      console.error('Error deleting task:', err instanceof Error ? err.message : JSON.stringify(err));
      toast.error('Failed to delete task');
    } finally {
      setDeleting(false);
    }
  };

  const openAddCategoryModal = () => {
    setEditingCategory(null);
    setCategoryName('');
    setShowCategoryModal(true);
  };

  const openEditCategoryModal = (category: Category) => {
    setEditingCategory(category);
    setCategoryName(category.name);
    setShowCategoryModal(true);
  };

  const handleSaveCategory = async () => {
    if (!categoryName.trim()) {
      toast.error('Category name is required');
      return;
    }

    try {
      setSubmittingCategory(true);

      if (editingCategory) {
        const { error } = await supabase
          .from('workshop_task_categories')
          .update({
            name: categoryName.trim(),
          })
          .eq('id', editingCategory.id);

        if (error) throw error;
        toast.success('Category updated successfully');
      } else {
        const { error } = await supabase
          .from('workshop_task_categories')
          .insert({
            name: categoryName.trim(),
            applies_to: categoryTaxonomyMode,
            is_active: true,
            sort_order: 0,
            created_by: userId,
          });

        if (error) throw error;
        toast.success('Category created successfully');
      }

      setShowCategoryModal(false);
      if (categoryTaxonomyMode === 'plant') {
        fetchPlantCategories();
      } else if (categoryTaxonomyMode === 'hgv') {
        fetchHgvCategories();
      } else {
        fetchCategories();
      }
    } catch (err) {
      console.error('Error saving category:', err instanceof Error ? err.message : JSON.stringify(err));
      toast.error('Failed to save category');
    } finally {
      setSubmittingCategory(false);
    }
  };

  const handleDeleteCategory = async (category: Category) => {
    const { data: tasksUsingCategory } = await supabase
      .from('actions')
      .select('id')
      .eq('workshop_category_id', category.id)
      .limit(1);

    if (tasksUsingCategory && tasksUsingCategory.length > 0) {
      toast.error('Cannot delete category that is in use by tasks');
      return;
    }

    try {
      const { error } = await supabase
        .from('workshop_task_categories')
        .delete()
        .eq('id', category.id);

      if (error) throw error;
      toast.success('Category deleted successfully');
      if (categoryTaxonomyMode === 'plant') {
        fetchPlantCategories();
      } else if (categoryTaxonomyMode === 'hgv') {
        fetchHgvCategories();
      } else {
        fetchCategories();
      }
    } catch (err) {
      console.error('Error deleting category:', err instanceof Error ? err.message : JSON.stringify(err));
      toast.error('Failed to delete category');
    }
  };

  const openAddSubcategoryModal = (category: Category) => {
    setSelectedCategoryForSubcategory(category);
    setEditingSubcategory(null);
    setSubcategoryMode('create');
    setShowSubcategoryModal(true);
  };

  const openEditSubcategoryModal = (subcategory: Subcategory, category: Category) => {
    setSelectedCategoryForSubcategory(category);
    setEditingSubcategory(subcategory);
    setSubcategoryMode('edit');
    setShowSubcategoryModal(true);
  };

  const handleDeleteSubcategory = async (subcategoryId: string, subcategoryName: string) => {
    if (!confirm(`Delete subcategory "${subcategoryName}"? This cannot be undone.`)) {
      return;
    }

    try {
      const response = await fetch(`/api/workshop-tasks/subcategories/${subcategoryId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        const errorMessage = data.error || 'Failed to delete subcategory';

        const isForeignKeyError = errorMessage.toLowerCase().includes('referenced') ||
          errorMessage.toLowerCase().includes('constraint');

        if (isForeignKeyError) {
          showErrorWithDetails({
            message: errorMessage,
            detailsType: 'subcategory-tasks',
            itemId: subcategoryId,
            onShowDetails: async () => {
              setShowErrorDetailsModal(true);
              setErrorDetailsLoading(true);

              try {
                const details = await fetchErrorDetails('subcategory-tasks', { id: subcategoryId });
                setErrorDetails(details as ErrorDetailsResponse<unknown>);
              } catch (err) {
                console.error('Failed to fetch error details:', err);
                const detailsErrorMessage = err instanceof Error ? err.message : 'Failed to load details';
                toast.error(detailsErrorMessage);
                setShowErrorDetailsModal(false);
              } finally {
                setErrorDetailsLoading(false);
              }
            },
          });
        } else {
          toast.error(errorMessage);
        }

        return;
      }

      toast.success('Subcategory deleted successfully');
      await fetchSubcategories();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete subcategory';
      toast.error(errorMessage);
    }
  };

  const isSaveEditDisabled = (() => {
    if (submitting || !editVehicleId || !editCategoryId || editComments.trim().length < WORKSHOP_TASK_COMMENT_MIN_LENGTH || !editMileage.trim()) return true;
    const editSubsArr = editingTask?.plant_id ? plantSubcategories : editingTask?.hgv_id ? hgvSubcategories : subcategories;
    const editHasSubs = editSubsArr.filter(s => s.category_id === editCategoryId).length > 0;
    const catChanged = editCategoryId !== initialEditCategoryId;
    const needsSub = editHasSubs && (initialEditHadSubcategory || catChanged);
    return needsSub && !editSubcategoryId;
  })();

  return {
    resetAddForm,
    handleAddTask,
    handleCategoryChange,
    handleEditTask,
    handleEditVehicleChange,
    resetEditForm,
    handleSaveEdit,
    handleDeleteTask,
    confirmDeleteTask,
    openAddCategoryModal,
    openEditCategoryModal,
    handleSaveCategory,
    handleDeleteCategory,
    openAddSubcategoryModal,
    openEditSubcategoryModal,
    handleDeleteSubcategory,
    isSaveEditDisabled,
  };
}
