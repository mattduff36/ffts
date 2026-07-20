import { describe, expect, it } from 'vitest';
import { isStaleDeploymentVersion } from '@/lib/client/deployment-version';

describe('deployment version staleness', () => {
  it('refreshes when the release changes even if the deployment ID is unchanged', () => {
    expect(isStaleDeploymentVersion({
      clientDeploymentId: 'deployment-a',
      serverDeploymentId: 'deployment-a',
      clientReleaseVersion: '0726.3.0',
      serverReleaseVersion: '0726.4.0',
    })).toBe(true);
  });

  it('refreshes when the deployment changes even if the release is unchanged', () => {
    expect(isStaleDeploymentVersion({
      clientDeploymentId: 'deployment-a',
      serverDeploymentId: 'deployment-b',
      clientReleaseVersion: '0726.4.0',
      serverReleaseVersion: '0726.4.0',
    })).toBe(true);
  });

  it('keeps the current client when both identifiers match', () => {
    expect(isStaleDeploymentVersion({
      clientDeploymentId: 'deployment-a',
      serverDeploymentId: 'deployment-a',
      clientReleaseVersion: '0726.4.0',
      serverReleaseVersion: '0726.4.0',
    })).toBe(false);
  });

  it('does not treat a local server deployment ID as stale', () => {
    expect(isStaleDeploymentVersion({
      clientDeploymentId: 'deployment-a',
      serverDeploymentId: 'local',
      clientReleaseVersion: '0726.4.0',
      serverReleaseVersion: '0726.4.0',
    })).toBe(false);
  });
});

