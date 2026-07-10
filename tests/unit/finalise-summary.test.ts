import { describe, expect, it } from 'vitest';
import {
  buildFinaliseReleaseSummaryEvidence,
  buildReleaseDetailFallbackBullets,
  formatReleaseVersionCommitMessage,
  getFinaliseTimingSummaryLines,
  summarizeFinaliseChanges,
} from '@/scripts/finalise-summary';

describe('finalise change summaries', () => {
  it('describes finalise automation work instead of using a generic finalisation message', () => {
    const summary = summarizeFinaliseChanges([
      'scripts/finalise.ts',
      'scripts/finalise-summary.ts',
      'tests/unit/finalise-summary.test.ts',
    ]);

    expect(summary.commitMessage).toBe('chore(finalise): update Release automation and App reliability');
    expect(summary.areas).toEqual(['Release automation', 'App reliability']);
  });

  it('summarises dashboard and navigation work from related files', () => {
    const summary = summarizeFinaliseChanges([
      'app/(dashboard)/dashboard/page.tsx',
      'components/layout/MobileTextSizeDialog.tsx',
      'lib/config/mobile-text-size-preference.ts',
      'tests/unit/mobile-text-size-preference.test.ts',
    ]);

    expect(summary.commitMessage).toBe('feat(dashboard): update Dashboard and Navigation');
  });

  it('summarises sidebar layout styling instead of falling back to repository files', () => {
    const summary = summarizeFinaliseChanges([
      'app/globals.css',
      'components/layout/SidebarNav.tsx',
    ]);

    expect(summary.commitMessage).toBe('fix(layout): update navigation');
  });

  it('summarises multiple feature areas when a finalise contains more than one task', () => {
    const summary = summarizeFinaliseChanges([
      'components/layout/MobileTextSizeDialog.tsx',
      'components/timesheets/MobileNumericTimeInput.tsx',
      'lib/utils/numeric-time-input.ts',
    ]);

    expect(summary.commitMessage).toBe('feat(timesheets): update Timesheets and Navigation');
  });

  it('orders summaries by changed-file and line impact instead of static descriptor priority', () => {
    const summary = summarizeFinaliseChanges([
      { path: 'app/(dashboard)/debug/components/LegacyJobCodesDebugPanel.tsx', additions: 400, deletions: 20 },
      { path: 'app/(dashboard)/debug/page.tsx', additions: 20, deletions: 2 },
      { path: 'app/api/debug/job-code-corrections/route.ts', additions: 120, deletions: 0 },
      { path: 'app/(dashboard)/inventory/components/InventoryTable.tsx', additions: 30, deletions: 5 },
      { path: 'app/(dashboard)/van-inspections/[id]/page.tsx', additions: 1, deletions: 1 },
    ]);

    expect(summary.commitMessage).toBe('feat(debug): update Debug tools, Inventory, and Daily Tasks');
    expect(summary.areas).toEqual(['Debug tools', 'Inventory', 'Daily Tasks']);
  });

  it('excludes generated and release artifacts from product summaries', () => {
    const summary = summarizeFinaliseChanges([
      '.next/types/routes.d.ts',
      'docs_private/automation/runs/finalise/2026-06-19.json',
      'lib/config/release-history.json',
      'app/(dashboard)/inventory/page.tsx',
    ]);

    expect(summary.commitMessage).toBe('feat(inventory): update inventory');
    expect(summary.fileCount).toBe(1);
    expect(summary.areas).toEqual(['Inventory']);
  });

  it('builds descriptive release detail fallback bullets from changed files and commits', () => {
    const changedFiles = [
      'app/(dashboard)/inventory/page.tsx',
      'app/api/inventory/route.ts',
      'tests/unit/inventory-route.test.ts',
    ];
    const commitMessages = ['feat(inventory): add stock adjustment workflow'];

    expect(buildFinaliseReleaseSummaryEvidence(changedFiles, commitMessages).tasks[0]).toMatchObject({
      area: 'Inventory',
      subject: 'add stock adjustment workflow',
    });
    expect(buildReleaseDetailFallbackBullets(changedFiles, commitMessages)).toContain(
      'Added stock adjustment workflow, with changes to background routes, app screens, and automated tests.'
    );
  });

  it('uses the primary change summary for release version commits', () => {
    expect(formatReleaseVersionCommitMessage('fix(layout): hide sidebar scrollbar', '0526.5.1')).toBe(
      'fix(layout): hide sidebar scrollbar [skip version]\n\nRelease version: 0526.5.1'
    );
  });

  it('does not duplicate skip markers in release version commits', () => {
    expect(formatReleaseVersionCommitMessage('fix(layout): hide sidebar scrollbar [skip version]', '0526.5.1')).toBe(
      'fix(layout): hide sidebar scrollbar [skip version]\n\nRelease version: 0526.5.1'
    );
  });

  it('summarises only slow finalise timing entries in descending order', () => {
    expect(getFinaliseTimingSummaryLines([
      { label: 'Commit workspace changes', durationMs: 1200 },
      { label: 'Run clean production build', durationMs: 286_755 },
      { label: 'Run API and Playwright testsuite', durationMs: 180_000 },
    ])).toEqual([
      'Timing summary (steps over 30.0s):',
      '- Run clean production build: 4.8m',
      '- Run API and Playwright testsuite: 3.0m',
    ]);
  });

  it('prints a clear timing summary when no finalise steps are slow', () => {
    expect(getFinaliseTimingSummaryLines([
      { label: 'Commit workspace changes', durationMs: 1200 },
    ])).toEqual(['Timing summary: no finalise steps exceeded 30.0s.']);
  });
});
