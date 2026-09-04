#!/usr/bin/env tsx
/**
 * Long-term visual diagnostic for the shared TEE live terminal dashboard.
 *
 * Run from the repo root in a Cursor integrated Terminal:
 *   npx tsx scripts/automation/tee-live-progress-demo.ts
 *   npx tsx scripts/automation/tee-live-progress-demo.ts --fail
 *
 * Exercises one live frame, nested stage bars, captured child output, and
 * terminal restore. Presentation only: it does not run finalise, preflight,
 * or the full suite, and it does not change review or release authority.
 */
import { createHumanVerifyProgress } from './workflow-verify-batch';
import { runCapturedProcess } from './workflow-verify-runner';

const FAIL = process.argv.includes('--fail');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function main(): Promise<void> {
  const progress = createHumanVerifyProgress({
    title: 'TEE live dashboard demo',
    candidate: 'demo',
  });
  if (!progress) {
    process.stderr.write('live dashboard demo refused: progress is off\n');
    process.exit(2);
  }

  progress.setStages([
    { id: 'batch', label: 'Verification batch', status: 'waiting', weight: 0, elapsedMs: 0 },
    {
      id: 'typecheck',
      label: 'Typecheck',
      status: 'waiting',
      weight: 22,
      elapsedMs: 0,
      parentId: 'batch',
      measure: 'opaque',
    },
    {
      id: 'tests',
      label: 'Workflow tests',
      status: 'waiting',
      weight: 36,
      elapsedMs: 0,
      parentId: 'batch',
      measure: 'tests',
    },
    { id: 'summary', label: 'Summary', status: 'waiting', weight: 8, elapsedMs: 0, measure: 'opaque' },
  ]);

  const typecheckStarted = Date.now();
  progress.updateStage('typecheck', { status: 'running' });
  await sleep(400);
  progress.updateStage('typecheck', { status: 'pass', elapsedMs: Date.now() - typecheckStarted });

  const testsStarted = Date.now();
  progress.updateStage('tests', {
    status: 'running',
    measure: 'tests',
    completed: 0,
    total: 2,
    current: 'demo child',
  });
  const pulse = setInterval(() => {
    progress.updateStage('tests', {
      status: 'running',
      measure: 'tests',
      completed: 0,
      total: 2,
      current: 'demo child',
      elapsedMs: Date.now() - testsStarted,
    });
  }, 250);

  let captured;
  try {
    captured = FAIL
      ? await runCapturedProcess({
          command: process.execPath,
          args: ['-e', "process.stderr.write('intentional demo failure\\n'); process.exit(1);"],
          cwd: process.cwd(),
        })
      : await runCapturedProcess({
          command: 'npx',
          args: [
            'vitest',
            'run',
            'tests/ui/components/scheduling-control-styles.test.tsx',
            '--reporter=dot',
          ],
          cwd: process.cwd(),
        });
  } finally {
    clearInterval(pulse);
  }

  progress.updateStage('tests', {
    status: captured.exitCode === 0 ? 'pass' : 'fail',
    measure: 'tests',
    completed: captured.exitCode === 0 ? 2 : 1,
    total: 2,
    elapsedMs: Date.now() - testsStarted,
    current: captured.exitCode === 0 ? undefined : 'demo child',
    failures: captured.exitCode === 0 ? undefined : ['intentional demo failure'],
  });

  if (captured.exitCode !== 0) {
    progress.updateStage('summary', { status: 'fail' });
    progress.complete('FAIL', 'TEE live dashboard demo');
    const diagnostic = [captured.stderr, captured.stdout]
      .filter((chunk) => chunk.trim().length > 0)
      .join('\n')
      .trim();
    if (diagnostic) {
      process.stderr.write(`${diagnostic}\n`);
    }
    process.exit(1);
  }

  progress.updateStage('summary', { status: 'pass' });
  progress.complete('PASS', 'TEE live dashboard demo');
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
