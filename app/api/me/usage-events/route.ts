import { NextRequest, NextResponse } from 'next/server';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { insertClientUsageEvents } from '@/lib/server/user-analytics';
import { logServerError } from '@/lib/utils/server-error-logger';
import { USER_ANALYTICS_PRD_EPIC_ID } from '@/lib/analytics/events';

function originMatchesRequest(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;

  try {
    const originUrl = new URL(origin);
    const host = request.headers.get('host');
    const requestOrigins = new Set([
      request.nextUrl.origin,
      host ? `${request.nextUrl.protocol}//${host}` : null,
    ].filter((value): value is string => Boolean(value)));

    if (requestOrigins.has(originUrl.origin)) {
      return true;
    }

    const isLoopbackHost = ['localhost', '127.0.0.1'].includes(originUrl.hostname);
    if (!isLoopbackHost) {
      return false;
    }

    return Array.from(requestOrigins).some((candidate) => {
      const candidateUrl = new URL(candidate);
      return ['localhost', '127.0.0.1'].includes(candidateUrl.hostname) && candidateUrl.port === originUrl.port;
    });
  } catch {
    return false;
  }
}

function isTransientUsageAnalyticsError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();

  return (
    lowerMessage.includes('502 bad gateway') ||
    (lowerMessage.includes('cloudflare') && lowerMessage.includes('<html'))
  );
}

export async function POST(request: NextRequest) {
  try {
    if (!originMatchesRequest(request)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const current = await getCurrentAuthenticatedProfile();
    if (!current) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await request.json().catch(() => ({}));
    const inserted = await insertClientUsageEvents({
      request,
      current,
      payload,
    });

    if (inserted === 0) {
      return NextResponse.json({ error: 'No valid usage events supplied' }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      inserted,
      prd_epic_id: USER_ANALYTICS_PRD_EPIC_ID,
    });
  } catch (error) {
    if (isTransientUsageAnalyticsError(error)) {
      return NextResponse.json(
        {
          success: false,
          inserted: 0,
          transient: true,
          error: 'Usage analytics temporarily unavailable',
        },
        { status: 202 }
      );
    }

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/me/usage-events',
      additionalData: {
        endpoint: '/api/me/usage-events',
        method: 'POST',
      },
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to record usage analytics' },
      { status: 500 }
    );
  }
}
