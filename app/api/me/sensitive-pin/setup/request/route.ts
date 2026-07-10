import { NextRequest, NextResponse } from 'next/server';
import { setupSensitivePinWithoutEmailVerification } from '@/lib/server/sensitive-pin';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { pin?: string } | null;
    const result = await setupSensitivePinWithoutEmailVerification({
      pin: typeof body?.pin === 'string' ? body.pin : '',
    });

    return NextResponse.json({
      success: true,
      requiresVerification: false,
      eventType: result.eventType,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to set sensitive PIN';
    return NextResponse.json(
      { error: message },
      { status: message === 'Unauthorized' ? 401 : 400 }
    );
  }
}
