import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { FIXERRORS_COMMAND_MANDATED_REVIEW_REASON } from '@/scripts/automation/workflow-review';

const root = process.cwd();
const command = readFileSync(path.join(root, '.cursor', 'commands', 'fixerrors.md'), 'utf8');
const analysisScript = readFileSync(path.join(root, 'scripts', 'fixerrors.ts'), 'utf8');

describe('fixerrors command orchestration', () => {
  it('FXERR-CMD-001 keeps the v4 snapshot/archive safety contract', () => {
    expect(command).toContain('safetyContract":"fixerrors-exact-snapshot-v4"');
    expect(command).toContain('npm run fixerrors');
    expect(command).toContain('npm run fixerrors -- --cleanup');
    expect(analysisScript).toContain("name: 'Record retention collateral'");
    expect(analysisScript).toContain('collateral: retention.collateral');
    expect(analysisScript).toContain('assertFixerrorsEntrypointPreconditions(args)');
    const entrypointIndex = analysisScript.indexOf(
      'assertFixerrorsEntrypointPreconditions(args)'
    );
    expect(entrypointIndex).toBeGreaterThan(-1);
    expect(entrypointIndex).toBeLessThan(analysisScript.indexOf('await client.connect()'));
    expect(entrypointIndex).toBeLessThan(
      analysisScript.indexOf('const connectionString = requireNonPoolingConnectionString()')
    );
  });

  it('FXERR-CMD-002 permits premium parent or worker analysis without recursive delegation', () => {
    expect(command).toContain('the capable premium parent or its assigned premium worker performs the analysis');
    expect(command).toContain('no separate analysis Task is required');
    expect(command).toContain('Workers and reviewers must not launch other agents');
    expect(command).not.toContain('launch **exactly one** `Task`');
    expect(command).not.toContain('Parent Cursor Grok');
    expect(command).toContain('docs_private/error-analysis-decision.md');
    expect(command).toContain('No application fixes, no commits, no production SQL');
    expect(command).toContain('Stop here: no analysis Task, no reviewer');
  });

  it('FXERR-CMD-003 selects review by risk and preserves candidate-bound blockers', () => {
    expect(command).toContain('Routine bounded repairs with sufficient evidence need no second model review');
    expect(command).toContain('material risk, unresolved uncertainty, an explicit owner request, or an applicable repository gate');
    expect(command).not.toContain('Launch **exactly one** `final-diff-reviewer`');
    expect(command).toContain('The root invokes the read-only reviewer directly');
    expect(command).toContain('its result and tests must match the actual candidate');
    expect(command).toContain('Unresolved review blockers still prevent commit');
    expect(command).toContain('one closure/delta `final-diff-reviewer`');
    expect(command).toContain('After two failed premium reviews, stop and report');
    expect(command).toContain('Only when independent review was selected');
    expect(command).toContain(`reviewEscalationReasons: ["${FIXERRORS_COMMAND_MANDATED_REVIEW_REASON}"]`);
    expect(command).toContain('Otherwise do not emit that reason or claim independent review occurred');
    expect(command).toContain('Never fabricate review approval or bypass a mechanical release gate');
  });

  it('FXERR-CMD-004 marks mechanical report clusters as advisory input for the decision file', () => {
    expect(analysisScript).toContain(
      'Mechanical clusters and TEE lanes below are advisory input for analysis by the premium parent or assigned worker, which writes `docs_private/error-analysis-decision.md`.'
    );
  });
});
