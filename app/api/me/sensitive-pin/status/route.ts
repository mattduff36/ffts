import { NextResponse } from 'next/server';
import { getCurrentSensitivePinStatus } from '@/lib/server/sensitive-pin';

export async function GET() {
  try {
    const status = await getCurrentSensitivePinStatus();
    return NextResponse.json({ success: true, status });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load sensitive PIN status';
    return NextResponse.json(
      { error: message },
      { status: message === 'Unauthorized' ? 401 : 500 }
    );
  }
}
