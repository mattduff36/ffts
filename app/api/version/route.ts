import { NextResponse } from 'next/server';
import releaseVersionState from '@/lib/config/release-version.json';
import { formatReleaseVersion } from '@/lib/config/release-version-logic';

export const dynamic = 'force-dynamic';

/**
 * GET /api/version
 * Returns the deployment ID of the currently running server.
 * Used by DeploymentVersionChecker to detect stale client bundles.
 */
export async function GET() {
  return NextResponse.json({
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID || 'local',
    releaseVersion: formatReleaseVersion(releaseVersionState),
  });
}
