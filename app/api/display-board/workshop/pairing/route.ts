import { NextRequest, NextResponse } from 'next/server';
import {
  WORKSHOP_DISPLAY_BOARD_KEY,
  checkDisplayBoardPairing,
  createDisplayBoardPairingCandidate,
} from '@/lib/server/display-board';

export async function GET(request: NextRequest) {
  try {
    const pairingToken = request.nextUrl.searchParams.get('pairing_token') || '';
    const result = await checkDisplayBoardPairing(pairingToken, WORKSHOP_DISPLAY_BOARD_KEY);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { status: 'unavailable', error: error instanceof Error ? error.message : 'Unable to check pairing status' },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const result = await createDisplayBoardPairingCandidate(WORKSHOP_DISPLAY_BOARD_KEY);
    const status = result.status === 'unavailable' ? 403 : 200;
    return NextResponse.json(result, { status });
  } catch (error) {
    return NextResponse.json(
      { status: 'unavailable', error: error instanceof Error ? error.message : 'Unable to create pairing candidate' },
      { status: 500 }
    );
  }
}
