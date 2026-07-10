import { NextResponse } from 'next/server';
import {
  isVanInspectionsMaintenancePaused,
  VAN_INSPECTIONS_MAINTENANCE_MESSAGE,
} from '@/lib/config/van-inspections-maintenance';

export function getVanInspectionsMaintenanceResponse(): NextResponse | null {
  if (!isVanInspectionsMaintenancePaused()) {
    return null;
  }

  return NextResponse.json(
    {
      error: VAN_INSPECTIONS_MAINTENANCE_MESSAGE,
      code: 'van_inspections_paused',
    },
    { status: 423 }
  );
}
