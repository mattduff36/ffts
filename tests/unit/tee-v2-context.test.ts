import { existsSync, readFileSync, readdirSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('TEE V2.2 FFTS project context', () => {
  it('TEE-DOCS-001 / TEE-PUSH-001: exposes only non-push commands and no push-authorizing aliases', () => {
    const commandDirectory = path.join(root, '.cursor', 'commands');
    expect(readdirSync(commandDirectory).sort()).toEqual([
      'cleancodebase.md',
      'createinvoice.md',
      'finalise-full.md',
      'finalise.md',
      'workflow-review.md',
    ]);
    expect(existsSync(path.join(commandDirectory, 'fap.md'))).toBe(false);
    expect(existsSync(path.join(commandDirectory, 'ffap.md'))).toBe(false);
    expect(existsSync(path.join(commandDirectory, 'fixerrors.md'))).toBe(false);

    const finalise = readFileSync(path.join(commandDirectory, 'finalise.md'), 'utf8');
    const finaliseFull = readFileSync(path.join(commandDirectory, 'finalise-full.md'), 'utf8');
    const workflowReview = readFileSync(path.join(commandDirectory, 'workflow-review.md'), 'utf8');
    expect(finalise).toMatch(/not push/iu);
    expect(finaliseFull).toMatch(/not push/iu);
    expect(workflowReview).toMatch(/Never push/iu);
    expect(finalise).not.toMatch(/\/fap|\/ffap/iu);
  });

  it('TEE-DOCS-001: keeps database intent discoverable without always loading detailed procedure', () => {
    const core = readFileSync(path.join(root, '.cursor', 'rules', 'ffts-core.mdc'), 'utf8');
    const database = readFileSync(
      path.join(root, '.cursor', 'rules', 'database-migrations.mdc'),
      'utf8'
    );
    expect(core).toContain('load `.cursor/rules/database-migrations.mdc`');
    expect(core).toContain('push to GitHub');
    expect(core).toMatch(/fixerrors -- --no-clear/);
    expect(database).toContain('alwaysApply: false');
    expect(database).toContain('npm run db:validate');
    expect(database).toContain('must not open an implicit database connection');
  });

  it('TEE-INDEPENDENCE-001: keeps active workflow source indexed while excluding historical telemetry', () => {
    const ignored = readFileSync(path.join(root, '.cursorignore'), 'utf8');
    expect(ignored).toContain('docs_private/automation/runs/**');
    expect(ignored).toContain('docs_private/automation/workflow-events/**');
    expect(ignored).toContain('docs_private/automation/reviews/*/20*/events.json');
    expect(ignored).toContain('.cursor/debug*.log');
    expect(ignored).not.toContain('scripts/automation/');
    expect(ignored).not.toContain('docs_private/automation/workstreams/');
  });

  it('TEE-INDEPENDENCE-001: TEE workflow assets stay outside application and data surfaces', () => {
    for (const forbidden of [
      'app/tee',
      'components/tee',
      'lib/tee',
      'supabase/tee',
      'public/tee',
      'scripts/migrations/tee',
    ]) {
      expect(existsSync(path.join(root, forbidden)), forbidden).toBe(false);
    }
    expect(existsSync(path.join(root, 'scripts', 'automation', 'workflow-plan-contract.ts'))).toBe(
      true
    );
    expect(existsSync(path.join(root, '.cursor', 'hooks', 'workflow-stop.mjs'))).toBe(true);
    expect(existsSync(path.join(root, '.cursor', 'hooks.json'))).toBe(true);
  });

  it('TEE-STOP-001: stop hook is fail-open with loop_limit 1', () => {
    const hooks = JSON.parse(readFileSync(path.join(root, '.cursor', 'hooks.json'), 'utf8')) as {
      hooks: { stop: Array<{ command: string; loop_limit?: number }> };
    };
    expect(hooks.hooks.stop[0]?.command).toContain('workflow-stop.mjs');
    expect(hooks.hooks.stop[0]?.loop_limit).toBe(1);
    const stopHook = readFileSync(path.join(root, '.cursor', 'hooks', 'workflow-stop.mjs'), 'utf8');
    expect(stopHook).toContain('writeHookJson({})');
    expect(stopHook).toMatch(/loop_count/);
  });

  it('TEE-INDEPENDENCE-001: committed workflow sources do not reference sibling repositories', () => {
    const files = [
      'scripts/automation/workflow-plan-contract.ts',
      'scripts/automation/workflow-model-tier.ts',
      'scripts/review-preflight.ts',
      '.cursor/rules/ffts-core.mdc',
      '.cursor/rules/workspace-independence.mdc',
    ];
    for (const relative of files) {
      const text = readFileSync(path.join(root, relative), 'utf8');
      expect(text, relative).not.toMatch(/D:\\\\Websites\\\\(?!ffts)|\/(?:avs|sibling)-worklog\//i);
      expect(text, relative).not.toContain('avsworklog');
    }
  });
});
