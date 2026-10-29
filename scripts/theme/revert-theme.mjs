import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const checkOnly = process.argv.includes('--check');
if (process.argv.slice(2).some(arg => arg !== '--check')) {
  throw new Error('Usage: npm run theme:revert [-- --check]');
}
const root = fileURLToPath(new URL('../../', import.meta.url));
const patch = 'scripts/theme/legacy-theme.patch';
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const branch = git('branch', '--show-current').trim();
if (branch !== 'codex/meeting-2026-10-28-preview') {
  throw new Error('Theme rollback is restricted to codex/meeting-2026-10-28-preview. No files changed.');
}
if (!checkOnly && git('status', '--porcelain').trim()) {
  throw new Error('Commit or set aside local changes first. No files changed.');
}
git('apply', '--check', '--index', patch);
if (checkOnly) {
  console.log('Blue/yellow theme rollback applies cleanly. No files changed.');
} else {
  git('apply', '--index', patch);
  console.log('Previous blue/yellow theme restored and staged. Meeting features and original logo preserved.');
  console.log('Review: git diff --cached');
  console.log('Validate: npm run finalise');
  console.log('Publish preview only: git push origin HEAD:refs/heads/codex/meeting-2026-10-28-preview');
  console.log('Nothing has been committed, pushed or deployed by this command.');
}
