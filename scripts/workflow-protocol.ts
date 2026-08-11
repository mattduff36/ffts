#!/usr/bin/env tsx
import {
  WORKFLOW_ROUTING_REQUIRED_EXIT_CODE,
  applyProtocolTransition,
  type WorkflowProtocolCommand,
} from './automation/workflow-review-protocol';

function printUsage(): void {
  process.stdout.write(`Usage:
  npx tsx scripts/workflow-protocol.ts <command> [options]

Commands:
  init --workstream <id> [--plan <path>] [--base-commit <sha>]
  preflight-record --workstream <id> --manifest <path>
  review-start --workstream <id> --pass first|closure
  review-record --workstream <id> --token <token> --result passed|failed \\
    [--blocker-families a,b] [--blocker-ids a,b] [--sibling-surfaces a,b]
  fix-record --workstream <id> --manifest <path> [--closed-blocker-ids a,b]
  split --workstream <id> --new-workstream <id> [--narrower-partition] [--has-fix-delta]
  finalise-start --workstream <id>
  status --workstream <id>

Exit codes:
  0 success
  2 routing_required
  1 other failure
`);
}

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function splitCsv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] as WorkflowProtocolCommand | undefined;
  if (!command || command === ('help' as WorkflowProtocolCommand) || args.includes('--help')) {
    printUsage();
    process.exit(command ? 0 : 1);
  }

  const repoRoot = readFlag(args, '--repo-root') ?? process.cwd();
  const result = applyProtocolTransition({
    repoRoot,
    command,
    workstreamId: readFlag(args, '--workstream'),
    planPath: readFlag(args, '--plan'),
    baseCommit: readFlag(args, '--base-commit'),
    manifestPath: readFlag(args, '--manifest'),
    pass: readFlag(args, '--pass') as 'first' | 'closure' | undefined,
    token: readFlag(args, '--token'),
    result: readFlag(args, '--result') as 'passed' | 'failed' | undefined,
    blockerFamilies: splitCsv(readFlag(args, '--blocker-families')),
    blockerIds: splitCsv(readFlag(args, '--blocker-ids')),
    siblingSurfaces: splitCsv(readFlag(args, '--sibling-surfaces')),
    closedBlockerIds: splitCsv(readFlag(args, '--closed-blocker-ids')),
    newWorkstreamId: readFlag(args, '--new-workstream'),
    narrowerPartition: hasFlag(args, '--narrower-partition'),
    hasFixDelta: hasFlag(args, '--has-fix-delta'),
    sourceWorkstreamIds: splitCsv(readFlag(args, '--source-workstreams')),
  });

  const payload = {
    ok: result.ok,
    exitCode: result.exitCode,
    message: result.message,
    reviewToken: result.reviewToken,
    checkpointId: result.checkpointId,
    splitWorkstreamId: result.splitWorkstreamId,
    record: result.record
      ? {
          workstreamId: result.record.workstreamId,
          phase: result.record.phase,
          nextAction: result.record.nextAction,
          failedPremiumReviewCount: result.record.failedPremiumReviewCount,
          evidenceManifestPath: result.record.evidenceManifestPath,
          fixDeltaManifestPath: result.record.fixDeltaManifestPath,
          activeCheckpointId: result.record.activeCheckpointId,
          blockerFamilies: result.record.blockerFamilies,
          openBlockerIds: result.record.openBlockerIds,
        }
      : null,
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(result.exitCode === WORKFLOW_ROUTING_REQUIRED_EXIT_CODE ? 2 : result.ok ? 0 : 1);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
