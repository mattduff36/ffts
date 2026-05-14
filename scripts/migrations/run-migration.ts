import { spawnSync } from 'child_process';

const result = spawnSync('npm', ['run', 'db:baseline'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);

