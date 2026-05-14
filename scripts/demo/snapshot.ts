import { existsSync, mkdirSync } from 'fs';
import { dirname, isAbsolute, resolve } from 'path';
import { spawn } from 'child_process';
import { config } from 'dotenv';

config({ path: resolve(process.cwd(), '.env.local') });

type SnapshotMode = 'capture' | 'restore';

function getProjectRef(supabaseUrl: string): string | null {
  return supabaseUrl.match(/^https:\/\/([^.]+)\.supabase\.co$/)?.[1] ?? null;
}

function assertSnapshotAllowed(mode: SnapshotMode): { connectionString: string; snapshotPath: string } {
  const appMode = process.env.APP_MODE || process.env.NEXT_PUBLIC_APP_MODE;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const expectedProjectRef = process.env.DEMO_SUPABASE_PROJECT_REF || '';
  const actualProjectRef = getProjectRef(supabaseUrl);
  const isLocalProject = supabaseUrl.includes('localhost') || supabaseUrl.includes('127.0.0.1');
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || '';
  const snapshotPathRaw = process.env.DEMO_SNAPSHOT_PATH || '';
  const expectedConfirm = mode === 'capture' ? 'CAPTURE_APPROVED_DEMO' : 'RESTORE_APPROVED_DEMO';

  if (appMode !== 'demo') {
    throw new Error('Demo snapshots can only run when APP_MODE or NEXT_PUBLIC_APP_MODE is set to demo.');
  }

  if (process.env.DEMO_SNAPSHOT_CONFIRM !== expectedConfirm) {
    throw new Error(`Set DEMO_SNAPSHOT_CONFIRM=${expectedConfirm} to run demo snapshot ${mode}.`);
  }

  if (!connectionString) {
    throw new Error('POSTGRES_URL_NON_POOLING is required for demo snapshot capture/restore.');
  }

  if (!isLocalProject && (!actualProjectRef || actualProjectRef !== expectedProjectRef)) {
    throw new Error('Refusing demo snapshot operation because DEMO_SUPABASE_PROJECT_REF does not match NEXT_PUBLIC_SUPABASE_URL.');
  }

  if (!snapshotPathRaw || !isAbsolute(snapshotPathRaw)) {
    throw new Error('DEMO_SNAPSHOT_PATH must be an absolute path outside the repository.');
  }

  const snapshotPath = resolve(snapshotPathRaw);
  if (snapshotPath.startsWith(resolve(process.cwd()))) {
    throw new Error('DEMO_SNAPSHOT_PATH must be outside the repository so approved demo snapshots are never committed.');
  }

  return { connectionString, snapshotPath };
}

function getPgProcessEnv(connectionString: string): NodeJS.ProcessEnv {
  const url = new URL(connectionString);

  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGDATABASE: url.pathname.slice(1),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: url.password ? decodeURIComponent(url.password) : '',
    PGSSLMODE: 'require',
  };
}

async function runCommand(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      shell: process.platform === 'win32',
      stdio: 'inherit',
    });

    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function captureSnapshot(connectionString: string, snapshotPath: string): Promise<void> {
  mkdirSync(dirname(snapshotPath), { recursive: true });
  await runCommand(
    'pg_dump',
    [
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      '--schema=public',
      '--schema=auth',
      '--file',
      snapshotPath,
    ],
    getPgProcessEnv(connectionString)
  );
  console.log(`Approved demo snapshot captured: ${snapshotPath}`);
}

async function restoreSnapshot(connectionString: string, snapshotPath: string): Promise<void> {
  if (!existsSync(snapshotPath)) {
    throw new Error(`Approved demo snapshot not found: ${snapshotPath}`);
  }

  await runCommand(
    'pg_restore',
    [
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-privileges',
      '--dbname',
      new URL(connectionString).pathname.slice(1),
      snapshotPath,
    ],
    getPgProcessEnv(connectionString)
  );
  console.log(`Approved demo snapshot restored: ${snapshotPath}`);
}

async function main() {
  const mode = process.argv[2] as SnapshotMode | undefined;
  if (mode !== 'capture' && mode !== 'restore') {
    throw new Error('Usage: npm run demo:snapshot:capture or npm run demo:snapshot:restore');
  }

  const { connectionString, snapshotPath } = assertSnapshotAllowed(mode);
  if (mode === 'capture') await captureSnapshot(connectionString, snapshotPath);
  else await restoreSnapshot(connectionString, snapshotPath);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
