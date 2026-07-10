/**
 * Logged audit wrapper for frequently used codebase checks.
 *
 * Usage:
 *   npm run audit:quick
 *   npm run audit:medium
 *   npm run audit:all
 */

import { spawn, type ChildProcess } from 'child_process';
import { config } from 'dotenv';
import path from 'path';
import { AutomationRun } from './automation/logger';

config({ path: path.resolve(process.cwd(), '.env.local') });

type AuditMode = 'quick' | 'medium' | 'full';

interface AuditStep {
  label: string;
  command: string;
  args: string[];
  requiresProductionServer?: boolean;
}

interface ManagedServer {
  child: ChildProcess;
  output: string[];
}

const PRODUCTION_AUDIT_PORT = '4000';
const PRODUCTION_AUDIT_URL = `http://127.0.0.1:${PRODUCTION_AUDIT_PORT}/login`;

const AUDIT_STEPS: Record<AuditMode, AuditStep[]> = {
  quick: [
    { label: 'ESLint', command: 'npm', args: ['run', 'lint'] },
    { label: 'Oxlint', command: 'npm', args: ['run', 'lint:fast'] },
    { label: 'Dependency check', command: 'npm', args: ['run', 'deps:check'] },
  ],
  medium: [
    { label: 'ESLint', command: 'npm', args: ['run', 'lint'] },
    { label: 'Oxlint', command: 'npm', args: ['run', 'lint:fast'] },
    { label: 'Dependency check', command: 'npm', args: ['run', 'deps:check'] },
    { label: 'Production build', command: 'npm', args: ['run', 'build'] },
  ],
  full: [
    { label: 'ESLint', command: 'npm', args: ['run', 'lint'] },
    { label: 'Oxlint', command: 'npm', args: ['run', 'lint:fast'] },
    { label: 'Dependency check', command: 'npm', args: ['run', 'deps:check'] },
    { label: 'Bundle-analyzed build', command: 'npm', args: ['run', 'build:analyze'] },
    { label: 'Link check', command: 'npm', args: ['run', 'test:links'], requiresProductionServer: true },
    { label: 'Lighthouse CI', command: 'npm', args: ['run', 'test:lighthouse'] },
  ],
};

function getExecutable(command: string): string {
  if (process.platform !== 'win32') return command;
  if (command === 'npm') return 'npm.cmd';
  if (command === 'npx') return 'npx.cmd';
  return command;
}

function shouldUseShell(command: string): boolean {
  if (process.platform !== 'win32') return false;
  return !['git', 'powershell.exe', 'pwsh.exe'].includes(command.toLowerCase());
}

function appendManagedOutput(server: ManagedServer, chunk: string | Buffer | null | undefined): void {
  if (!chunk) return;
  const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
  if (!text) return;
  server.output.push(text);
  if (server.output.length > 20) {
    server.output.splice(0, server.output.length - 20);
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function isProductionServerReady(): Promise<boolean> {
  try {
    const response = await fetch(PRODUCTION_AUDIT_URL, { method: 'HEAD' });
    return response.status < 500;
  } catch {
    return false;
  }
}

async function waitForProductionServer(server: ManagedServer, timeoutMs = 60_000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (server.child.exitCode !== null) {
      throw new Error(
        `Production audit server exited before it was ready.\n${server.output.join('').trim()}`
      );
    }

    if (await isProductionServerReady()) {
      return;
    }

    await sleep(1_000);
  }

  throw new Error(`Timed out waiting for production audit server on ${PRODUCTION_AUDIT_URL}.`);
}

async function startProductionAuditServer(): Promise<ManagedServer> {
  const server: ManagedServer = {
    child: spawn(getExecutable('npm'), ['run', 'start'], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: PRODUCTION_AUDIT_PORT },
      shell: shouldUseShell('npm'),
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
    output: [],
  };

  server.child.stdout?.on('data', (chunk) => appendManagedOutput(server, chunk));
  server.child.stderr?.on('data', (chunk) => appendManagedOutput(server, chunk));

  await waitForProductionServer(server);
  return server;
}

async function stopProductionAuditServer(server: ManagedServer | null): Promise<void> {
  if (!server || server.child.exitCode !== null) {
    return;
  }

  server.child.kill('SIGTERM');
  await sleep(1_000);

  if (server.child.exitCode === null) {
    server.child.kill('SIGKILL');
  }
}

function parseMode(args: string[]): AuditMode {
  if (args.includes('--quick')) return 'quick';
  if (args.includes('--medium')) return 'medium';
  if (args.includes('--full')) return 'full';
  return 'full';
}

async function main(): Promise<number> {
  const mode = parseMode(process.argv.slice(2));
  const run = new AutomationRun({
    scriptName: `audit-${mode}`,
    mode,
    args: process.argv.slice(2),
  });
  let productionServer: ManagedServer | null = null;

  try {
    console.log(`Starting logged ${mode} audit...`);
    for (const step of AUDIT_STEPS[mode]) {
      if (step.requiresProductionServer && !productionServer) {
        console.log('\n==> Start production audit server');
        productionServer = await run.step('Start production audit server', startProductionAuditServer, {
          url: PRODUCTION_AUDIT_URL,
        });
      }

      console.log(`\n==> ${step.label}`);
      run.runCommand(step.command, step.args);
    }

    console.log(`\n${mode} audit complete.`);
    await run.finish('passed');
    return 0;
  } catch (error) {
    await run.finish('failed', error);
    console.error(error instanceof Error ? error.message : error);
    return 1;
  } finally {
    await stopProductionAuditServer(productionServer);
  }
}

main().then((exitCode) => process.exit(exitCode));
