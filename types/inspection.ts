export type InspectionStatus = 'ok' | 'attention' | 'defect' | 'na';

export interface VanInspection {
  id: string;
  van_id: string;
  user_id: string;
  inspection_date: string;
  inspection_end_date: string;
  current_mileage: number | null;
  status: 'draft' | 'submitted';
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  manager_comments: string | null;
  inspector_comments?: string | null;
  signature_data?: string | null;
  signed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlantInspection {
  id: string;
  plant_id: string | null;
  user_id: string;
  inspection_date: string;
  inspection_end_date: string | null;
  current_mileage: number | null;
  status: 'draft' | 'submitted';
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  manager_comments: string | null;
  inspector_comments?: string | null;
  signature_data?: string | null;
  signed_at?: string | null;
  is_hired_plant: boolean;
  hired_plant_id_serial?: string | null;
  hired_plant_description?: string | null;
  hired_plant_hiring_company?: string | null;
  created_at: string;
  updated_at: string;
}

export interface HgvInspection {
  id: string;
  hgv_id: string | null;
  user_id: string;
  inspection_date: string;
  inspection_end_date: string | null;
  current_mileage: number | null;
  status: 'draft' | 'submitted';
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  manager_comments: string | null;
  inspector_comments?: string | null;
  signature_data?: string | null;
  signed_at?: string | null;
  created_at: string;
  updated_at: string;
}

/** @deprecated Use VanInspection instead */
export type VehicleInspection = VanInspection;

export interface InspectionItem {
  id: string;
  inspection_id: string;
  item_number: number;
  item_description: string;
  status: InspectionStatus;
  comments: string | null;
  created_at: string;
}

export interface InspectionPhoto {
  id: string;
  inspection_id: string;
  item_number: number | null;
  day_of_week: number | null;
  photo_url: string;
  caption: string | null;
  created_at: string;
}

// Re-export checklist utilities from the centralized configuration
export { 
  INSPECTION_ITEMS,
  getChecklistForCategory,
  isVanCategory,
  type VehicleCategory,
  TRUCK_CHECKLIST_ITEMS,
  VAN_CHECKLIST_ITEMS,
  HGV_ARTIC_ONLY_START_ITEM,
  HGV_ARTIC_ONLY_END_ITEM,
} from '@/lib/checklists/vehicle-checklists';
