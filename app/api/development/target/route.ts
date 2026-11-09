import { NextResponse } from 'next/server';
import { getDevelopmentTargetAvailabilityReason, requireDevelopmentTarget } from '@/lib/utils/development-target';

export const dynamic = 'force-dynamic';

export async function GET() {
  const headers = { 'Cache-Control': 'no-store' };
  if (getDevelopmentTargetAvailabilityReason(process.env)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers });
  }
  const target = requireDevelopmentTarget(process.env);
  return NextResponse.json(target, { headers });
}
