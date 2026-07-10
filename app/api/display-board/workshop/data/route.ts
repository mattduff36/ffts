import { NextRequest, NextResponse } from 'next/server';
import {
  DISPLAY_BOARD_TOKEN_HEADER,
  WORKSHOP_DISPLAY_BOARD_KEY,
  buildDisplayBoardPayload,
} from '@/lib/server/display-board';

export async function GET(request: NextRequest) {
  try {
    const deviceToken = request.headers.get(DISPLAY_BOARD_TOKEN_HEADER)
      || request.nextUrl.searchParams.get('device_token')
      || null;
    const payload = await buildDisplayBoardPayload(deviceToken, WORKSHOP_DISPLAY_BOARD_KEY);

    if (!payload) {
      return NextResponse.json(
        { status: 'unauthorised', error: 'This display board is not authorised.' },
        { status: 401 }
      );
    }

    return NextResponse.json({ status: 'ok', payload });
  } catch (error) {
    return NextResponse.json(
      { status: 'error', error: error instanceof Error ? error.message : 'Unable to load display board data' },
      { status: 500 }
    );
  }
}
