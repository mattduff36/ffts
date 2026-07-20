export function isStaleDeploymentVersion(input: {
  clientDeploymentId?: string;
  clientReleaseVersion?: string;
  serverDeploymentId?: string;
  serverReleaseVersion?: string;
}): boolean {
  const deploymentChanged =
    Boolean(input.clientDeploymentId) &&
    Boolean(input.serverDeploymentId) &&
    input.serverDeploymentId !== 'local' &&
    input.serverDeploymentId !== input.clientDeploymentId;
  const releaseChanged =
    Boolean(input.clientReleaseVersion) &&
    Boolean(input.serverReleaseVersion) &&
    input.serverReleaseVersion !== input.clientReleaseVersion;

  return deploymentChanged || releaseChanged;
}

