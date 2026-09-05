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

  it('FXERR-CMD-002 requires premium generalPurpose analysis and forbids architecture-gate for that step', () => {
    expect(command).toContain('subagent_type: "generalPurpose"');
    expect(command).toContain('gpt-5.6-sol-high');
    expect(command).toContain('docs_private/error-analysis-decision.md');
    expect(command).toMatch(/Do \*\*not\*\* use `architecture-gate` for analysis/u);
    expect(command).toContain('Stop here: no analysis Task, no reviewer');
  });

  it('FXERR-CMD-003 requires a two-pass final-diff-reviewer after code-changing fixes', () => {
    expect(command).toContain('final-diff-reviewer');
    expect(command).toContain('Diff: uncommitted changes');
    expect(command).toContain(
      'Skip the reviewer when every cluster is report-only or manual-investigation and no code changed'
    );
    expect(command).toContain('one closure/delta `final-diff-reviewer`');
    expect(command).toContain('After two failed premium reviews, stop and report');
    expect(command).toContain(`reviewEscalationReasons: ["${FIXERRORS_COMMAND_MANDATED_REVIEW_REASON}"]`);
  });

  it('FXERR-CMD-004 marks mechanical report clusters as advisory input for the decision file', () => {
    expect(analysisScript).toContain(
      'Mechanical clusters and TEE lanes below are advisory input for the premium analysis step, which writes `docs_private/error-analysis-decision.md`.'
    );
  });
});
