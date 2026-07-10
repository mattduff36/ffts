'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel, SelectSeparator } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { FileText } from 'lucide-react';
import { getTaskContent, type AlertType } from '@/lib/utils/serviceTaskCreation';
import { getRecentVehicleIds, recordRecentVehicleId, splitVehiclesByRecent } from '@/lib/utils/recentVehicles';
import { useAttachmentTemplates } from '@/lib/hooks/useAttachmentTemplates';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import { triggerShakeAnimation } from '@/lib/utils/animations';
import { WORKSHOP_TASK_COMMENT_MIN_LENGTH } from '@/lib/workshop-tasks/validation';

type Vehicle = {
  id: string;
  reg_number: string | null;
  plant_id: string | null;
  nickname: string | null;
  serial_number?: string | null;
  asset_type: 'van' | 'plant' | 'hgv' | 'tool';
};

type Category = {
  id: string;
  name: string;
  slug: string | null;
  is_active: boolean;
  sort_order: number;
  applies_to: string | string[];
};

type Subcategory = {
  id: string;
  category_id: string;
  name: string;
  slug: string;
  is_active: boolean;
  sort_order: number;
  workshop_task_categories?: {
    applies_to: string | string[];
  };
};

interface CreateWorkshopTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialVehicleId?: string;
  initialCategoryId?: string;
  alertType?: AlertType;
  onSuccess?: () => void;
}

interface CreateWorkshopTaskResponse {
  error?: string;
  task?: {
    id: string;
  };
  meter_reading_updated?: boolean;
}

function normalizeTemplateAppliesTo(rawValues?: string | string[] | null): string[] {
  const values = Array.isArray(rawValues) ? rawValues : rawValues ? [rawValues] : [];
  const normalizedValues = values
    .map((value) => value.trim().toLowerCase())
    .map((value) => (value === 'vehicle' ? 'van' : value))
    .filter(Boolean);

  if (normalizedValues.length === 0) return ['van', 'hgv', 'plant'];
  return Array.from(new Set(normalizedValues));
}

