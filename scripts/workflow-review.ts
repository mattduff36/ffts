import { readFileSync } from 'fs';
import {
  formatWorkflowReviewDiagnostics,
  processWorkflowStopEvent,
  type WorkflowStopHookInput,
} from './automation/workflow-review';

interface CliOptions {
  mode: 'stop' | 'diagnostics' | 'process-json';
  inputPath?: string;
  repoRoot?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const modeArg = argv.find((arg) => !arg.startsWith('--')) ?? 'diagnostics';
  const mode =
    modeArg === 'stop' || modeArg === 'process-json' || modeArg === 'diagnostics'
      ? modeArg
      : 'diagnostics';

  let inputPath: string | undefined;
  let repoRoot: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') {
      inputPath = argv[index + 1];
      index += 1;
    }
    if (arg === '--repo-root') {
      repoRoot = argv[index + 1];
      index += 1;
    }
  }

  return { mode, inputPath, repoRoot };
}

async function readStopInput(inputPath?: string): Promise<WorkflowStopHookInput> {
  if (inputPath) {
    return JSON.parse(readFileSync(inputPath, 'utf8')) as WorkflowStopHookInput;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw) as WorkflowStopHookInput;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.mode === 'diagnostics') {
    process.stdout.write(`${formatWorkflowReviewDiagnostics(options.repoRoot)}\n`);
    return;
  }

  const input = await readStopInput(options.inputPath);
  const result = await processWorkflowStopEvent(input, { repoRoot: options.repoRoot });

  // For the stop hook, emit only hook-compatible JSON on stdout.
  if (options.mode === 'stop') {
    const payload = result.followup_message ? { followup_message: result.followup_message } : {};
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    if (result.reason) {
      process.stderr.write(`workflow-review: ${result.reason}\n`);
    }
    return;
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  // Fail open for stop-hook mode: empty JSON lets the agent continue.
  if (process.argv.includes('stop')) {
    process.stdout.write('{}\n');
    process.exit(0);
    return;
  }
  process.exit(1);
});
