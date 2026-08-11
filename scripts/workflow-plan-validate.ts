#!/usr/bin/env tsx
import path from 'path';
import { fileURLToPath } from 'url';
import { validatePlanFile } from './automation/workflow-plan-contract';

export interface WorkflowPlanValidatePayload {
  ok: boolean;
  status: 'present' | 'missing' | 'malformed';
  path: string;
  pathRef: string | null;
  pathSource: string;
  errors: string[];
  workstreamId: string | null;
  taskId: string | null;
  registryVersion: string | null;
}

export interface WorkflowPlanValidateRunResult {
  exitCode: 0 | 1 | 2;
  payload: WorkflowPlanValidatePayload;
  text: string;
}

const USAGE = 'Usage: npm run workflow-plan:validate -- <plan-path> [--json]';

export function runWorkflowPlanValidate(
  argv: string[],
  cwd = process.cwd()
): WorkflowPlanValidateRunResult {
  const jsonMode = argv.includes('--json');
  const positional = argv.filter((arg) => arg !== '--json');
  if (positional.length !== 1) {
    const payload: WorkflowPlanValidatePayload = {
      ok: false,
      status: 'malformed',
      path: positional[0] ?? '',
      pathRef: null,
      pathSource: 'unavailable',
      errors: [USAGE],
      workstreamId: null,
      taskId: null,
      registryVersion: null,
    };
    return {
      exitCode: 2,
      payload,
      text: jsonMode ? JSON.stringify(payload, null, 2) : USAGE,
    };
  }

  const candidatePath = positional[0]!;
  const repoRoot = cwd;
  const result = validatePlanFile({
    candidatePath,
    repoRoot,
    approvedRoots: [
      repoRoot,
      path.join(repoRoot, 'docs_private', 'automation', 'plans'),
      path.join(repoRoot, '.cursor', 'plans'),
    ],
  });

  const payload: WorkflowPlanValidatePayload = {
    ok: result.status === 'present' && result.errors.length === 0,
    status: result.status,
    path: candidatePath,
    pathRef: result.pathResolution.pathRef,
    pathSource: result.pathResolution.source,
    errors: result.errors,
    workstreamId: result.contract?.workstreamId ?? null,
    taskId: result.contract?.taskId ?? null,
    registryVersion: result.contract?.registryVersion ?? null,
  };

  const text = jsonMode
    ? JSON.stringify(payload, null, 2)
    : payload.ok
      ? `OK plan contract for ${payload.taskId} (workstream ${payload.workstreamId}, registry ${payload.registryVersion})`
      : [
          `INVALID plan contract (${payload.status})`,
          ...payload.errors.map((error) => `- ${error}`),
        ].join('\n');
  return { exitCode: payload.ok ? 0 : 1, payload, text };
}

const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedFile && fileURLToPath(import.meta.url) === invokedFile) {
  const result = runWorkflowPlanValidate(process.argv.slice(2));
  const stream = result.exitCode === 0 || process.argv.includes('--json')
    ? process.stdout
    : process.stderr;
  stream.write(`${result.text}\n`);
  process.exitCode = result.exitCode;
}
