import releaseVersionState from '@/lib/config/release-version.json';
import { formatReleaseVersion } from '@/lib/config/release-version-logic';
import type { ReleaseVersionState } from '@/lib/config/release-version-logic';

export function getReleaseVersionState(): ReleaseVersionState {
  return releaseVersionState as ReleaseVersionState;
}

export function getPublicReleaseVersionLabel(): string {
  const bakedVersion = process.env.NEXT_PUBLIC_APP_RELEASE_VERSION?.trim();
  if (bakedVersion) {
    return `Version ${bakedVersion}`;
  }

  if (process.env.NODE_ENV === 'development') {
    const localVersion = formatReleaseVersion(getReleaseVersionState());
    return `Version ${localVersion}`;
  }

  return 'Version local';
}
