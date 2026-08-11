#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'workflow-review.ts');
const tsxCli = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

function writeHookJson(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function main() {
  const raw = await readStdin();
  let input;
  try {
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch (error) {
    process.stderr.write(`workflow-stop: invalid JSON stdin: ${error instanceof Error ? error.message : String(error)}\n`);
    writeHookJson({});
    return;
  }

  if (typeof input.loop_count === 'number' && input.loop_count > 0) {
    writeHookJson({});
    return;
  }

  if (input.status && input.status !== 'completed') {
    writeHookJson({});
    return;
  }

  if (!existsSync(scriptPath) || !existsSync(tsxCli)) {
    process.stderr.write('workflow-stop: workflow-review tooling unavailable\n');
    writeHookJson({});
    return;
  }

  const result = spawnSync(
    process.execPath,
    [tsxCli, scriptPath, 'stop', '--repo-root', repoRoot],
    {
      cwd: repoRoot,
      env: process.env,
      input: JSON.stringify(input),
      encoding: 'utf8',
      shell: false,
      timeout: 25_000,
      maxBuffer: 5 * 1024 * 1024,
    }
  );

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.status !== 0) {
    process.stderr.write(`workflow-stop: processor exited with ${result.status}\n`);
    writeHookJson({});
    return;
  }

  const stdout = (result.stdout || '').trim();
  if (!stdout) {
    writeHookJson({});
    return;
  }

  try {
    const payload = JSON.parse(stdout);
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      writeHookJson(payload);
      return;
    }
  } catch (error) {
    process.stderr.write(`workflow-stop: invalid processor JSON: ${error instanceof Error ? error.message : String(error)}\n`);
  }

  writeHookJson({});
}

main().catch((error) => {
  process.stderr.write(`workflow-stop: ${error instanceof Error ? error.message : String(error)}\n`);
  writeHookJson({});
});
