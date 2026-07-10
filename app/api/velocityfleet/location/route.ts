import { NextRequest, NextResponse } from 'next/server';
import {
  getVelocityfleetLocationByRegistration,
  isVelocityfleetError,
} from '@/lib/services/velocityfleet';
import { enrichTrackerLocationWithVanNickname } from '@/lib/server/fleet-tracker-enrichment';

export async function GET(request: NextRequest) {
  if (!process.env.VELOCITYFLEET_API_KEY) {
    return NextResponse.json(
      { error: 'missing_credentials', message: 'Velocityfleet API token not configured' },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const regNumber = searchParams.get('regNumber') ?? undefined;

  if (!regNumber) {
    return NextResponse.json(
      { error: 'bad_request', message: 'Provide regNumber query param' },
      { status: 400 }
    );
  }

  try {
    const location = await getVelocityfleetLocationByRegistration(regNumber);

    if (!location) {
      return NextResponse.json({ error: 'not_found', message: 'Asset not found in Velocityfleet' });
    }

    return NextResponse.json(await enrichTrackerLocationWithVanNickname(location));
  } catch (error) {
    if (isVelocityfleetError(error) && error.velocityfleet) {
      return NextResponse.json(
        { error: error.velocityfleet.code, message: error.velocityfleet.message },
        { status: error.velocityfleet.status }
      );
    }

    console.error('[Velocityfleet API] Failed to fetch location');
    return NextResponse.json(
      { error: 'server_error', message: 'Failed to fetch Velocityfleet data' },
      { status: 500 }
    );
  }
}
