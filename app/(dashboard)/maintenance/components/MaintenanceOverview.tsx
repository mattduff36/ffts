'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { PanelLoader } from '@/components/ui/panel-loader';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, Calendar, Wrench, ChevronDown, ChevronUp, Loader2, Clock, CheckCircle2, MessageSquare, Pause, Play, Undo2, Briefcase, Info, RefreshCw, Bell } from 'lucide-react';
import type { VehicleMaintenanceWithStatus, MaintenanceCategory, CategoryResponsibility, MaintenancePeriodUnit } from '@/types/maintenance';
import { formatDaysUntil, formatMilesUntil, formatHoursUntil, formatMileage, formatHours, formatMaintenanceDate } from '@/lib/utils/maintenanceCalculations';
import type { CompletionUpdatesArray } from '@/types/workshop-completion';
import { formatDateTime } from '@/lib/utils/date';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { CreateWorkshopTaskDialog } from '@/components/workshop-tasks/CreateWorkshopTaskDialog';
import { TaskCommentsDrawer } from '@/components/workshop-tasks/TaskCommentsDrawer';
import { MarkTaskCompleteDialog, type CompletionData } from '@/components/workshop-tasks/MarkTaskCompleteDialog';
import { OfficeActionDialog } from './OfficeActionDialog';
import { QuickEditPopover } from './QuickEditPopover';
import { getTaskContent, type AlertType } from '@/lib/utils/serviceTaskCreation';
import {
  appendStatusHistory,
  buildStatusHistoryEvent,
  updateLatestInProgressStatusHistoryTimestamp,
} from '@/lib/utils/workshopTaskStatusHistory';
import { inferMaintenanceLink } from '@/lib/utils/workshopMaintenanceSync';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import {
  MAINTENANCE_CATEGORY_NAMES,
  createMaintenanceCategoryMap,
  getDistanceUnitLabel,
  getMaintenanceCategory,
  isMaintenanceCategoryVisibleOnOverview,
} from '@/lib/utils/maintenanceCategoryRules';

// Map alert type to category name for lookup
const ALERT_TO_CATEGORY_NAME: Record<string, string> = {
  'Tax': MAINTENANCE_CATEGORY_NAMES.tax,
  'MOT': MAINTENANCE_CATEGORY_NAMES.mot,
  'Service': MAINTENANCE_CATEGORY_NAMES.service,
  'Cambelt': MAINTENANCE_CATEGORY_NAMES.cambelt,
  'First Aid Kit': MAINTENANCE_CATEGORY_NAMES.firstAid,
  'LOLER': MAINTENANCE_CATEGORY_NAMES.loler,
  '6 Weekly Inspection': MAINTENANCE_CATEGORY_NAMES.sixWeekly,
  'Fire Extinguisher': MAINTENANCE_CATEGORY_NAMES.fireExtinguisher,
  'Taco Calibration': MAINTENANCE_CATEGORY_NAMES.tacoCalibration,
  'Service (Hours)': MAINTENANCE_CATEGORY_NAMES.serviceHours,
};

const HISTORY_PREFETCH_CONCURRENCY = 4;

interface MaintenanceOverviewProps {
  vehicles: VehicleMaintenanceWithStatus[];
  summary: {
    total: number;
    overdue: number;
    due_soon: number;
  };
  onVehicleClick?: (vehicle: VehicleMaintenanceWithStatus) => void;
}

interface Alert {
  type: string;
  detail: string;
  severity: 'overdue' | 'due_soon';
  sortValue: number; // Normalized to days equivalent - lower = more urgent
}

// Estimated average daily mileage for normalizing mileage-based alerts to days
// This allows comparing date-based (Tax, MOT) with mileage-based (Service, Cambelt) alerts
const ESTIMATED_DAILY_MILES = 35;
const MAINTENANCE_PERIOD_UNITS: readonly MaintenancePeriodUnit[] = ['weeks', 'months', 'miles', 'hours'];

function isMaintenancePeriodUnit(value: string): value is MaintenancePeriodUnit {
  return MAINTENANCE_PERIOD_UNITS.includes(value as MaintenancePeriodUnit);
}

function getDefaultPeriodUnit(type: MaintenanceCategory['type']): MaintenancePeriodUnit {
  if (type === 'mileage') return 'miles';
  if (type === 'hours') return 'hours';
  return 'months';
}

function isExpectedNetworkError(error: unknown): boolean {
  if (!navigator.onLine) return true;
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  const exactNetworkMessages = ['failed to fetch', 'load failed', 'network request failed'];
  if (exactNetworkMessages.includes(message)) return true;
  return message.includes('networkerror');
}

interface VehicleWithAlerts extends VehicleMaintenanceWithStatus {
  alerts: Alert[];
}

interface AlertEntry {
  vehicle: VehicleWithAlerts;
  alert: Alert;
  entryKey: string;
  vehicleId: string;
  isPlant: boolean;
}

interface AlertSummaryItem {
  label: string;
  value: string;
  isHighlighted?: boolean;
}

interface HistoryEntry {
  id: string;
  created_at: string;
  field_name: string;
  old_value: string;
  new_value: string;
  updated_by_name?: string;
}

interface StatusHistoryEvent {
  status: string;
  timestamp: string;
  userId: string;
  userName: string;
  comment?: string;
}

function formatDistanceReading(
  value: number | null | undefined,
  unit: 'miles' | 'km'
): string {
  const formattedValue = formatMileage(value);
  if (formattedValue === 'Not Set') return formattedValue;
  return `${formattedValue} ${unit}`;
}

interface WorkshopTask {
  id: string;
  created_at: string;
  logged_at?: string | null;
  status: string;
  title?: string;
  description: string;
  workshop_comments?: string | null;
  van_id?: string;
  hgv_id?: string;
  plant_id?: string;
  status_history?: StatusHistoryEvent[] | null;
  workshop_task_categories?: {
    id: string;
    name: string;
    completion_updates?: CompletionUpdatesArray | null;
  } | null;
  workshop_task_subcategories?: {
    id?: string;
    name: string;
  } | null;
  profiles?: { full_name: string | null } | null;
}