export function CreateWorkshopTaskDialog({
  open,
  onOpenChange,
  initialVehicleId,
  initialCategoryId,
  alertType,
  onSuccess
}: CreateWorkshopTaskDialogProps) {
  const { user } = useAuth();
  const { tabletModeEnabled } = useTabletMode();
  const supabase = createClient();
  const contentRef = useRef<HTMLDivElement>(null);
  
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [recentVehicleIds, setRecentVehicleIds] = useState<string[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState('');
  const [workshopComments, setWorkshopComments] = useState('');
  const [newMeterReading, setNewMeterReading] = useState('');
  const [currentMeterReading, setCurrentMeterReading] = useState<number | null>(null);
  const [meterReadingType, setMeterReadingType] = useState<'mileage' | 'hours'>('mileage');
  const [submitting, setSubmitting] = useState(false);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  
  // Fetch available attachment templates
  const { templates: attachmentTemplates } = useAttachmentTemplates();

  const fetchCurrentMeterReading = useCallback(async (assetId: string) => {
    try {
      // First, determine asset type by checking vans, hgvs, and plant tables
      // This is necessary because this function may be called before the vehicles state is populated
      let isPlant = false;
      
      // Check if it's a van
      const { data: vehicleData } = await supabase
        .from('vans')
        .select('id')
        .eq('id', assetId)
        .maybeSingle();
      
      // If not found in vans, check hgvs then plant table
      if (!vehicleData) {
        const { data: hgvData } = await supabase
          .from('hgvs')
          .select('id')
          .eq('id', assetId)
          .maybeSingle();

        if (hgvData) {
          isPlant = false;
          setMeterReadingType('mileage');
          const { data, error } = await supabase
            .from('vehicle_maintenance')
            .select('current_mileage')
            .eq('hgv_id', assetId)
            .single();

          if (error) {
            if (error.code === 'PGRST116') {
              setCurrentMeterReading(null);
              return;
            }
            throw error;
          }

          setCurrentMeterReading(data?.current_mileage || null);
          return;
        }

        const { data: plantData } = await supabase
          .from('plant')
          .select('id')
          .eq('id', assetId)
          .maybeSingle();
        
        if (plantData) {
          isPlant = true;
        } else {
          // Asset not found in either table
          setCurrentMeterReading(null);
          return;
        }
      }

      setMeterReadingType(isPlant ? 'hours' : 'mileage');

      // Query vehicle_maintenance table with appropriate filter
      const { data, error } = await supabase
        .from('vehicle_maintenance')
        .select(isPlant ? 'current_hours' : 'current_mileage')
        .eq(isPlant ? 'plant_id' : 'van_id', assetId)
        .single();

      if (error) {
        // If no maintenance record exists, set to null
        if (error.code === 'PGRST116') {
          setCurrentMeterReading(null);
          return;
        }
        throw error;
      }

      const readingData = (data || {}) as { current_hours?: number | null; current_mileage?: number | null };
      setCurrentMeterReading(isPlant ? (readingData.current_hours || null) : (readingData.current_mileage || null));
    } catch (err) {
      console.error('Error fetching current meter reading:', err);
      setCurrentMeterReading(null);
    }
  }, [supabase]);

  // Load initial data and set prefilled values
  useEffect(() => {
    if (open) {
      async function fetchVehicles() {
        try {
          // Fetch vans
          const { data: vehicleData, error: vehicleError } = await supabase
            .from('vans')
            .select('id, reg_number, nickname')
            .eq('status', 'active')
            .order('reg_number');

          if (vehicleError) throw vehicleError;

          // Fetch hgvs
          const { data: hgvData, error: hgvError } = await supabase
            .from('hgvs')
            .select('id, reg_number, nickname')
            .eq('status', 'active')
            .order('reg_number');

          if (hgvError) throw hgvError;

          // Fetch plant
          const { data: plantData, error: plantError } = await supabase
            .from('plant')
            .select('id, plant_id, nickname, serial_number')
            .eq('status', 'active')
            .order('plant_id');

          if (plantError) throw plantError;

          // Combine both into a unified list with asset type indicators
          const combinedVehicles = [
            ...(vehicleData || []).map((v: { id: string; reg_number: string | null; nickname: string | null }) => ({
              id: v.id,
              reg_number: v.reg_number,
              plant_id: null,
              nickname: v.nickname,
              asset_type: 'van' as const
            })),
            ...(hgvData || []).map((v: { id: string; reg_number: string | null; nickname: string | null }) => ({
              id: v.id,
              reg_number: v.reg_number,
              plant_id: null,
              nickname: v.nickname,
              asset_type: 'hgv' as const
            })),
            ...(plantData || []).map((p: { id: string; plant_id: string | null; nickname: string | null }) => ({
              id: p.id,
              reg_number: null,
              plant_id: p.plant_id,
              nickname: p.nickname,
              asset_type: 'plant' as const
            }))
          ];

          setVehicles(combinedVehicles as Vehicle[]);
        } catch (err) {
          console.error('Error fetching vans:', err);
        }
      }

      async function fetchCategories() {
        try {
          // Fetch both vehicle and plant categories
          const { data, error } = await supabase
            .from('workshop_task_categories')
            .select('id, name, slug, is_active, sort_order, applies_to')
            .eq('is_active', true)
            .order('name');

          if (error) throw error;
          
          setCategories((data || []) as Category[]);
        } catch (err) {
          console.error('Error fetching categories:', err);
        }
      }

      async function fetchSubcategories() {
        try {
          // Fetch all subcategories with their parent category's applies_to
          const { data, error } = await supabase
            .from('workshop_task_subcategories')
            .select(`
              id,
              category_id,
              name,
              slug,
              is_active,
              sort_order,
              workshop_task_categories!inner(applies_to)
            `)
            .eq('is_active', true)
            .order('name');

          if (error) throw error;
          setSubcategories((data || []) as Subcategory[]);
        } catch (err) {
          console.error('Error fetching subcategories:', err);
        }
      }

      fetchVehicles();
      fetchCategories();
      fetchSubcategories();
      
      // Load recent vehicle IDs
      if (user?.id) {
        setRecentVehicleIds(getRecentVehicleIds(user.id));
      }
      
      // Set initial values if provided
      if (initialVehicleId) {
        setSelectedVehicleId(initialVehicleId);
        fetchCurrentMeterReading(initialVehicleId);
      }
      if (initialCategoryId) {
        setSelectedCategoryId(initialCategoryId);
      }
    }
  }, [open, initialVehicleId, initialCategoryId, user?.id, fetchCurrentMeterReading, supabase]);

  // Get selected vehicle's asset type
  const selectedVehicle = vehicles.find(v => v.id === selectedVehicleId);
  const selectedAssetType = selectedVehicle?.asset_type || 'van';
  const filteredAttachmentTemplates = useMemo(() => (
    attachmentTemplates.filter((template) =>
      normalizeTemplateAppliesTo(template.applies_to).includes(selectedAssetType),
    )
  ), [attachmentTemplates, selectedAssetType]);
  const isSelectedHgv = selectedAssetType === 'hgv';
  const meterFieldLabel = meterReadingType === 'hours' ? 'Current Hours' : isSelectedHgv ? 'Current KM' : 'Current Mileage';
  const meterInputDescriptor = meterReadingType === 'hours' ? 'hours' : isSelectedHgv ? 'KM' : 'mileage';
  const meterUnit = meterReadingType === 'hours' ? 'hours' : isSelectedHgv ? 'km' : 'miles';

  // Filter categories by selected vehicle's asset type
  const filteredCategories = categories.filter((cat) =>
    normalizeTemplateAppliesTo(cat.applies_to).includes(selectedAssetType),
  );

  // Filter subcategories by selected category and asset type
  const filteredSubcategories = selectedCategoryId
    ? subcategories.filter(sub => {
        if (sub.category_id !== selectedCategoryId) return false;
        if (sub.workshop_task_categories) {
          return normalizeTemplateAppliesTo(sub.workshop_task_categories.applies_to).includes(selectedAssetType);
        }
        return true;
      })
    : [];

  // Dynamically determine if the selected category has active subcategories
  const categoryHasSubcategories = filteredSubcategories.length > 0;

  const handleCategoryChange = (categoryId: string) => {
    setSelectedCategoryId(categoryId);
    setSelectedSubcategoryId('');
  };

  const handleAddTask = async () => {
    if (!user?.id) {
      toast.error('You must be logged in to create tasks');
      onOpenChange(false);
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
    const selectedCategoryIsValid = filteredCategories.some(category => category.id === selectedCategoryId);
    const selectedSubcategoryIsValid = !categoryHasSubcategories || filteredSubcategories.some(subcategory => subcategory.id === selectedSubcategoryId);
    if (!selectedCategoryIsValid || !selectedSubcategoryIsValid) {
      toast.error('Please select a valid workshop category for this asset');
      return;
    }

    const isHgvSelection = selectedVehicleForValidation?.asset_type === 'hgv';
    const readingDescriptor = meterReadingType === 'hours' ? 'hours' : isHgvSelection ? 'KM' : 'mileage';
    const readingLabel = meterReadingType === 'hours' ? 'Hours' : isHgvSelection ? 'KM' : 'Mileage';
    const readingUnit = meterReadingType === 'hours' ? 'hours' : isHgvSelection ? 'km' : 'miles';
    if (isNaN(readingValue) || readingValue < 0) {
      toast.error(`Please enter a valid ${readingDescriptor}`);
      return;
    }

    // Validate reading is >= current reading
    if (currentMeterReading !== null && readingValue < currentMeterReading) {
      toast.error(`${readingLabel} must be equal to or greater than current reading (${currentMeterReading.toLocaleString()} ${readingUnit})`);
      return;
    }

    try {
      setSubmitting(true);

      // Generate title based on alert type if provided, otherwise use generic title
      const selectedVehicle = vehicles.find(v => v.id === selectedVehicleId);
      if (!selectedVehicle || !['van', 'plant', 'hgv'].includes(selectedVehicle.asset_type)) {
        toast.error('Please select a valid asset');
        return;
      }

      const isPlant = selectedVehicle.asset_type === 'plant';
      const isHgv = selectedVehicle.asset_type === 'hgv';
      const assetIdLabel = isPlant
        ? (selectedVehicle?.plant_id ?? 'Unknown Plant')
        : (selectedVehicle?.reg_number ?? 'Unknown Asset');
      const taskTitle = alertType 
        ? getTaskContent(alertType, assetIdLabel, '').title
        : `Workshop Task - ${assetIdLabel}`;

      const createTaskResponse = await fetch('/api/workshop-tasks/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicle_id: selectedVehicleId,
          asset_type: selectedVehicle.asset_type,
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

      // Create attachments for selected templates
      if (newTask && selectedTemplateIds.length > 0) {
        const attachmentErrors: string[] = [];
        
        for (const templateId of selectedTemplateIds) {
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

      resetForm();
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      console.error('Error creating task:', err);
      toast.error('Failed to create task');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setSelectedVehicleId('');
    setSelectedCategoryId('');
    setSelectedSubcategoryId('');
    setWorkshopComments('');
    setNewMeterReading('');
    setCurrentMeterReading(null);
    setSelectedTemplateIds([]);
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
  };
  
  // Wrapper to ensure form is reset on ANY close action
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetForm();
    }
    onOpenChange(newOpen);
  };
  const isDirty = useMemo(
    () =>
      selectedVehicleId.length > 0 ||
      selectedCategoryId.length > 0 ||
      selectedSubcategoryId.length > 0 ||
      workshopComments.trim().length > 0 ||
      newMeterReading.trim().length > 0 ||
      selectedTemplateIds.length > 0,
    [selectedVehicleId, selectedCategoryId, selectedSubcategoryId, workshopComments, newMeterReading, selectedTemplateIds]
  );

  useEffect(() => {
    if (selectedTemplateIds.length === 0) return;
    const visibleTemplateIds = new Set(filteredAttachmentTemplates.map((template) => template.id));
    const nextSelectedTemplateIds = selectedTemplateIds.filter((id) => visibleTemplateIds.has(id));
    if (nextSelectedTemplateIds.length !== selectedTemplateIds.length) {
      setSelectedTemplateIds(nextSelectedTemplateIds);
    }
  }, [filteredAttachmentTemplates, selectedTemplateIds]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !submitting && isDirty) {
          triggerShakeAnimation(contentRef.current);
          return;
        }
        handleOpenChange(nextOpen);
      }}
    >
      <DialogContent
        ref={contentRef}
        className={`max-w-lg ${tabletModeEnabled ? 'max-w-xl p-5 sm:p-6' : ''}`}
        onInteractOutside={(event) => {
          if (!submitting && isDirty) {
            event.preventDefault();
            triggerShakeAnimation(contentRef.current);
          }
        }}
        onEscapeKeyDown={(event) => {
          if (!submitting && isDirty) {
            event.preventDefault();
            triggerShakeAnimation(contentRef.current);
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-xl">Create Workshop Task</DialogTitle>
          <DialogDescription>
            Add a new van, HGV, or plant repair/maintenance task
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="vehicle">
              Asset <span className="text-red-500">*</span>
            </Label>
            <Select value={selectedVehicleId} onValueChange={(value) => {
              setSelectedVehicleId(value);
              // Record as recent vehicle selection
              if (value && user?.id) {
                const updatedRecent = recordRecentVehicleId(user.id, value);
                setRecentVehicleIds(updatedRecent);
              }
              if (value) {
                fetchCurrentMeterReading(value);
                // Reset category and subcategory when vehicle changes
                // (different asset types have different categories)
                setSelectedCategoryId('');
                setSelectedSubcategoryId('');
              } else {
                setCurrentMeterReading(null);
              }
            }}>
              <SelectTrigger id="vehicle" className={tabletModeEnabled ? 'min-h-11 text-base' : undefined}>
                <SelectValue placeholder="Select van, HGV, or plant" />
              </SelectTrigger>
              <SelectContent>
                {(() => {
                  const vehiclesForRecent = vehicles.map((vehicle) => ({
                    ...vehicle,
                    reg_number: vehicle.reg_number ?? vehicle.plant_id ?? '',
                  }));
                  const { recentVehicles, otherVehicles } = splitVehiclesByRecent(vehiclesForRecent, recentVehicleIds);
                  return (
                    <>
                      {recentVehicles.length > 0 && (
                        <SelectGroup>
                          <SelectLabel>Recent</SelectLabel>
                          {recentVehicles.map((vehicle) => (
                            <SelectItem key={vehicle.id} value={vehicle.id}>
                              {vehicle.reg_number || vehicle.plant_id}{vehicle.nickname ? ` (${vehicle.nickname})` : ''}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                      {recentVehicles.length > 0 && otherVehicles.length > 0 && (
                        <SelectSeparator />
                      )}
                      {otherVehicles.length > 0 && (
                        <SelectGroup>
                          {recentVehicles.length > 0 && (
                            <SelectLabel>All Vehicles</SelectLabel>
                          )}
                          {otherVehicles.map((vehicle) => (
                            <SelectItem key={vehicle.id} value={vehicle.id}>
                              {vehicle.reg_number || vehicle.plant_id}{vehicle.nickname ? ` (${vehicle.nickname})` : ''}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                    </>
                  );
                })()}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">
              Category <span className="text-red-500">*</span>
            </Label>
            <Select value={selectedCategoryId} onValueChange={handleCategoryChange}>
              <SelectTrigger id="category" className={tabletModeEnabled ? 'min-h-11 text-base' : undefined}>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {filteredCategories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {categoryHasSubcategories && (
            <div className="space-y-2">
              <Label htmlFor="subcategory">
                Subcategory <span className="text-red-500">*</span>
              </Label>
              <Select 
                value={selectedSubcategoryId} 
                onValueChange={setSelectedSubcategoryId}
                disabled={!selectedCategoryId}
              >
                <SelectTrigger id="subcategory" className={tabletModeEnabled ? 'min-h-11 text-base' : undefined}>
                  <SelectValue placeholder={selectedCategoryId ? "Select subcategory" : "Select a category first"} />
                </SelectTrigger>
                <SelectContent>
                  {filteredSubcategories.map((subcategory) => (
                    <SelectItem key={subcategory.id} value={subcategory.id}>
                      {subcategory.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="mileage">
              {meterFieldLabel} <span className="text-red-500">*</span>
            </Label>
            <Input
              id="mileage"
              type="number"
              value={newMeterReading}
              onChange={(e) => setNewMeterReading(e.target.value)}
              placeholder={`Enter current ${meterInputDescriptor}`}
              min="0"
              step="1"
              className={tabletModeEnabled ? 'min-h-11 text-base' : undefined}
            />
            {currentMeterReading !== null && (
              <p className="text-xs text-muted-foreground">
                Last recorded: {currentMeterReading.toLocaleString()} {meterUnit}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="comments">
              Task Details <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="comments"
              value={workshopComments}
              onChange={(e) => setWorkshopComments(e.target.value)}
              placeholder={`Describe the work needed (minimum ${WORKSHOP_TASK_COMMENT_MIN_LENGTH} characters)`}
              className={`min-h-[100px] ${tabletModeEnabled ? 'text-base' : ''}`}
              maxLength={300}
            />
            <p className="text-xs text-muted-foreground">
              {workshopComments.length}/300 characters (minimum {WORKSHOP_TASK_COMMENT_MIN_LENGTH})
            </p>
          </div>

          {/* Attachment Templates Selection */}
          {attachmentTemplates.length > 0 && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Attachments (Optional)
              </Label>
              <p className="text-xs text-muted-foreground mb-2">
                Add service checklists or documentation to complete later
              </p>
              <div className="space-y-2 max-h-32 overflow-y-auto p-2 border rounded-md bg-muted/30">
                {filteredAttachmentTemplates.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No templates are available for this {selectedAssetType.toUpperCase()} asset.
                  </p>
                )}
                {filteredAttachmentTemplates.map((template) => (
                  <div key={template.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`template-${template.id}`}
                      checked={selectedTemplateIds.includes(template.id)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedTemplateIds(prev => [...prev, template.id]);
                        } else {
                          setSelectedTemplateIds(prev => prev.filter(id => id !== template.id));
                        }
                      }}
                    />
                    <Label
                      htmlFor={`template-${template.id}`}
                      className="text-sm font-normal cursor-pointer"
                    >
                      {template.name}
                    </Label>
                  </div>
                ))}
              </div>
              {selectedTemplateIds.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {selectedTemplateIds.length} attachment{selectedTemplateIds.length > 1 ? 's' : ''} will be added to this task
                </p>
              )}
            </div>
          )}
        </div>

          <DialogFooter className={tabletModeEnabled ? 'gap-3 pt-2' : undefined}>
          <Button
            variant="outline"
            onClick={handleClose}
              className={tabletModeEnabled ? 'min-h-11 text-base px-4' : undefined}
          >
              {isDirty ? 'Discard Changes' : 'Cancel'}
          </Button>
          <Button
            onClick={handleAddTask}
            disabled={submitting || !selectedVehicleId || !selectedCategoryId || (categoryHasSubcategories && !selectedSubcategoryId) || workshopComments.trim().length < WORKSHOP_TASK_COMMENT_MIN_LENGTH || !newMeterReading.trim()}
              className={`bg-workshop hover:bg-workshop-dark text-white ${tabletModeEnabled ? 'min-h-11 text-base px-4' : ''}`}
          >
            {submitting ? 'Creating...' : 'Create Task'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
