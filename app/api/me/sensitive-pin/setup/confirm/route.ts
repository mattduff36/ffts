import { NextRequest, NextResponse } from 'next/server';
import { confirmSensitivePinVerification } from '@/lib/server/sensitive-pin';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { code?: string } | null;
    const result = await confirmSensitivePinVerification({
      code: typeof body?.code === 'string' ? body.code : '',
      purpose: 'setup',
    });

    return NextResponse.json({ success: true, eventType: result.eventType });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to confirm PIN setup';
    return NextResponse.json(
      { error: message },
      { status: message === 'Unauthorized' ? 401 : 400 }
    );
  }
}
