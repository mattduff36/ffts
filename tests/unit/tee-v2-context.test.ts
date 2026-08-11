import { existsSync, readFileSync, readdirSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('TEE V2.2 FFTS project context', () => {
  it('TEE-DOCS-001 / TEE-PUSH-001: short aliases do not authorize push', () => {
    const commandDirectory = path.join(root, '.cursor', 'commands');
    expect(readdirSync(commandDirectory).sort()).toEqual([
      'cleancodebase.md',
      'createinvoice.md',
      'fap.md',
      'ffap.md',
      'finalise-full.md',
      'finalise.md',
      'fixerrors.md',
      'workflow-review.md',
    ]);

    const fap = readFileSync(path.join(commandDirectory, 'fap.md'), 'utf8');
    const ffap = readFileSync(path.join(commandDirectory, 'ffap.md'), 'utf8');
    const finalise = readFileSync(path.join(commandDirectory, 'finalise.md'), 'utf8');
    const finaliseFull = readFileSync(path.join(commandDirectory, 'finalise-full.md'), 'utf8');
    const workflowReview = readFileSync(path.join(commandDirectory, 'workflow-review.md'), 'utf8');
    const fixerrors = readFileSync(path.join(commandDirectory, 'fixerrors.md'), 'utf8');
    const core = readFileSync(path.join(root, '.cursor', 'rules', 'ffts-core.mdc'), 'utf8');
    const finaliseCommands = readFileSync(
      path.join(root, '.cursor', 'rules', 'finalise-commands.mdc'),
      'utf8'
    );
    expect(fap).toMatch(/does \*\*not\*\* authorize pushing/iu);
    expect(ffap).toMatch(/does \*\*not\*\* authorize pushing/iu);
    expect(fap).toMatch(/explicit push phrase/iu);
    expect(ffap).toMatch(/explicit push phrase/iu);
    expect(finalise).toMatch(/not push/iu);
    expect(finaliseFull).toMatch(/not push/iu);
    expect(workflowReview).toMatch(/Never push/iu);
    expect(finalise).not.toMatch(/\/fap|\/ffap/iu);
    expect(core).toMatch(/do \*\*not\*\* authorize a push/iu);
    expect(core).toContain('finalise and push');
    expect(core).toContain('finalise:push');
    expect(finaliseCommands).not.toMatch(/Map `fap`/);
    expect(finaliseCommands).not.toMatch(/Map `ffap`/);
    expect(finaliseCommands).toMatch(/do \*\*not\*\* authorize a push/iu);
    expect(finaliseCommands).toContain('finalise and push');
    expect(fixerrors).toContain('fixerrors-exact-snapshot-v1');
    expect(fixerrors).toMatch(/Never push/iu);
  });

  it('TEE-DOCS-001 / FXERR-DOCS-001 / FXERR-COMPAT-001: documents trusted fixerrors export and bound cleanup', () => {
    const core = readFileSync(path.join(root, '.cursor', 'rules', 'ffts-core.mdc'), 'utf8');
    const fixerrorsRule = readFileSync(path.join(root, '.cursor', 'rules', 'fixerrors.mdc'), 'utf8');
    const scriptsReadme = readFileSync(path.join(root, 'scripts', 'README.md'), 'utf8');
    const database = readFileSync(
      path.join(root, '.cursor', 'rules', 'database-migrations.mdc'),
      'utf8'
    );
    expect(core).toContain('load `.cursor/rules/database-migrations.mdc`');
    expect(core).toContain('push to GitHub');
    expect(core).toContain('fixerrors-exact-snapshot-v1');
    expect(core).toMatch(/non-destructive export\/analysis/i);
    expect(fixerrorsRule).toContain('fixerrors-exact-snapshot-v1');
    expect(fixerrorsRule).toMatch(/--no-clear/);
    expect(fixerrorsRule).toMatch(/untrusted/i);
    expect(scriptsReadme).toContain('fixerrors-exact-snapshot-v1');
    expect(scriptsReadme).toMatch(/never mutate production/i);
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
      'scripts/automation/finalise-checkpoint.ts',
      'scripts/automation/finalise-failure.ts',
      'scripts/automation/workflow-finalise-correlation.ts',
      'scripts/finalise-repair.ts',
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

  it('TEE-PUSH-001: finalise commands document repair; aliases omit push authorization', () => {
    const finalise = readFileSync(path.join(root, '.cursor', 'commands', 'finalise.md'), 'utf8');
    const finaliseFull = readFileSync(
      path.join(root, '.cursor', 'commands', 'finalise-full.md'),
      'utf8'
    );
    const fap = readFileSync(path.join(root, '.cursor', 'commands', 'fap.md'), 'utf8');
    const ffap = readFileSync(path.join(root, '.cursor', 'commands', 'ffap.md'), 'utf8');
    expect(finalise).toMatch(/finalise:repair/);
    expect(finaliseFull).toMatch(/finalise:repair/);
    expect(fap).toMatch(/finalise:repair/);
    expect(ffap).toMatch(/finalise:repair/);
    expect(finalise).toMatch(/Never push/iu);
    expect(finaliseFull).toMatch(/Never push/iu);
    expect(finalise).not.toMatch(/push to GitHub/iu);
    expect(fap).toMatch(/does \*\*not\*\* authorize pushing/iu);
    expect(ffap).toMatch(/does \*\*not\*\* authorize pushing/iu);
    expect(fap).toMatch(/finalise and push/iu);
    expect(ffap).toMatch(/finalise full and push/iu);
  });
});
