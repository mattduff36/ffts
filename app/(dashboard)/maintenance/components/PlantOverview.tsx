'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PanelLoader } from '@/components/ui/panel-loader';
import { MaintenanceOverview } from './MaintenanceOverview';
import { getDateBasedStatus, calculateAlertCounts } from '@/lib/utils/maintenanceCalculations';
import type { MaintenanceItemStatus, VehicleMaintenanceWithStatus } from '@/types/maintenance';

interface PlantOverviewProps {
  onVehicleClick?: (vehicle: VehicleMaintenanceWithStatus) => void;
}

type PlantAsset = {
  id: string;
  plant_id: string;
  nickname: string | null;
  make: string | null;
  model: string | null;
  current_hours: number | null;
  loler_due_date: string | null;
  status: string;
};

type PlantMaintenanceWithStatus = {
  van_id: string;
  plant_id: string; // Human-readable identifier (P001, P002, etc.)
  is_plant?: boolean; // Flag to indicate this is plant machinery, not a vehicle
  vehicle?: PlantAsset;
  current_hours: number | null;
  next_service_hours: number | null;
  loler_due_date?: string | null; // LOLER due date for office actions
  loler_status?: MaintenanceItemStatus; // LOLER status for plant machinery
  // Plant assets don't have these statuses, but MaintenanceOverview expects them
  tax_status?: null;
  mot_status?: null;
  service_status?: null;
  cambelt_status?: null;
  first_aid_status?: null;
  overdue_count: number;
  due_soon_count: number;
};

export function PlantOverview({ onVehicleClick }: PlantOverviewProps) {
  // ✅ Create supabase client using useMemo to avoid recreating on every render
  const supabase = useMemo(() => createClient(), []);
  const [plantAssets, setPlantAssets] = useState<PlantMaintenanceWithStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPlantAssets = useCallback(async () => {
    try {
      setLoading(true);
      
      // Fetch plant assets with maintenance data
      const { data: plantData, error: plantError } = await supabase
        .from('plant')
        .select(`
          *,
          van_categories (
            id,
            name
          )
        `)
        .eq('status', 'active')
        .order('plant_id');

      if (plantError) throw plantError;

      // Fetch maintenance records for plant
      const { data: maintenanceData, error: maintenanceError } = await supabase
        .from('vehicle_maintenance')
        .select('*')
        .not('plant_id', 'is', null);

      if (maintenanceError) throw maintenanceError;

      // Combine plant data with maintenance data and calculate status
      const combined: PlantMaintenanceWithStatus[] = (plantData || []).map((plant: { id: string; plant_id: string; loler_due_date: string | null; current_hours: number | null }) => {
        const maintenance = maintenanceData?.find((m: { plant_id: string | null }) => m.plant_id === plant.id);
        
        // Calculate LOLER status (30 day threshold)
        const loler_status = getDateBasedStatus(plant.loler_due_date, 30);
        
        // Calculate alert counts based on LOLER status
        const alertCounts = calculateAlertCounts([loler_status]);
        
        return {
          van_id: plant.id,
          plant_id: plant.plant_id, // Human-readable identifier (P001, P002, etc.)
          is_plant: true, // Flag to indicate this is plant, not vehicle
          vehicle: {
            ...plant,
            id: plant.id
          } as PlantAsset,
          current_hours: maintenance?.current_hours || plant.current_hours || null,
          next_service_hours: maintenance?.next_service_hours || null,
          loler_due_date: plant.loler_due_date, // Add LOLER due date for office actions
          loler_status, // Add LOLER status so MaintenanceOverview can detect it
          // Set other status fields to null for plant assets (they don't have these)
          tax_status: null,
          mot_status: null,
          service_status: null,
          cambelt_status: null,
          first_aid_status: null,
          overdue_count: alertCounts.overdue,
          due_soon_count: alertCounts.due_soon,
        };
      });

      setPlantAssets(combined);
    } catch (error) {
      console.error('Error fetching plant assets:', error);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchPlantAssets();
  }, [fetchPlantAssets]);

  if (loading) {
    return <PanelLoader message="Loading plant maintenance..." accent="maintenance" className="py-12" />;
  }

  const summary = {
    total: plantAssets.length,
    overdue: plantAssets.filter(v => v.overdue_count > 0).length,
    due_soon: plantAssets.filter(v => v.due_soon_count > 0 && v.overdue_count === 0).length,
  };

  return (
    <MaintenanceOverview
      vehicles={plantAssets as unknown as VehicleMaintenanceWithStatus[]}
      summary={summary}
      onVehicleClick={onVehicleClick}
    />
  );
}