export function MaintenanceOverview({ vehicles, summary, onVehicleClick }: MaintenanceOverviewProps) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const [expandedVehicles, setExpandedVehicles] = useState<Set<string>>(new Set());
  const [vehicleHistory, setVehicleHistory] = useState<Record<string, { history: HistoryEntry[], workshopTasks: WorkshopTask[], loading: boolean }>>({});
  
  // Track which vehicles we've started fetching (prevents duplicate requests)
  const fetchingVehicles = useRef<Set<string>>(new Set());
  const fetchedVehicleHistory = useRef<Set<string>>(new Set());
  
  // Create Workshop Task Dialog state
  const [showCreateTaskDialog, setShowCreateTaskDialog] = useState(false);
  const [createTaskVehicleId, setCreateTaskVehicleId] = useState<string | undefined>();
  const [createTaskCategoryId, setCreateTaskCategoryId] = useState<string | undefined>();
  const [createTaskAlertType, setCreateTaskAlertType] = useState<AlertType | undefined>();
  const [maintenanceCategoryId, setMaintenanceCategoryId] = useState<string | undefined>();
  
  // Task Action Modals state
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState<WorkshopTask | null>(null);
  const [loggedComment, setLoggedComment] = useState('');
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [completingTask, setCompletingTask] = useState<WorkshopTask | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState<Set<string>>(new Set());
  const [showOnHoldModal, setShowOnHoldModal] = useState(false);
  const [onHoldingTask, setOnHoldingTask] = useState<WorkshopTask | null>(null);
  const [onHoldComment, setOnHoldComment] = useState('');
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [resumingTask, setResumingTask] = useState<WorkshopTask | null>(null);
  const [resumeComment, setResumeComment] = useState('');
  const [showCommentsDrawer, setShowCommentsDrawer] = useState(false);
  const [commentsTask, setCommentsTask] = useState<WorkshopTask | null>(null);
  
  // Maintenance categories (for checking responsibility)
  const [maintenanceCategories, setMaintenanceCategories] = useState<MaintenanceCategory[]>([]);
  const maintenanceCategoryMap = useMemo(
    () => createMaintenanceCategoryMap(maintenanceCategories),
    [maintenanceCategories]
  );
  
  // Office Action Dialog state
  const [showOfficeActionDialog, setShowOfficeActionDialog] = useState(false);
  const [officeActionVehicle, setOfficeActionVehicle] = useState<{
    vehicleId: string;
    assetType: 'van' | 'hgv' | 'plant';
    vehicleReg: string;
    vehicleNickname?: string | null;
    alertType: string;
    dueInfo: string;
    currentDueDate?: string | null;
  } | null>(null);
  
  // Helper to get category responsibility
  const getCategoryForAlert = (alertType: string): MaintenanceCategory | undefined => {
    const categoryName = ALERT_TO_CATEGORY_NAME[alertType] || alertType;
    const category = getMaintenanceCategory(maintenanceCategoryMap, categoryName);
    return category?.id ? category as MaintenanceCategory : undefined;
  };

  const getCategoryResponsibility = (alertType: string): CategoryResponsibility => {
    const category = getCategoryForAlert(alertType);
    return category?.responsibility || 'workshop';
  };
  
  // Fetch maintenance categories on mount
  useEffect(() => {
    const fetchMaintenanceCategories = async () => {
      const supabase = createClient();
      try {
        const { data: categories } = await supabase
          .from('maintenance_categories')
          .select('*');
        
        if (categories) {
          setMaintenanceCategories(categories.map((category) => ({
            ...category,
            period_unit: isMaintenancePeriodUnit(category.period_unit)
              ? category.period_unit
              : getDefaultPeriodUnit(category.type),
            is_active: category.is_active ?? true,
            sort_order: category.sort_order ?? 0,
            created_at: category.created_at ?? '',
            updated_at: category.updated_at ?? '',
            responsibility: category.responsibility ?? 'workshop',
            show_on_overview: category.show_on_overview ?? true,
            reminder_in_app_enabled: category.reminder_in_app_enabled ?? false,
            reminder_email_enabled: category.reminder_email_enabled ?? false,
            applies_to: category.applies_to ?? [],
          })));
        }
      } catch (error) {
        console.error('Error fetching maintenance categories:', error);
      }
    };
    
    fetchMaintenanceCategories();
  }, []);
  
  // Fetch Service category on mount (for pre-filling create task dialog)
  useEffect(() => {
    const fetchServiceCategory = async () => {
      const supabase = createClient();
      try {
        const { data: categories } = await supabase
          .from('workshop_task_categories')
          .select('id, name')
          .ilike('name', '%service%')
          .eq('is_active', true)
          .limit(1);
        
        if (categories && categories.length > 0) {
          setMaintenanceCategoryId(categories[0].id);
        }
      } catch (error) {
        console.error('Error fetching service category:', error);
      }
    };
    
    fetchServiceCategory();
  }, []);
  
  const fetchVehicleHistory = useCallback(async (vehicleId: string, isPlant: boolean = false, force: boolean = false) => {
    // Check if already fetching or already have data (unless forced)
    if (!force && (fetchingVehicles.current.has(vehicleId) || fetchedVehicleHistory.current.has(vehicleId))) {
      return; // Already fetching or already fetched
    }
    
    // Mark as fetching
    fetchingVehicles.current.add(vehicleId);
    fetchedVehicleHistory.current.add(vehicleId);
    
    setVehicleHistory(prev => ({ ...prev, [vehicleId]: { history: [], workshopTasks: [], loading: true } }));
    
    try {
      if (!navigator.onLine) {
        setVehicleHistory(prev => ({
          ...prev,
          [vehicleId]: { history: [], workshopTasks: [], loading: false }
        }));
        return;
      }

      // Use plant endpoint if this is a plant asset, otherwise use vehicle endpoint
      const endpoint = isPlant 
        ? `/api/maintenance/history/plant/${vehicleId}`
        : `/api/maintenance/history/${vehicleId}`;
      
      const response = await fetch(endpoint);
      if (!response.ok) {
        if (response.status === 404) {
          setVehicleHistory(prev => ({
            ...prev,
            [vehicleId]: { history: [], workshopTasks: [], loading: false }
          }));
          return;
        }
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Request failed with status ${response.status}`);
      }
      
      const data = await response.json();
      
      setVehicleHistory(prev => ({
        ...prev,
        [vehicleId]: {
          history: data.history || [],
          workshopTasks: data.workshopTasks || [],
          loading: false
        }
      }));
    } catch (error) {
      if (!isExpectedNetworkError(error)) {
        console.error('Error fetching vehicle history:', error);
      }
      setVehicleHistory(prev => ({
        ...prev,
        [vehicleId]: { history: [], workshopTasks: [], loading: false }
      }));
    } finally {
      // Always remove from fetching set after completion
      fetchingVehicles.current.delete(vehicleId);
    }
  }, []);
  
  // Helper to determine if a vehicle ID corresponds to a plant asset
  const isPlantAsset = useCallback((vehicleId: string) => {
    const vehicle = vehicles.find(v => v.plant_id === vehicleId || v.van_id === vehicleId || v.hgv_id === vehicleId || v.id === vehicleId);
    return vehicle && 'is_plant' in vehicle && vehicle.is_plant === true;
  }, [vehicles]);
  
  // Auto-fetch history for vehicles with alerts on mount
  useEffect(() => {
    const vehiclesWithAlerts = vehicles.filter(v => {
      // For efficiency, first check alert counts (works for both vehicles and plant)
      if (v.overdue_count > 0 || v.due_soon_count > 0) {
        return true;
      }
      
      // Fallback: Check individual status fields (for compatibility)
      return v.tax_status?.status === 'overdue' || v.tax_status?.status === 'due_soon' ||
        v.mot_status?.status === 'overdue' || v.mot_status?.status === 'due_soon' ||
        v.service_status?.status === 'overdue' || v.service_status?.status === 'due_soon' ||
        v.cambelt_status?.status === 'overdue' || v.cambelt_status?.status === 'due_soon' ||
        v.first_aid_status?.status === 'overdue' || v.first_aid_status?.status === 'due_soon' ||
        v.loler_status?.status === 'overdue' || v.loler_status?.status === 'due_soon';
    });
    
    const historyRequests = vehiclesWithAlerts
      .map(vehicle => {
        const isPlant = 'is_plant' in vehicle && vehicle.is_plant === true;
        const vehicleId = isPlant
          ? (vehicle.plant_id ?? vehicle.id)
          : (vehicle.van_id ?? vehicle.hgv_id ?? vehicle.id);

        return vehicleId ? { vehicleId, isPlant } : null;
      })
      .filter((request): request is { vehicleId: string; isPlant: boolean } => request !== null);

    let isCancelled = false;

    const prefetchHistory = async () => {
      for (let index = 0; index < historyRequests.length && !isCancelled; index += HISTORY_PREFETCH_CONCURRENCY) {
        const batch = historyRequests.slice(index, index + HISTORY_PREFETCH_CONCURRENCY);
        await Promise.all(batch.map(({ vehicleId, isPlant }) => fetchVehicleHistory(vehicleId, isPlant)));
      }
    };

    void prefetchHistory();

    return () => {
      isCancelled = true;
    };
  }, [vehicles, fetchVehicleHistory]); // Note: isPlantAsset not needed here since we check inline
  
  // Group vehicles by their most severe alert status
  const vehiclesWithAlerts: VehicleWithAlerts[] = vehicles.map(vehicle => {
    const alerts: Alert[] = [];
    const isPlant = 'is_plant' in vehicle && vehicle.is_plant === true;
    const rawAssetType = (vehicle.vehicle?.asset_type || (isPlant ? 'plant' : 'vehicle')).toLowerCase();
    const distanceUnit = getDistanceUnitLabel(rawAssetType);
    
    // Helper to check if this category should be shown for this asset.
    const categoryVisible = (categoryName: string): boolean => {
      const category = getMaintenanceCategory(maintenanceCategoryMap, categoryName);
      return isMaintenanceCategoryVisibleOnOverview(category, rawAssetType, categoryName);
    };
    
    // Check Tax (only if category applies to this asset type)
    if (categoryVisible(MAINTENANCE_CATEGORY_NAMES.tax)) {
      if (vehicle.tax_status?.status === 'overdue') {
        alerts.push({
          type: 'Tax',
          detail: formatDaysUntil(vehicle.tax_status.days_until),
          severity: 'overdue',
          sortValue: vehicle.tax_status.days_until ?? 0
        });
      } else if (vehicle.tax_status?.status === 'due_soon') {
        alerts.push({
          type: 'Tax',
          detail: formatDaysUntil(vehicle.tax_status.days_until),
          severity: 'due_soon',
          sortValue: vehicle.tax_status.days_until ?? 0
        });
      }
    }
    
    // Check MOT (only if category applies to this asset type)
    if (categoryVisible(MAINTENANCE_CATEGORY_NAMES.mot)) {
      if (vehicle.mot_status?.status === 'overdue') {
        alerts.push({
          type: 'MOT',
          detail: formatDaysUntil(vehicle.mot_status.days_until),
          severity: 'overdue',
          sortValue: vehicle.mot_status.days_until ?? 0
        });
      } else if (vehicle.mot_status?.status === 'due_soon') {
        alerts.push({
          type: 'MOT',
          detail: formatDaysUntil(vehicle.mot_status.days_until),
          severity: 'due_soon',
          sortValue: vehicle.mot_status.days_until ?? 0
        });
      }
    }
    
    // Check Service (normalize miles to days equivalent for sorting - only if category applies)
    if (categoryVisible(MAINTENANCE_CATEGORY_NAMES.service)) {
      if (vehicle.service_status?.status === 'overdue') {
        const milesUntil = vehicle.service_status.miles_until ?? 0;
        alerts.push({
          type: 'Service',
          detail: formatMilesUntil(milesUntil, distanceUnit),
          severity: 'overdue',
          sortValue: Math.round(milesUntil / ESTIMATED_DAILY_MILES) // Convert miles to days equivalent
        });
      } else if (vehicle.service_status?.status === 'due_soon') {
        const milesUntil = vehicle.service_status.miles_until ?? 0;
        alerts.push({
          type: 'Service',
          detail: formatMilesUntil(milesUntil, distanceUnit),
          severity: 'due_soon',
          sortValue: Math.round(milesUntil / ESTIMATED_DAILY_MILES) // Convert miles to days equivalent
        });
      }
    }
    
    // Check Cambelt (normalize miles to days equivalent for sorting - only if category applies)
    if (categoryVisible(MAINTENANCE_CATEGORY_NAMES.cambelt)) {
      if (vehicle.cambelt_status?.status === 'overdue') {
        const milesUntil = vehicle.cambelt_status.miles_until ?? 0;
        alerts.push({
          type: 'Cambelt',
          detail: formatMilesUntil(milesUntil, distanceUnit),
          severity: 'overdue',
          sortValue: Math.round(milesUntil / ESTIMATED_DAILY_MILES) // Convert miles to days equivalent
        });
      } else if (vehicle.cambelt_status?.status === 'due_soon') {
        const milesUntil = vehicle.cambelt_status.miles_until ?? 0;
        alerts.push({
          type: 'Cambelt',
          detail: formatMilesUntil(milesUntil, distanceUnit),
          severity: 'due_soon',
          sortValue: Math.round(milesUntil / ESTIMATED_DAILY_MILES) // Convert miles to days equivalent
        });
      }
    }
    
    // Check First Aid (only if category applies to this asset type)
    if (categoryVisible(MAINTENANCE_CATEGORY_NAMES.firstAid)) {
      if (vehicle.first_aid_status?.status === 'overdue') {
        alerts.push({
          type: 'First Aid Kit',
          detail: formatDaysUntil(vehicle.first_aid_status.days_until),
          severity: 'overdue',
          sortValue: vehicle.first_aid_status.days_until ?? 0
        });
      } else if (vehicle.first_aid_status?.status === 'due_soon') {
        alerts.push({
          type: 'First Aid Kit',
          detail: formatDaysUntil(vehicle.first_aid_status.days_until),
          severity: 'due_soon',
          sortValue: vehicle.first_aid_status.days_until ?? 0
        });
      }
    }
    
    // Check LOLER (for plant machinery - only if category applies)
    if (categoryVisible(MAINTENANCE_CATEGORY_NAMES.loler)) {
      if (vehicle.loler_status?.status === 'overdue') {
        alerts.push({
          type: 'LOLER',
          detail: formatDaysUntil(vehicle.loler_status.days_until),
          severity: 'overdue',
          sortValue: vehicle.loler_status.days_until ?? 0
        });
      } else if (vehicle.loler_status?.status === 'due_soon') {
        alerts.push({
          type: 'LOLER',
          detail: formatDaysUntil(vehicle.loler_status.days_until),
          severity: 'due_soon',
          sortValue: vehicle.loler_status.days_until ?? 0
        });
      }
    }
    
    // Check 6 Weekly Inspection (HGV - only if category applies)
    if (categoryVisible(MAINTENANCE_CATEGORY_NAMES.sixWeekly)) {
      if (vehicle.six_weekly_status?.status === 'overdue') {
        alerts.push({
          type: '6 Weekly Inspection',
          detail: formatDaysUntil(vehicle.six_weekly_status.days_until),
          severity: 'overdue',
          sortValue: vehicle.six_weekly_status.days_until ?? 0
        });
      } else if (vehicle.six_weekly_status?.status === 'due_soon') {
        alerts.push({
          type: '6 Weekly Inspection',
          detail: formatDaysUntil(vehicle.six_weekly_status.days_until),
          severity: 'due_soon',
          sortValue: vehicle.six_weekly_status.days_until ?? 0
        });
      }
    }
    
    // Check Fire Extinguisher (HGV - only if category applies)
    if (categoryVisible(MAINTENANCE_CATEGORY_NAMES.fireExtinguisher)) {
      if (vehicle.fire_extinguisher_status?.status === 'overdue') {
        alerts.push({
          type: 'Fire Extinguisher',
          detail: formatDaysUntil(vehicle.fire_extinguisher_status.days_until),
          severity: 'overdue',
          sortValue: vehicle.fire_extinguisher_status.days_until ?? 0
        });
      } else if (vehicle.fire_extinguisher_status?.status === 'due_soon') {
        alerts.push({
          type: 'Fire Extinguisher',
          detail: formatDaysUntil(vehicle.fire_extinguisher_status.days_until),
          severity: 'due_soon',
          sortValue: vehicle.fire_extinguisher_status.days_until ?? 0
        });
      }
    }
    
    // Check Taco Calibration (HGV - only if category applies)
    if (categoryVisible(MAINTENANCE_CATEGORY_NAMES.tacoCalibration)) {
      if (vehicle.taco_calibration_status?.status === 'overdue') {
        alerts.push({
          type: 'Taco Calibration',
          detail: formatDaysUntil(vehicle.taco_calibration_status.days_until),
          severity: 'overdue',
          sortValue: vehicle.taco_calibration_status.days_until ?? 0
        });
      } else if (vehicle.taco_calibration_status?.status === 'due_soon') {
        alerts.push({
          type: 'Taco Calibration',
          detail: formatDaysUntil(vehicle.taco_calibration_status.days_until),
          severity: 'due_soon',
          sortValue: vehicle.taco_calibration_status.days_until ?? 0
        });
      }
    }
    
    // Check Service Due (Hours) (plant machinery - only if category applies)
    if (categoryVisible(MAINTENANCE_CATEGORY_NAMES.serviceHours)) {
      if (vehicle.service_hours_status?.status === 'overdue') {
        const hoursUntil = vehicle.service_hours_status.hours_until ?? 0;
        alerts.push({
          type: 'Service (Hours)',
          detail: formatHoursUntil(hoursUntil),
          severity: 'overdue',
          sortValue: hoursUntil
        });
      } else if (vehicle.service_hours_status?.status === 'due_soon') {
        const hoursUntil = vehicle.service_hours_status.hours_until ?? 0;
        alerts.push({
          type: 'Service (Hours)',
          detail: formatHoursUntil(hoursUntil),
          severity: 'due_soon',
          sortValue: hoursUntil
        });
      }
    }

    (vehicle.maintenance_items || [])
      .filter(item => item.source === 'custom')
      .filter(item => item.status.status === 'overdue' || item.status.status === 'due_soon')
      .forEach(item => {
        const sortValue = item.status.days_until
          ?? (item.status.miles_until != null ? Math.round(item.status.miles_until / ESTIMATED_DAILY_MILES) : undefined)
          ?? item.status.hours_until
          ?? 0;
        const detail = item.status.days_until != null
          ? formatDaysUntil(item.status.days_until)
          : item.status.miles_until != null
            ? formatMilesUntil(item.status.miles_until, distanceUnit)
            : formatHoursUntil(item.status.hours_until ?? 0);

        alerts.push({
          type: item.category_name,
          detail,
          severity: item.status.status as Alert['severity'],
          sortValue,
        });
      });
    
    return {
      ...vehicle,
      alerts
    };
  });

  const handleCreateTask = (vehicleId: string, alert: Alert) => {
    setCreateTaskVehicleId(vehicleId);
    setCreateTaskCategoryId(maintenanceCategoryId);
    setCreateTaskAlertType(alert.type as AlertType);
    setShowCreateTaskDialog(true);
  };

  const handleOfficeAction = (vehicleId: string, vehicle: VehicleWithAlerts, alert: Alert) => {
    const alertType = alert.type as AlertType;
    
    // Get the current due date based on alert type
    let currentDueDate: string | null = null;
    if (alertType === 'Tax') {
      currentDueDate = vehicle.tax_due_date || null;
    } else if (alertType === 'MOT') {
      currentDueDate = vehicle.mot_due_date || null;
    } else if (alertType === 'First Aid Kit') {
      currentDueDate = vehicle.first_aid_kit_expiry || null;
    } else if (alertType === 'LOLER') {
      currentDueDate = vehicle.loler_due_date || null;
    } else if (alertType === '6 Weekly Inspection') {
      currentDueDate = vehicle.six_weekly_inspection_due_date || null;
    } else if (alertType === 'Fire Extinguisher') {
      currentDueDate = vehicle.fire_extinguisher_due_date || null;
    } else if (alertType === 'Taco Calibration') {
      currentDueDate = vehicle.taco_calibration_due_date || null;
    }
    
    setOfficeActionVehicle({
      vehicleId,
      assetType: (vehicle.vehicle?.asset_type as 'van' | 'hgv' | 'plant') || 'van',
      vehicleReg: vehicle.vehicle?.reg_number || vehicle.vehicle?.plant_id || 'Unknown',
      vehicleNickname: vehicle.vehicle?.nickname,
      alertType,
      dueInfo: alert.detail,
      currentDueDate,
    });
    setShowOfficeActionDialog(true);
  };

  const handleOfficeActionSuccess = () => {
    // Trigger a data refresh by invalidating the history cache
    if (officeActionVehicle?.vehicleId) {
      setVehicleHistory(prev => {
        const newHistory = { ...prev };
        delete newHistory[officeActionVehicle.vehicleId];
        return newHistory;
      });
      fetchVehicleHistory(officeActionVehicle.vehicleId, isPlantAsset(officeActionVehicle.vehicleId), true);
    }
    // Trigger Next.js soft refresh to refetch server data without losing client state
    router.refresh();
  };

  const handleQuickEditSuccess = () => {
    // Trigger Next.js soft refresh to refetch server data without losing client state
    router.refresh();
  };

  const handleTaskCreated = async () => {
    // Refetch history for the vehicle to show the newly created task
    if (createTaskVehicleId) {
      // Clear the cache for this vehicle
      setVehicleHistory(prev => {
        const newHistory = { ...prev };
        delete newHistory[createTaskVehicleId];
        return newHistory;
      });
      
      // Force refetch (bypass cache check since state update is async)
      fetchVehicleHistory(createTaskVehicleId, isPlantAsset(createTaskVehicleId), true);
    }
  };

  // Handler: Mark In Progress
  const handleMarkInProgress = (task: WorkshopTask) => {
    setSelectedTask(task);
    setLoggedComment('');
    setShowStatusModal(true);
  };

  const confirmMarkInProgress = async () => {
    if (!selectedTask) return;

    if (!loggedComment.trim()) {
      toast.error('Please add a comment', { id: 'maintenance-overview-validation-log-comment-required' });
      return;
    }

    if (loggedComment.length > 300) {
      toast.error('Comment must be 300 characters or less', { id: 'maintenance-overview-validation-log-comment-too-long' });
      return;
    }

    try {
      const supabase = createClient();
      const statusEvent = buildStatusHistoryEvent({
        status: 'logged',
        body: loggedComment.trim(),
        authorId: user?.id || null,
        authorName: profile?.full_name || null,
      });
      const nextHistory = appendStatusHistory(
        selectedTask.status_history,
        statusEvent
      );

      const { error } = await supabase
        .from('actions')
        .update({
          status: 'logged',
          logged_at: new Date().toISOString(),
          logged_comment: loggedComment.trim(),
          logged_by: user?.id || null,
          status_history: nextHistory,
        })
        .eq('id', selectedTask.id);

      if (error) throw error;

      toast.success('Task marked as in progress');
      setShowStatusModal(false);
      
      // Refetch vehicle history
      const vehicleId = selectedTask.van_id || selectedTask.hgv_id || selectedTask.plant_id;
      if (vehicleId) {
        setVehicleHistory(prev => {
          const newHistory = { ...prev };
          delete newHistory[vehicleId];
          return newHistory;
        });
        fetchVehicleHistory(vehicleId, isPlantAsset(vehicleId), true);
      }
    } catch (error: unknown) {
      const errorContextId = 'maintenance-overview-mark-in-progress-error';
      console.error('Error marking task in progress:', error instanceof Error ? error.message : error, { errorContextId });
      toast.error('Failed to update task', { id: errorContextId });
    }
  };

  // Handler: Undo (revert to pending)
  const handleUndo = async (task: WorkshopTask) => {
    try {
      const supabase = createClient();
      const statusEvent = buildStatusHistoryEvent({
        status: 'undo',
        body: 'Returned to pending',
        authorId: user?.id || null,
        authorName: profile?.full_name || null,
        meta: { from: 'logged', to: 'pending' },
      });
      const nextHistory = appendStatusHistory(task.status_history, statusEvent);
      const { error } = await supabase
        .from('actions')
        .update({
          status: 'pending',
          logged_at: null,
          logged_comment: null,
          logged_by: null,
          status_history: nextHistory,
        })
        .eq('id', task.id);

      if (error) throw error;

      toast.success('Task reverted to pending');
      
      // Refetch vehicle history
      const vehicleId = task.van_id || task.hgv_id || task.plant_id;
      if (vehicleId) {
        setVehicleHistory(prev => {
          const newHistory = { ...prev };
          delete newHistory[vehicleId];
          return newHistory;
        });
        fetchVehicleHistory(vehicleId, isPlantAsset(vehicleId), true);
      }
    } catch (error: unknown) {
      const errorContextId = 'maintenance-overview-undo-task-error';
      console.error('Error undoing task:', error instanceof Error ? error.message : error, { errorContextId });
      toast.error('Failed to undo task', { id: errorContextId });
    }
  };

  // Handler: Mark Complete
  const handleMarkComplete = (task: WorkshopTask) => {
    setCompletingTask(task);
    setShowCompleteModal(true);
  };

  const confirmMarkComplete = async (data: CompletionData) => {
    if (!completingTask) return;

    const taskId = completingTask.id;
    const vehicleId = completingTask.van_id || completingTask.hgv_id || completingTask.plant_id;
    const requiresIntermediateStep = completingTask.status === 'pending' || completingTask.status === 'on_hold';

    try {
      setUpdatingStatus(prev => new Set(prev).add(taskId));

      const supabase = createClient();
      const completedAt = new Date(data.completedAt);
      const completedAtIso = completedAt.toISOString();
      const createdAtIso = data.createdAt ? new Date(data.createdAt).toISOString() : undefined;
      const intermediateAtIso = data.intermediateAt
        ? new Date(data.intermediateAt).toISOString()
        : new Date(completedAt.getTime() - 1).toISOString();

      // Fetch latest status_history from database to ensure we have current state
      const { data: latestTask, error: fetchError } = await supabase
        .from('actions')
        .select('status_history')
        .eq('id', taskId)
        .single();

      if (fetchError) {
        console.error('Error fetching latest task state:', fetchError);
        throw fetchError;
      }

      // Use database status_history (or empty array if null)
      let nextHistory = Array.isArray(latestTask.status_history) 
        ? latestTask.status_history 
        : [];

      let updatePayload: Record<string, unknown> = {
        ...(createdAtIso ? { created_at: createdAtIso } : {}),
        ...(data.intermediateAt ? { logged_at: intermediateAtIso } : {}),
        status: 'completed',
        actioned: true,
        actioned_at: completedAtIso,
        actioned_comment: data.completedComment,
        actioned_by: user?.id || null,
        actioned_signature_data: data.completedSignatureData || null,
        actioned_signed_at: data.completedSignatureData ? completedAtIso : null,
      };

      if (requiresIntermediateStep) {
        const intermediateStatus = completingTask.status === 'on_hold' ? 'resumed' : 'logged';
        const intermediateEvent = buildStatusHistoryEvent({
          status: intermediateStatus,
          body: data.intermediateComment,
          authorId: user?.id || null,
          authorName: profile?.full_name || null,
          createdAt: intermediateAtIso,
        });
        nextHistory = appendStatusHistory(nextHistory, intermediateEvent);

        updatePayload = {
          ...updatePayload,
          logged_at: intermediateAtIso,
          logged_comment: data.intermediateComment,
          logged_by: user?.id || null,
        };
      } else if (data.intermediateAt) {
        nextHistory = updateLatestInProgressStatusHistoryTimestamp(
          nextHistory,
          intermediateAtIso
        );
      }

      const completeEvent = buildStatusHistoryEvent({
        status: 'completed',
        body: data.completedComment,
        authorId: user?.id || null,
        authorName: profile?.full_name || null,
        meta: data.completedSignatureData
          ? {
              signature_data: data.completedSignatureData,
              signed_at: completedAtIso,
            }
          : undefined,
        createdAt: completedAtIso,
      });
      nextHistory = appendStatusHistory(nextHistory, completeEvent);

      updatePayload.status_history = nextHistory;

      // Mark as complete
      const { error: completeError } = await supabase
        .from('actions')
        .update(updatePayload)
        .eq('id', taskId);

      if (completeError) throw completeError;

      const linkedMaintenance = inferMaintenanceLink({
        title: completingTask.title,
        description: completingTask.description,
        workshopCategoryName: completingTask.workshop_task_categories?.name,
        workshopSubcategoryName: completingTask.workshop_task_subcategories?.name,
      });

      // Update maintenance if there are explicit updates or a linked maintenance task.
      if (vehicleId && (data.maintenanceUpdates || linkedMaintenance)) {
        try {
          const maintenanceResponse = await fetch(
            `/api/maintenance/by-vehicle/${vehicleId}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...data.maintenanceUpdates,
                assetType: completingTask.plant_id ? 'plant' : completingTask.hgv_id ? 'hgv' : 'van',
                task_id: taskId,
                completed_at: completedAtIso,
                task_title: completingTask.title,
                task_description: completingTask.description,
                task_category_name: completingTask.workshop_task_categories?.name,
                task_subcategory_name: completingTask.workshop_task_subcategories?.name,
                comment: `Updated from workshop task completion: ${completingTask.title || 'Task'}`,
              }),
            }
          );

          if (!maintenanceResponse.ok) {
            const error = await maintenanceResponse.json();
            console.error('Failed to update maintenance:', error);
            toast.warning('Task completed but maintenance update failed');
          }
        } catch (maintError) {
          console.error('Error updating maintenance:', maintError);
          toast.warning('Task completed but maintenance update failed');
        }
      }

      toast.success('Task marked as complete');
      setShowCompleteModal(false);
      setCompletingTask(null);
      
      // Refetch vehicle history
      if (vehicleId) {
        setVehicleHistory(prev => {
          const newHistory = { ...prev };
          delete newHistory[vehicleId];
          return newHistory;
        });
        fetchVehicleHistory(vehicleId, isPlantAsset(vehicleId), true);
      }

      setUpdatingStatus(prev => {
        const newSet = new Set(prev);
        newSet.delete(taskId);
        return newSet;
      });
    } catch (error: unknown) {
      const errorContextId = 'maintenance-overview-mark-complete-error';
      console.error('Error marking task complete:', error instanceof Error ? error.message : error, { errorContextId });
      toast.error('Failed to complete task', { id: errorContextId });
      setUpdatingStatus(prev => {
        const newSet = new Set(prev);
        newSet.delete(taskId);
        return newSet;
      });
    }
  };

  // Handler: On Hold
  const handleOnHold = (task: WorkshopTask) => {
    setOnHoldingTask(task);
    setOnHoldComment('');
    setShowOnHoldModal(true);
  };

  const confirmOnHold = async () => {
    if (!onHoldingTask) return;

    if (!onHoldComment.trim()) {
      toast.error('Please add a comment explaining why this task is on hold', {
        id: 'maintenance-overview-validation-on-hold-comment-required',
      });
      return;
    }

    if (onHoldComment.length > 300) {
      toast.error('Comment must be 300 characters or less', {
        id: 'maintenance-overview-validation-on-hold-comment-too-long',
      });
      return;
    }

    try {
      const supabase = createClient();
      const statusEvent = buildStatusHistoryEvent({
        status: 'on_hold',
        body: onHoldComment.trim(),
        authorId: user?.id || null,
        authorName: profile?.full_name || null,
      });
      const nextHistory = appendStatusHistory(
        onHoldingTask.status_history,
        statusEvent
      );
      const { error } = await supabase
        .from('actions')
        .update({
          status: 'on_hold',
          logged_at: new Date().toISOString(),
          logged_comment: onHoldComment.trim(),
          logged_by: user?.id || null,
          status_history: nextHistory,
        })
        .eq('id', onHoldingTask.id);

      if (error) throw error;

      toast.success('Task marked as on hold');
      setShowOnHoldModal(false);

      // Refetch vehicle history
      const vehicleId = onHoldingTask.van_id || onHoldingTask.hgv_id || onHoldingTask.plant_id;
      if (vehicleId) {
        setVehicleHistory(prev => {
          const newHistory = { ...prev };
          delete newHistory[vehicleId];
          return newHistory;
        });
        fetchVehicleHistory(vehicleId, isPlantAsset(vehicleId), true);
      }
    } catch (error: unknown) {
      const errorContextId = 'maintenance-overview-mark-on-hold-error';
      console.error('Error marking task on hold:', error, { errorContextId });
      toast.error('Failed to update task', { id: errorContextId });
    }
  };

  // Handler: Resume
  const handleResume = (task: WorkshopTask) => {
    setResumingTask(task);
    setResumeComment('');
    setShowResumeModal(true);
  };

  const confirmResume = async () => {
    if (!resumingTask) return;

    if (!resumeComment.trim()) {
      toast.error('Please add a comment about resuming this task', {
        id: 'maintenance-overview-validation-resume-comment-required',
      });
      return;
    }

    if (resumeComment.length > 300) {
      toast.error('Comment must be 300 characters or less', {
        id: 'maintenance-overview-validation-resume-comment-too-long',
      });
      return;
    }

    try {
      const supabase = createClient();
      const statusEvent = buildStatusHistoryEvent({
        status: 'resumed',
        body: resumeComment.trim(),
        authorId: user?.id || null,
        authorName: profile?.full_name || null,
      });
      const nextHistory = appendStatusHistory(
        resumingTask.status_history,
        statusEvent
      );
      const { error } = await supabase
        .from('actions')
        .update({
          status: 'logged',
          logged_at: new Date().toISOString(),
          logged_comment: resumeComment.trim(),
          logged_by: user?.id || null,
          status_history: nextHistory,
        })
        .eq('id', resumingTask.id);

      if (error) throw error;

      toast.success('Task resumed');
      setShowResumeModal(false);

      // Refetch vehicle history
      const vehicleId = resumingTask.van_id || resumingTask.hgv_id || resumingTask.plant_id;
      if (vehicleId) {
        setVehicleHistory(prev => {
          const newHistory = { ...prev };
          delete newHistory[vehicleId];
          return newHistory;
        });
        fetchVehicleHistory(vehicleId, isPlantAsset(vehicleId), true);
      }
    } catch (error: unknown) {
      const errorContextId = 'maintenance-overview-resume-task-error';
      console.error('Error resuming task:', error instanceof Error ? error.message : error, { errorContextId });
      toast.error('Failed to resume task', { id: errorContextId });
    }
  };

  // Handler: Open Comments Drawer
  const handleOpenComments = (task: WorkshopTask) => {
    setCommentsTask(task);
    setShowCommentsDrawer(true);
  };

  const toggleEntry = useCallback(async (entryKey: string, vehicleId: string, isPlant: boolean) => {
    setExpandedVehicles(prev => {
      const newExpanded = new Set(prev);
      if (newExpanded.has(entryKey)) {
        newExpanded.delete(entryKey);
      } else {
        newExpanded.add(entryKey);
        fetchVehicleHistory(vehicleId, isPlant);
      }
      return newExpanded;
    });
  }, [fetchVehicleHistory]);

  const handleCardClick = (entry: AlertEntry) => {
    if (onVehicleClick) {
      onVehicleClick(entry.vehicle);
    } else {
      toggleEntry(entry.entryKey, entry.vehicleId, entry.isPlant);
    }
  };

  const getHgvMaintenanceSummaryItems = (vehicle: VehicleWithAlerts): AlertSummaryItem[] => {
    const distanceUnit = getDistanceUnitLabel(vehicle.vehicle?.asset_type);

    const categoryItems = (vehicle.maintenance_items || []).map(item => ({
      label: item.category_name,
      value: item.display_value,
      isHighlighted: item.status.status === 'overdue' || item.status.status === 'due_soon',
    }));

    return [
      {
        label: 'KM',
        value: formatDistanceReading(vehicle.current_mileage, distanceUnit),
      },
      ...categoryItems,
    ];
  };
  
  // Flatten to one entry per alert so each alert gets its own card
  const allAlertEntries: AlertEntry[] = vehiclesWithAlerts.flatMap(v => {
    const isPlant = 'is_plant' in v && v.is_plant === true;
    const vehicleId = isPlant
      ? (v.plant_id ?? v.id)
      : (v.van_id ?? v.hgv_id ?? v.id);
    return v.alerts.map(alert => ({
      vehicle: v,
      alert,
      entryKey: `${vehicleId}-${alert.type}`,
      vehicleId,
      isPlant,
    }));
  });

  const overdueEntries = allAlertEntries
    .filter(e => e.alert.severity === 'overdue')
    .sort((a, b) => a.alert.sortValue - b.alert.sortValue);

  const dueSoonEntries = allAlertEntries
    .filter(e => e.alert.severity === 'due_soon')
    .sort((a, b) => a.alert.sortValue - b.alert.sortValue);
  
  const assetTypes = new Set(vehicles.map(v => v.vehicle?.asset_type).filter(Boolean));
  const isMixed = assetTypes.size > 1;
  const singleType = assetTypes.size === 1 ? [...assetTypes][0] : null;
  const assetLabel = isMixed ? 'asset' : singleType === 'plant' ? 'plant asset' : singleType === 'hgv' ? 'HGV' : 'van';
  const assetLabelPlural = isMixed ? 'assets' : singleType === 'plant' ? 'plant assets' : singleType === 'hgv' ? 'HGVs' : 'vans';

  if (overdueEntries.length === 0 && dueSoonEntries.length === 0) {
    return (
      <Card className="bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-full bg-green-100 dark:bg-green-900/40">
              <Wrench className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <h3 className="font-semibold text-green-900 dark:text-green-100">
                All Caught Up!
              </h3>
              <p className="text-sm text-green-700 dark:text-green-300">
                No maintenance items are overdue or due soon. {summary.total} {summary.total !== 1 ? assetLabelPlural : assetLabel} being monitored.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const renderAlertCard = (entry: AlertEntry, isOverdue: boolean) => {
    const { vehicle, alert: cardAlert, entryKey, vehicleId, isPlant } = entry;
    const isExpanded = expandedVehicles.has(entryKey);
    const historyData = vehicleHistory[vehicleId];
    const historyResolved = Boolean(historyData) && !historyData.loading;
    const regNumber = vehicle.vehicle?.reg_number || vehicle.vehicle?.plant_id || 'Unknown';
    const { title: expectedTitle } = getTaskContent(cardAlert.type as AlertType, regNumber, '');
    const relatedTask = historyResolved
      ? historyData?.workshopTasks.find(task => {
          if (task.status === 'completed') return false;
          return task.title === expectedTitle || task.description?.includes(expectedTitle);
        }) || null
      : null;
    const hasExistingTask = Boolean(relatedTask);
    
    return (
      <Card 
        key={entryKey}
        className={`cursor-pointer transition-all ${
          isOverdue 
            ? 'bg-white dark:bg-slate-900 border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-slate-800/50' 
            : 'bg-white dark:bg-slate-900 border-amber-200 dark:border-amber-800 hover:bg-amber-50 dark:hover:bg-slate-800/50'
        }`}
        onClick={() => handleCardClick(entry)}
      >
        <CardContent className="p-4">
          {/* Collapsed View - Now includes ALL service information */}
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                {/* Vehicle Info and Alerts */}
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="font-semibold text-lg text-white">
                      {vehicle.vehicle?.reg_number || vehicle.vehicle?.plant_id || vehicle.vehicle?.serial_number || 'Unknown'}
                    </h3>
                    {vehicle.vehicle?.nickname && (
                      <span className="text-sm text-muted-foreground">({vehicle.vehicle.nickname})</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <QuickEditPopover
                      alert={cardAlert}
                      vehicleId={vehicleId}
                      vehicle={vehicle}
                      onSuccess={handleQuickEditSuccess}
                    />
                  </div>
                </div>
              </div>
              
              {/* Status area: reserve space to avoid action jump while task state resolves */}
              <div className="min-h-[32px] min-w-[120px] flex items-start justify-end">
                {!historyResolved ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mt-1" />
                ) : relatedTask ? (
                  <Badge 
                    variant="outline" 
                    className={`text-sm px-3 py-1 font-semibold ${
                      relatedTask.status === 'pending' 
                        ? 'bg-yellow-500/10 text-yellow-300 border-yellow-500/30'
                        : relatedTask.status === 'logged' || relatedTask.status === 'in_progress'
                        ? 'bg-blue-500/10 text-blue-300 border-blue-500/30'
                        : 'bg-purple-500/10 text-purple-300 border-purple-500/30'
                    }`}
                  >
                    {relatedTask.status === 'logged' || relatedTask.status === 'in_progress' ? 'In Progress' : relatedTask.status === 'pending' ? 'Pending' : 'On Hold'}
                  </Badge>
                ) : null}
              </div>
            </div>
            
            {/* Service Information - Horizontal Row with Status Badge and Chevron */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-wrap gap-x-6 gap-y-2 flex-1">
                {isPlant ? (
                  <>
                    <div className="space-y-0">
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Hours</div>
                      <div className="text-sm font-medium text-white">
                        {formatHours(vehicle.current_hours)}
                      </div>
                    </div>
                    <div className="space-y-0">
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">LOLER Due</div>
                      <div className={`text-sm font-medium ${vehicle.loler_status?.status === 'overdue' || vehicle.loler_status?.status === 'due_soon' ? 'text-red-400' : 'text-white'}`}>
                        {formatMaintenanceDate(vehicle.loler_due_date)}
                      </div>
                    </div>
                    <div className="space-y-0">
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Tax Due</div>
                      <div className={`text-sm font-medium ${vehicle.tax_status?.status === 'overdue' || vehicle.tax_status?.status === 'due_soon' ? 'text-red-400' : 'text-white'}`}>
                        {formatMaintenanceDate(vehicle.tax_due_date)}
                      </div>
                    </div>
                    <div className="space-y-0">
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Service Due</div>
                      <div className={`text-sm font-medium ${vehicle.service_hours_status?.status === 'overdue' || vehicle.service_hours_status?.status === 'due_soon' ? 'text-red-400' : 'text-white'}`}>
                        {vehicle.next_service_hours ? formatHours(vehicle.next_service_hours) : 'Not Set'}
                      </div>
                    </div>
                    <div className="space-y-0">
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Last Service</div>
                      <div className="text-sm font-medium text-white">
                        {vehicle.last_service_hours ? formatHours(vehicle.last_service_hours) : 'Not Set'}
                      </div>
                    </div>
                  </>
                ) : (
                  vehicle.vehicle?.asset_type === 'hgv' ? (
                    <>
                      {getHgvMaintenanceSummaryItems(vehicle).map(item => (
                        <div key={item.label} className="space-y-0">
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
                            {item.label}
                          </div>
                          <div className={`text-sm font-medium ${item.isHighlighted ? 'text-red-400' : 'text-white'}`}>
                            {item.value}
                          </div>
                        </div>
                      ))}
                      {vehicle.tracker_id && (
                        <div className="space-y-0">
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">GPS Tracker</div>
                          <div className="text-sm font-medium text-white">
                            {vehicle.tracker_id}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="space-y-0">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Mileage</div>
                        <div className="text-sm font-medium text-white">
                          {formatMileage(vehicle.current_mileage)}
                        </div>
                      </div>
                      <div className="space-y-0">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Tax Due</div>
                        <div className={`text-sm font-medium ${vehicle.tax_status?.status === 'overdue' || vehicle.tax_status?.status === 'due_soon' ? 'text-red-400' : 'text-white'}`}>
                          {formatMaintenanceDate(vehicle.tax_due_date)}
                        </div>
                      </div>
                      <div className="space-y-0">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">MOT Due</div>
                        <div className={`text-sm font-medium ${vehicle.mot_status?.status === 'overdue' || vehicle.mot_status?.status === 'due_soon' ? 'text-red-400' : 'text-white'}`}>
                          {formatMaintenanceDate(vehicle.mot_due_date)}
                        </div>
                      </div>
                      <div className="space-y-0">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">First Aid</div>
                        <div className={`text-sm font-medium ${vehicle.first_aid_status?.status === 'overdue' || vehicle.first_aid_status?.status === 'due_soon' ? 'text-red-400' : 'text-white'}`}>
                          {formatMaintenanceDate(vehicle.first_aid_kit_expiry)}
                        </div>
                      </div>
                      <div className="space-y-0">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Service Due</div>
                        <div className={`text-sm font-medium ${vehicle.service_status?.status === 'overdue' || vehicle.service_status?.status === 'due_soon' ? 'text-red-400' : 'text-white'}`}>
                          {vehicle.next_service_mileage ? formatMileage(vehicle.next_service_mileage) : 'Not Set'}
                        </div>
                      </div>
                      <div className="space-y-0">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Last Service</div>
                        <div className="text-sm font-medium text-white">
                          {vehicle.last_service_mileage ? formatMileage(vehicle.last_service_mileage) : 'Not Set'}
                        </div>
                      </div>
                      <div className="space-y-0">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Cambelt</div>
                        <div className={`text-sm font-medium ${vehicle.cambelt_status?.status === 'overdue' || vehicle.cambelt_status?.status === 'due_soon' ? 'text-red-400' : 'text-white'}`}>
                          {vehicle.cambelt_due_mileage ? formatMileage(vehicle.cambelt_due_mileage) : 'Not Set'}
                        </div>
                      </div>
                      {vehicle.tracker_id && (
                        <div className="space-y-0">
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">GPS Tracker</div>
                          <div className="text-sm font-medium text-white">
                            {vehicle.tracker_id}
                          </div>
                        </div>
                      )}
                    </>
                  )
                )}
              </div>
              
              {/* Action Button - Bottom Right (mutually exclusive: Office Action OR Create Task OR Expand OR Loading) */}
              <div className="flex-shrink-0 min-w-[132px] flex justify-end">
                {!historyResolved ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground"
                    disabled
                  >
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    Loading...
                  </Button>
                ) : !hasExistingTask ? (
                  (() => {
                    const responsibility = getCategoryResponsibility(cardAlert.type);
                    
                    if (responsibility === 'office') {
                      return (
                        <Button
                          size="sm"
                          variant="default"
                          className="bg-brand-yellow hover:bg-brand-yellow-hover text-slate-900"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOfficeAction(vehicleId, vehicle, cardAlert);
                          }}
                        >
                          <Briefcase className="h-4 w-4 mr-1" />
                          Office Action
                        </Button>
                      );
                    }
                    
                    return (
                      <Button
                        size="sm"
                        variant="default"
                        className="bg-workshop hover:bg-workshop-dark text-white"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCreateTask(vehicleId, cardAlert);
                        }}
                      >
                        <Wrench className="h-4 w-4 mr-1" />
                        Create Task
                      </Button>
                    );
                  })()
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground hover:text-white hover:bg-slate-800"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleEntry(entryKey, vehicleId, isPlant);
                    }}
                  >
                    {isExpanded ? (
                      <>
                        <ChevronUp className="h-4 w-4 mr-1" />
                        Collapse
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-4 w-4 mr-1" />
                        Expand
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Expanded View - Workshop Tasks */}
          {isExpanded && (
            <div className="mt-4 pt-4 border-t border-border" onClick={(e) => e.stopPropagation()}>
              {!historyResolved ? (
                <PanelLoader message="Loading related workshop task..." accent="maintenance" className="py-6" />
              ) : !relatedTask ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No active workshop task found</p>
              ) : (
                (() => {
                  // Ensure task has van_id for handlers (TaskForCompletion requires van_id: string | null)
                  const taskWithVehicleId = { ...relatedTask, van_id: vehicleId ?? null };

                  // Display task details directly
                  return (
                  <div className="bg-slate-800/50 rounded-lg p-4 space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 space-y-2">
                        <h5 className="font-medium text-white">{relatedTask.title}</h5>
                        {relatedTask.workshop_comments && (
                          <p className="text-sm text-muted-foreground">{relatedTask.workshop_comments}</p>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>Created {formatDateTime(relatedTask.created_at)}</span>
                      {relatedTask.profiles?.full_name && (
                        <span>by {relatedTask.profiles.full_name}</span>
                      )}
                    </div>
                    
                    {/* Action Buttons - Aligned Right */}
                    <div className="flex justify-end gap-2 pt-2 border-t border-border">
                      {/* Pending Status Buttons: Comments, In Progress, Complete */}
                      {relatedTask.status === 'pending' && (
                        <>
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenComments(taskWithVehicleId);
                            }}
                            size="sm"
                            variant="outline"
                            className="h-9 px-3 text-xs border-slate-600 text-muted-foreground hover:text-white hover:bg-slate-800"
                          >
                            <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                            Comments
                          </Button>
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMarkInProgress(taskWithVehicleId);
                            }}
                            size="sm"
                            className="h-9 px-3 text-xs bg-maintenance/80 hover:bg-maintenance text-white border-0"
                          >
                            <Clock className="h-3.5 w-3.5 mr-1.5" />
                            In Progress
                          </Button>
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMarkComplete(taskWithVehicleId);
                            }}
                            size="sm"
                            className="h-9 px-3 text-xs transition-all border-0 bg-green-600 hover:bg-green-700 text-white"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                            Complete
                          </Button>
                        </>
                      )}
                      
                      {/* In Progress (Logged) Status Buttons: Comments, Undo, On Hold, Complete */}
                      {(relatedTask.status === 'logged' || relatedTask.status === 'in_progress') && (
                        <>
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenComments(taskWithVehicleId);
                            }}
                            size="sm"
                            variant="outline"
                            className="h-9 px-3 text-xs border-slate-600 text-muted-foreground hover:text-white hover:bg-slate-800"
                          >
                            <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                            Comments
                          </Button>
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUndo(taskWithVehicleId);
                            }}
                            size="sm"
                            variant="outline"
                            className="h-9 px-3 text-xs border-slate-600 text-muted-foreground hover:text-white hover:bg-slate-800"
                          >
                            <Undo2 className="h-3.5 w-3.5 mr-1.5" />
                            Undo
                          </Button>
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOnHold(taskWithVehicleId);
                            }}
                            size="sm"
                            className="h-9 px-3 text-xs bg-purple-600/80 hover:bg-purple-600 text-white border-0"
                          >
                            <Pause className="h-3.5 w-3.5 mr-1.5" />
                            On Hold
                          </Button>
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMarkComplete(taskWithVehicleId);
                            }}
                            size="sm"
                            className="h-9 px-3 text-xs transition-all border-0 bg-green-600 hover:bg-green-700 text-white"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                            Complete
                          </Button>
                        </>
                      )}
                      
                      {/* On Hold Status Buttons: Comments, Resume, Complete */}
                      {relatedTask.status === 'on_hold' && (
                        <>
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenComments(taskWithVehicleId);
                            }}
                            size="sm"
                            variant="outline"
                            className="h-9 px-3 text-xs border-slate-600 text-muted-foreground hover:text-white hover:bg-slate-800"
                          >
                            <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                            Comments
                          </Button>
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleResume(taskWithVehicleId);
                            }}
                            size="sm"
                            className="h-9 px-3 text-xs transition-all border-0 bg-maintenance hover:bg-maintenance-dark text-white"
                          >
                            <Play className="h-3.5 w-3.5 mr-1.5" />
                            Resume
                          </Button>
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMarkComplete(taskWithVehicleId);
                            }}
                            size="sm"
                            className="h-9 px-3 text-xs transition-all border-0 bg-green-600 hover:bg-green-700 text-white"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                            Complete
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  );
                })()
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };
  
  return (
    <div className="space-y-6">
      {/* Overdue Tasks */}
      {overdueEntries.length > 0 && (
        <Card className="bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
              <CardTitle className="text-lg text-red-900 dark:text-red-100">
                Overdue Tasks
              </CardTitle>
            </div>
            <CardDescription className="text-red-700 dark:text-red-300">
              {overdueEntries.length} {overdueEntries.length !== 1 ? `${assetLabel} tasks` : `${assetLabel} task`} requiring immediate attention
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {overdueEntries.map(entry => renderAlertCard(entry, true))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Due Soon Tasks */}
      {dueSoonEntries.length > 0 && (
        <Card className="bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              <CardTitle className="text-lg text-amber-900 dark:text-amber-100">
                Due Soon
              </CardTitle>
            </div>
            <CardDescription className="text-amber-700 dark:text-amber-300">
              {dueSoonEntries.length} {dueSoonEntries.length !== 1 ? `${assetLabel} tasks` : `${assetLabel} task`} coming up
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {dueSoonEntries.map(entry => renderAlertCard(entry, false))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* About Section */}
      <Card className="bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-800 dark:text-blue-200">
              <p className="font-semibold mb-2">About Maintenance Alerts</p>
              <p>
                This page shows vans and plant with <span className="font-medium text-red-600 dark:text-red-400">Overdue</span> or <span className="font-medium text-amber-600 dark:text-amber-400">Due Soon</span> maintenance items. 
                Items appear here based on the alert thresholds configured in Settings.
              </p>
              
              <div className="mt-4 space-y-3">
                <div className="flex items-start gap-2">
                  <div className="w-6 h-6 rounded bg-workshop flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Wrench className="h-3.5 w-3.5 text-white" />
                  </div>
                  <div>
                    <p className="font-medium">Create Task (Workshop)</p>
                    <p className="text-xs text-blue-700 dark:text-blue-300">
                      For maintenance requiring physical workshop work (Service, Cambelt, MOT). Creates a workshop task that can be assigned and tracked.
                    </p>
                  </div>
                </div>
                
                <div className="flex items-start gap-2">
                  <div className="w-6 h-6 rounded bg-brand-yellow flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Briefcase className="h-3.5 w-3.5 text-slate-900" />
                  </div>
                  <div>
                    <p className="font-medium">Office Action</p>
                    <p className="text-xs text-blue-700 dark:text-blue-300">
                      For administrative tasks like Tax renewal. Opens a dialog with three options:
                    </p>
                    <ul className="text-xs text-blue-700 dark:text-blue-300 mt-1 ml-4 list-disc space-y-0.5">
                      <li><Bell className="h-3 w-3 inline mr-1" /><strong>Send Reminder</strong> - Notify configured recipients via in-app and/or email</li>
                      <li><Calendar className="h-3 w-3 inline mr-1" /><strong>Update Date</strong> - Manually update the due date after completing the action</li>
                      <li><RefreshCw className="h-3 w-3 inline mr-1" /><strong>Refresh DVLA</strong> - Sync Tax/MOT dates from DVLA (updates automatically after online renewal)</li>
                    </ul>
                  </div>
                </div>
              </div>
              
              <p className="mt-4 text-xs text-blue-600 dark:text-blue-400">
                <strong>Tip:</strong> Configure which categories are Workshop vs Office responsibilities in the <span className="font-medium">Settings</span> tab.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Create Workshop Task Dialog */}
      <CreateWorkshopTaskDialog
        open={showCreateTaskDialog}
        onOpenChange={setShowCreateTaskDialog}
        initialVehicleId={createTaskVehicleId}
        initialCategoryId={createTaskCategoryId}
        alertType={createTaskAlertType}
        onSuccess={handleTaskCreated}
      />

      {/* Office Action Dialog */}
      {officeActionVehicle && (
        <OfficeActionDialog
          open={showOfficeActionDialog}
          onOpenChange={setShowOfficeActionDialog}
          vehicleId={officeActionVehicle.vehicleId}
          assetType={officeActionVehicle.assetType}
          vehicleReg={officeActionVehicle.vehicleReg}
          vehicleNickname={officeActionVehicle.vehicleNickname}
          alertType={officeActionVehicle.alertType}
          dueInfo={officeActionVehicle.dueInfo}
          currentDueDate={officeActionVehicle.currentDueDate}
          onSuccess={handleOfficeActionSuccess}
        />
      )}

      {/* Mark In Progress Modal */}
      <Dialog open={showStatusModal} onOpenChange={setShowStatusModal}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] overflow-y-auto bg-white dark:bg-slate-900 border-border text-foreground max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground text-xl">Mark Task In Progress</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Add a short note about starting this work
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="logged-comment" className="text-foreground">
                Comment <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="logged-comment"
                value={loggedComment}
                onChange={(e) => setLoggedComment(e.target.value)}
                placeholder="What are you starting work on?"
                className="bg-white dark:bg-slate-800 border-border text-foreground min-h-[100px]"
                maxLength={300}
              />
              <p className="text-xs text-muted-foreground">
                {loggedComment.length}/300 characters
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowStatusModal(false)}
              className="border-border text-foreground hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmMarkInProgress}
              disabled={!loggedComment.trim() || loggedComment.length > 300}
              className="bg-maintenance hover:bg-maintenance-dark text-white"
            >
              <Clock className="h-4 w-4 mr-2" />
              Mark In Progress
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark Task Complete Modal */}
      <MarkTaskCompleteDialog
        open={showCompleteModal}
        onOpenChange={setShowCompleteModal}
        task={completingTask ? { ...completingTask, van_id: completingTask.van_id ?? null } : null}
        onConfirm={confirmMarkComplete}
        isSubmitting={completingTask ? updatingStatus.has(completingTask.id) : false}
      />

      {/* On Hold Modal */}
      <Dialog open={showOnHoldModal} onOpenChange={setShowOnHoldModal}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] overflow-y-auto bg-white dark:bg-slate-900 border-border text-foreground max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground text-xl">Put Task On Hold</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              This task will be marked as &quot;On Hold&quot; and can be resumed later
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
              <p className="text-sm text-purple-300">
                This task will be marked as &quot;On Hold&quot; and can be resumed later. On hold tasks will still appear in driver inspections.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="onhold-comment" className="text-foreground">
                Reason <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="onhold-comment"
                value={onHoldComment}
                onChange={(e) => setOnHoldComment(e.target.value)}
                placeholder="Why is this task being put on hold?"
                className="bg-white dark:bg-slate-800 border-border text-foreground min-h-[100px]"
                maxLength={300}
              />
              <p className="text-xs text-muted-foreground">
                {onHoldComment.length}/300 characters
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowOnHoldModal(false)}
              className="border-border text-foreground hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmOnHold}
              disabled={!onHoldComment.trim() || onHoldComment.length > 300}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              <Pause className="h-4 w-4 mr-2" />
              Put On Hold
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resume Task Modal */}
      <Dialog open={showResumeModal} onOpenChange={setShowResumeModal}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] overflow-y-auto bg-white dark:bg-slate-900 border-border text-foreground max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground text-xl">Resume Task</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              This task will be moved back to In Progress
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="resume-comment" className="text-foreground">
                Comment <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="resume-comment"
                value={resumeComment}
                onChange={(e) => setResumeComment(e.target.value)}
                placeholder="Note about resuming this task"
                className="bg-white dark:bg-slate-800 border-border text-foreground min-h-[100px]"
                maxLength={300}
              />
              <p className="text-xs text-muted-foreground">
                {resumeComment.length}/300 characters
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowResumeModal(false)}
              className="border-border text-foreground hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmResume}
              disabled={!resumeComment.trim() || resumeComment.length > 300}
              className="bg-maintenance hover:bg-maintenance-dark text-white"
            >
              <Play className="h-4 w-4 mr-2" />
              Resume Task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Task Comments Drawer */}
      {commentsTask && (
        <TaskCommentsDrawer
          taskId={commentsTask.id}
          open={showCommentsDrawer}
          onOpenChange={setShowCommentsDrawer}
          taskTitle={commentsTask.title || 'Workshop Task'}
        />
      )}
    </div>
  );
}
