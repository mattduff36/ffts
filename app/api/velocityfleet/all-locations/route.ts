import { NextResponse } from 'next/server';
import {
  getVelocityfleetLocations,
  isVelocityfleetError,
} from '@/lib/services/velocityfleet';
import { enrichTrackerLocationsWithVanNicknames } from '@/lib/server/fleet-tracker-enrichment';

export async function GET() {
  if (!process.env.VELOCITYFLEET_API_KEY) {
    return NextResponse.json(
      { error: 'missing_credentials', message: 'Velocityfleet API token not configured' },
      { status: 500 }
    );
  }

  try {
    const vehicles = await enrichTrackerLocationsWithVanNicknames(await getVelocityfleetLocations());

    return NextResponse.json({
      vehicles,
      count: vehicles.length,
      cached: true,
    });
  } catch (error) {
    if (isVelocityfleetError(error) && error.velocityfleet) {
      return NextResponse.json(
        { error: error.velocityfleet.code, message: error.velocityfleet.message },
        { status: error.velocityfleet.status }
      );
    }

    console.error('[Velocityfleet API] Failed to fetch all locations');
    return NextResponse.json(
      { error: 'server_error', message: 'Failed to fetch Velocityfleet data' },
      { status: 500 }
    );
  }
}
