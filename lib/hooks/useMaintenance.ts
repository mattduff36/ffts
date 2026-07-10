/**
 * React Query hooks for Vehicle Maintenance & Service
 * Following Development Standards - uses React Query for all server data
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { logger } from '@/lib/utils/logger';
import type {
  MaintenanceListResponse,
  MaintenanceUpdateResponse,
  UpdateMaintenanceRequest,
  CategoriesListResponse,
  MaintenanceHistoryResponse,
  CreateCategoryRequest,
  UpdateCategoryRequest,
  DeletedVehiclesListResponse
} from '@/types/maintenance';

// ============================================================================
// Query: Get all maintenance records
// ============================================================================

export function useMaintenance() {
  return useQuery({
    queryKey: ['maintenance'],
    queryFn: async (): Promise<MaintenanceListResponse> => {
      const response = await fetch('/api/maintenance');
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch maintenance records');
      }
      
      return response.json();
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
}

// ============================================================================
// Query: Get maintenance categories
// ============================================================================

export function useMaintenanceCategories() {
  return useQuery({
    queryKey: ['maintenance', 'categories'],
    queryFn: async (): Promise<CategoriesListResponse> => {
      const response = await fetch('/api/maintenance/categories');
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch categories');
      }
      
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes (categories don't change often)
    gcTime: 30 * 60 * 1000, // 30 minutes
  });
}

// ============================================================================
// Query: Get maintenance history for a vehicle
// ============================================================================

export function useMaintenanceHistory(vehicleId: string | null) {
  return useQuery({
    queryKey: ['maintenance', 'history', vehicleId],
    queryFn: async (): Promise<MaintenanceHistoryResponse> => {
      if (!vehicleId) throw new Error('Vehicle ID is required');
      
      const response = await fetch(`/api/maintenance/history/${vehicleId}`);
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch history');
      }
      
      return response.json();
    },
    enabled: !!vehicleId, // Only run if vehicleId exists
    staleTime: 1 * 60 * 1000, // 1 minute
  });
}

// ============================================================================
// Query: Get maintenance history for a plant
// ============================================================================

export function usePlantMaintenanceHistory(plantId: string | null) {
  return useQuery({
    queryKey: ['maintenance', 'history', 'plant', plantId],
    queryFn: async () => {
      if (!plantId) throw new Error('Plant ID is required');
      
      const response = await fetch(`/api/maintenance/history/plant/${plantId}`);
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch plant history');
      }
      
      return response.json();
    },
    enabled: !!plantId, // Only run if plantId exists
    staleTime: 1 * 60 * 1000, // 1 minute
  });
}

// ============================================================================
// Mutation: Create maintenance record
// ============================================================================

export function useCreateMaintenance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      van_id,
      hgv_id,
      data 
    }: { 
      van_id?: string;
      hgv_id?: string;
      data: UpdateMaintenanceRequest 
    }): Promise<MaintenanceUpdateResponse> => {
      const response = await fetch('/api/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ van_id, hgv_id, ...data }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create maintenance record');
      }

      return response.json();
    },
    onSuccess: () => {
      // Invalidate maintenance list to refetch with new data
      queryClient.invalidateQueries({ queryKey: ['maintenance'] });
      
      toast.success('Maintenance record created', {
        description: 'The vehicle maintenance record has been created.',
      });
    },
    onError: (error: Error) => {
      logger.error('Failed to create maintenance record', error, 'useMaintenance');
      toast.error('Failed to create maintenance record', {
        description: error.message,
        duration: 5000,
      });
    },
  });
}

// ============================================================================
// Mutation: Update maintenance record
// ============================================================================

export function useUpdateMaintenance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      id, 
      updates 
    }: { 
      id: string; 
      updates: UpdateMaintenanceRequest 
    }): Promise<MaintenanceUpdateResponse> => {
      const response = await fetch(`/api/maintenance/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update maintenance');
      }

      return response.json();
    },
    onSuccess: () => {
      // Invalidate maintenance list to refetch with new data
      queryClient.invalidateQueries({ queryKey: ['maintenance'] });
      // Invalidate maintenance history to show the update in history modal
      queryClient.invalidateQueries({ queryKey: ['maintenance', 'history'] });
      
      toast.success('Maintenance updated successfully', {
        description: 'The vehicle maintenance record has been updated.',
      });
    },
    onError: (error: Error) => {
      logger.error('Failed to update maintenance', error, 'useMaintenance');
      toast.error('Failed to update maintenance', {
        description: error.message,
        duration: 5000,
      });
    },
  });
}

// ============================================================================
// Mutation: Create maintenance category (Admin/Manager only)
// ============================================================================

export function useCreateCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (category: CreateCategoryRequest) => {
      const response = await fetch('/api/maintenance/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(category),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create category');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance', 'categories'] });
      queryClient.invalidateQueries({ queryKey: ['maintenance'] });
      toast.success('Category created successfully');
    },
    onError: (error: Error) => {
      logger.error('Failed to create category', error, 'useMaintenance');
      toast.error('Failed to create category', {
        description: error.message,
      });
    },
  });
}

// ============================================================================
// Mutation: Update maintenance category (Admin/Manager only)
// ============================================================================

export function useUpdateCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      id, 
      updates 
    }: { 
      id: string; 
      updates: UpdateCategoryRequest 
    }) => {
      const response = await fetch(`/api/maintenance/categories/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update category');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance', 'categories'] });
      queryClient.invalidateQueries({ queryKey: ['maintenance'] }); // Refetch main list with new thresholds
      toast.success('Category updated successfully');
    },
    onError: (error: Error) => {
      logger.error('Failed to update category', error, 'useMaintenance');
      toast.error('Failed to update category', {
        description: error.message,
      });
    },
  });
}

// ============================================================================
// Mutation: Delete maintenance category (Admin/Manager only)
// ============================================================================

export function useDeleteCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/maintenance/categories/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete category');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance', 'categories'] });
      queryClient.invalidateQueries({ queryKey: ['maintenance'] });
      toast.success('Category deleted successfully');
    },
    onError: (error: Error) => {
      logger.error('Failed to delete category', error, 'useMaintenance');
      toast.error('Failed to delete category', {
        description: error.message,
        duration: 5000,
      });
    },
  });
}

// ============================================================================
// Query: Get deleted (archived) vehicles
// ============================================================================

export function useDeletedVehicles() {
  return useQuery({
    queryKey: ['maintenance', 'deleted'],
    queryFn: async (): Promise<DeletedVehiclesListResponse> => {
      const response = await fetch('/api/maintenance/deleted');
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch deleted vehicles');
      }
      
      return response.json();
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
}

// ============================================================================
// Mutation: Permanently delete an archived vehicle (Admin/Manager only)
// ============================================================================

export function usePermanentlyDeleteArchivedVehicle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (archiveId: string) => {
      const response = await fetch(`/api/maintenance/deleted/${archiveId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to permanently delete archived vehicle');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance', 'deleted'] });
      toast.success('Archived vehicle permanently removed', {
        description: 'The vehicle record has been permanently deleted from the archive.',
      });
    },
    onError: (error: Error) => {
      logger.error('Failed to permanently delete archived vehicle', error, 'useMaintenance');
      toast.error('Failed to permanently delete vehicle', {
        description: error.message,
        duration: 5000,
      });
    },
  });
}

// ============================================================================
// Mutation: Restore an archived vehicle back to active (Admin/Manager only)
// ============================================================================

export function useRestoreArchivedVehicle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (archiveId: string) => {
      const response = await fetch(`/api/maintenance/deleted/${archiveId}/restore`, {
        method: 'PUT',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to restore archived vehicle');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance', 'deleted'] });
      queryClient.invalidateQueries({ queryKey: ['maintenance'] });
      toast.success('Vehicle restored successfully', {
        description: 'The vehicle has been moved back to active vehicles.',
      });
    },
    onError: (error: Error) => {
      logger.error('Failed to restore archived vehicle', error, 'useMaintenance');
      toast.error('Failed to restore vehicle', {
        description: error.message,
        duration: 5000,
      });
    },
  });
}
