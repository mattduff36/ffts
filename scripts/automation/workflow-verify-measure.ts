import { captureVerificationIdentity } from './workflow-verification-ledger';
import { runEvidenceVerificationBatch } from './workflow-verify-batch';
import { resolveTeeVerifyJobs } from './workflow-verify-runner';

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const jobs = resolveTeeVerifyJobs(process.env.TEE_VERIFY_JOBS);
  const identity = captureVerificationIdentity(repoRoot);
  if (!identity.ok) {
    process.stderr.write(`${identity.message}\n`);
    process.exit(1);
  }
  const started = Date.now();
  const executed = await runEvidenceVerificationBatch({
    repoRoot,
    workstreamId: 'ws_measure_verify',
    baseCommit: identity.headCommit,
    runChecks: true,
    runRequiredTests: false,
    jobs,
    candidate: {
      headCommit: identity.headCommit,
      fingerprint: identity.productTreeFingerprint,
    },
  });
  const wallMs = Date.now() - started;
  const stages = executed.batch.results.map((row) => ({
    id: row.id,
    status: row.status,
    durationMs: row.durationMs,
  }));
  const serialEquivalentMs = stages.reduce((sum, row) => sum + row.durationMs, 0);
  process.stdout.write(
    `${JSON.stringify(
      {
        jobs: executed.batch.jobs,
        serial: executed.batch.serial,
        ok: executed.batch.ok,
        wallMs,
        serialEquivalentMs,
        improvementPercent:
          serialEquivalentMs > 0
            ? Math.round((1 - wallMs / serialEquivalentMs) * 1000) / 10
            : 0,
        stages,
      },
      null,
      2
    )}\n`
  );
  process.exit(executed.batch.ok ? 0 : 1);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
