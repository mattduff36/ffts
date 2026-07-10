import type { Database } from '@/types/database';
import type { CompletionUpdateConfig } from '@/types/workshop-completion';

export type Action = Database['public']['Tables']['actions']['Row'] & {
  status_history?: unknown[] | null;
  vans?: {
    reg_number: string;
    nickname: string | null;
    asset_type?: 'van' | 'plant' | 'hgv' | 'tool';
    plant_id?: string | null;
  } | null;
  plant?: {
    plant_id: string;
    nickname: string | null;
  } | null;
  hgvs?: {
    reg_number: string;
    nickname: string | null;
  };
  workshop_task_categories?: {
    id: string;
    name: string;
    completion_updates?: CompletionUpdateConfig[] | null;
  } | null;
  workshop_task_subcategories?: {
    id: string;
    name: string;
    workshop_task_categories?: {
      name: string;
    } | null;
  } | null;
  profiles_created?: {
    full_name: string | null;
  } | null;
};

export type Vehicle = {
  id: string;
  reg_number: string;
  plant_id?: string | null;
  nickname: string | null;
  asset_type?: 'van' | 'plant' | 'hgv' | 'tool';
};

export type Category = {
  id: string;
  name: string;
  slug: string | null;
  is_active: boolean;
  sort_order: number;
};

export type Subcategory = {
  id: string;
  category_id: string;
  name: string;
  slug: string;
  is_active: boolean;
  sort_order: number;
};

export type AssetTab = 'all' | 'van' | 'plant' | 'hgv';
export type PageTab = 'overview' | 'settings';
export type TaxonomyMode = 'van' | 'plant' | 'hgv';
export type WorkshopTaskStatusFilter = 'all' | 'pending' | 'logged' | 'on_hold' | 'completed';
export type WorkshopTaskTileFilter = WorkshopTaskStatusFilter | 'high_priority';
