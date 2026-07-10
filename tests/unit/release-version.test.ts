import { describe, expect, it } from 'vitest';
import {
  buildReleaseHistoryEntries,
  buildWhatChangedSummary,
  computeNextVersionState,
  determineBumpKind,
  formatReleaseLogEntry,
  formatReleaseVersion,
  getCurrentMmyy,
  getRecentReleaseHistoryMonths,
  getReleaseHistoryEntriesForMonth,
  parseConventionalCommit,
  parseCommitsFromMessages,
  prependReleaseLogEntry,
  selectPrimaryCommitMessage,
  selectReleasePrimaryCommitMessage,
  shouldSkipVersionBumpCommit,
} from '@/lib/config/release-version-logic';

describe('release version logic', () => {
  it('formats mmyy from Europe/London calendar month', () => {
    const may2026 = new Date('2026-05-21T12:00:00Z');
    expect(getCurrentMmyy(may2026)).toBe('0526');
  });

  it('formats release version string', () => {
    expect(formatReleaseVersion({ mmyy: '0526', major: 1, minor: 3 })).toBe('0526.1.3');
  });

  it('parses conventional commits and skips version bump commits', () => {
    expect(parseConventionalCommit('feat(fleet): add plant table layout')).toEqual({
      raw: 'feat(fleet): add plant table layout',
      type: 'feat',
      scope: 'fleet',
      subject: 'add plant table layout',
      isBreaking: false,
    });

    expect(shouldSkipVersionBumpCommit('chore(release): bump to 0526.1.0 [skip version]')).toBe(true);
    expect(parseConventionalCommit('chore(release): bump to 0526.1.0 [skip version]')).toBeNull();
  });

  it('parses scoped breaking changes with bang after the scope', () => {
    expect(parseConventionalCommit('fix(api)!: remove endpoint')).toEqual({
      raw: 'fix(api)!: remove endpoint',
      type: 'fix',
      scope: 'api',
      subject: 'remove endpoint',
      isBreaking: true,
    });
  });

  it('treats feat as major and fix as minor', () => {
    const featOnly = parseCommitsFromMessages(['feat(ui): new dashboard']);
    const fixOnly = parseCommitsFromMessages(['fix(api): handle timeout']);
    const scopedBreakingFix = parseCommitsFromMessages(['fix(api)!: remove endpoint']);

    expect(determineBumpKind(featOnly)).toBe('major');
    expect(determineBumpKind(fixOnly)).toBe('minor');
    expect(determineBumpKind(scopedBreakingFix)).toBe('major');
  });

  it('prefers feat commit for primary git commit message', () => {
    const commits = parseCommitsFromMessages([
      'fix(fleet): normalize serial numbers',
      'feat(fleet): improve plant table layout',
    ]);

    expect(selectPrimaryCommitMessage(commits)).toBe('feat(fleet): improve plant table layout');
  });

  it('bumps major and resets minor on feat', () => {
    const current = { mmyy: '0526', major: 1, minor: 4, lastProcessedSha: 'abc' };
    const commits = parseCommitsFromMessages(['feat(fleet): import assets']);
    const now = new Date('2026-05-21T12:00:00Z');

    const { next, bumpKind } = computeNextVersionState(current, commits, now);
    expect(bumpKind).toBe('major');
    expect(next).toEqual({ mmyy: '0526', major: 2, minor: 0, lastProcessedSha: 'abc' });
  });

  it('bumps minor on fix', () => {
    const current = { mmyy: '0526', major: 1, minor: 2, lastProcessedSha: 'abc' };
    const commits = parseCommitsFromMessages(['fix(fleet): serial numbers']);
    const now = new Date('2026-05-21T12:00:00Z');

    const { next, bumpKind } = computeNextVersionState(current, commits, now);
    expect(bumpKind).toBe('minor');
    expect(next.minor).toBe(3);
    expect(next.major).toBe(1);
  });

  it('resets to mmyy.0.0 when calendar month changes', () => {
    const current = { mmyy: '0526', major: 2, minor: 4, lastProcessedSha: 'abc' };
    const commits = parseCommitsFromMessages(['feat(fleet): june feature']);
    const june = new Date('2026-06-02T12:00:00Z');

    const { next, bumpKind } = computeNextVersionState(current, commits, june);
    expect(bumpKind).toBe('month_reset');
    expect(next).toEqual({ mmyy: '0626', major: 0, minor: 0, lastProcessedSha: 'abc' });
  });

  it('still resets the month when no conventional commits were parsed', () => {
    const current = { mmyy: '0526', major: 2, minor: 4, lastProcessedSha: 'abc' };
    const june = new Date('2026-06-02T12:00:00Z');

    const { next, bumpKind } = computeNextVersionState(current, [], june);
    expect(bumpKind).toBe('month_reset');
    expect(next).toEqual({ mmyy: '0626', major: 0, minor: 0, lastProcessedSha: 'abc' });
    expect(selectPrimaryCommitMessage([])).toBeNull();
    expect(selectReleasePrimaryCommitMessage([], bumpKind, next)).toBe(
      'chore(release): reset release version for 0626'
    );
  });

  it('returns none when no eligible commits', () => {
    const current = { mmyy: '0526', major: 0, minor: 0, lastProcessedSha: '' };
    const { bumpKind, next } = computeNextVersionState(current, [], new Date('2026-05-21T12:00:00Z'));
    expect(bumpKind).toBe('none');
    expect(next).toEqual(current);
  });

  it('builds what changed paragraph from commit subjects', () => {
    const commits = parseCommitsFromMessages([
      'feat(fleet): import plant assets',
      'fix(fleet): normalize serial numbers',
    ]);

    expect(buildWhatChangedSummary(commits)).toBe(
      'Import plant assets. Normalize serial numbers.'
    );
  });

  it('formats release log entry in the required structure', () => {
    const entry = formatReleaseLogEntry({
      version: '0526.1.0',
      primaryCommitMessage: 'feat(fleet): improve plant table layout',
      whatChanged: 'Improved plant table layout.',
      releaseDetails: [
        'Improved the fleet table so plant assets are easier to review.',
      ],
      commitMessages: [
        'feat(fleet): import plant assets',
        'fix(fleet): normalize serial numbers',
      ],
      pushedAt: '2026-05-21T14:00:29Z',
    });

    expect(entry).toContain('## 0526.1.0');
    expect(entry).toContain('**GIT COMMIT MESSAGE**');
    expect(entry).toContain('`feat(fleet): improve plant table layout`');
    expect(entry).toContain('**PUSHED AT**');
    expect(entry).toContain('2026-05-21T14:00:29Z');
    expect(entry).toContain('**WHAT CHANGED**');
    expect(entry).toContain('**VERSION HISTORY DETAILS**');
    expect(entry).toContain('- Improved the fleet table so plant assets are easier to review.');
    expect(entry).toContain('**COMMITS IN THIS RELEASE**');
    expect(entry).toContain('- `fix(fleet): normalize serial numbers`');
  });

  it('builds sanitized release history from release log entries', () => {
    const releaseLog = [
      '# Production release log',
      '',
      'Private changelog for production builds. Newest entries first.',
      '',
      '## 0526.2.1',
      '',
      '**GIT COMMIT MESSAGE**',
      '`fix(api): handle transient lookup failures`',
      '',
      '**WHAT CHANGED**',
      'Handle transient API lookup failures.',
      '',
      '**VERSION HISTORY DETAILS**',
      '- Fixed background lookup retries so temporary failures are handled before users see an error.',
      '',
      '**COMMITS IN THIS RELEASE**',
      '- `fix(api): handle transient lookup failures`',
      '',
      '## 0526.2.0',
      '',
      '**GIT COMMIT MESSAGE**',
      '`feat(fleet): update fleet workflow`',
      '',
      '**PUSHED AT**',
      '2026-05-21T14:00:29Z',
      '',
      '**WHAT CHANGED**',
      'Update fleet workflow and API routes.',
      '',
      '**COMMITS IN THIS RELEASE**',
      '- `feat(fleet): update fleet workflow`',
      '',
    ].join('\n');

    const history = buildReleaseHistoryEntries(releaseLog, {
      '0526.2.1': '2026-05-21T15:00:29Z',
    });

    expect(history).toEqual([
      {
        version: '0526.2.1',
        updateKind: 'minor',
        title: 'Background services improvements',
        description: 'Handled temporary background services lookup problems.',
        summary: 'Handled temporary background services lookup problems.',
        details: [
          'Fixed background lookup retries so temporary failures are handled before users see an error.',
        ],
        areas: ['Background services'],
        areaKeys: ['background-services'],
        pushedAt: '2026-05-21T15:00:29Z',
      },
      {
        version: '0526.2.0',
        updateKind: 'major',
        title: 'Fleet update',
        description: 'Updated fleet workflow and background services.',
        summary: 'Updated fleet workflow and background services.',
        details: [
          'Updated fleet workflow.',
        ],
        areas: ['Fleet workflow', 'Background services'],
        areaKeys: ['fleet', 'background-services'],
        pushedAt: '2026-05-21T14:00:29Z',
      },
    ]);
  });

  it('uses client-facing Daily Tasks wording for inspection scopes', () => {
    const releaseLog = [
      '# Production release log',
      '',
      'Private changelog for production builds. Newest entries first.',
      '',
      '## 0626.3.0',
      '',
      '**GIT COMMIT MESSAGE**',
      '`feat(van-inspections): update inspection workflow`',
      '',
      '**WHAT CHANGED**',
      'Fixed an issue in the daily check flow.',
      '',
      '**COMMITS IN THIS RELEASE**',
      '- `feat(van-inspections): update inspection workflow`',
      '',
    ].join('\n');

    expect(buildReleaseHistoryEntries(releaseLog)[0]).toMatchObject({
      title: 'Daily Tasks update',
      areas: ['Daily Tasks'],
      areaKeys: ['daily-tasks'],
    });
  });

  it('normalizes release areas without leading conjunctions or case duplicates', () => {
    const releaseLog = [
      '# Production release log',
      '',
      'Private changelog for production builds. Newest entries first.',
      '',
      '## 0626.39.0',
      '',
      '**GIT COMMIT MESSAGE**',
      '`feat(inventory): update Inventory, Sign in, Customers, Dashboard, Navigation, and Profile`',
      '',
      '**WHAT CHANGED**',
      'Update Inventory, Sign in, Customers, Dashboard, Navigation, and Profile.',
      '',
      '**COMMITS IN THIS RELEASE**',
      '- `feat(inventory): update Inventory, Sign in, Customers, Dashboard, Navigation, and Profile`',
      '',
    ].join('\n');

    expect(buildReleaseHistoryEntries(releaseLog)[0]).toMatchObject({
      areas: ['Inventory', 'Sign in', 'Customers', 'Dashboard', 'Navigation', 'Profile'],
      details: ['Updated Inventory, Sign in, Customers, Dashboard, Navigation, and Profile.'],
    });
  });

  it('builds recent release month tabs and filters entries by month', () => {
    const history = [
      {
        version: '0626.1.0',
        updateKind: 'major' as const,
        title: 'June update',
        description: 'Updated June workflow.',
        summary: 'Updated June workflow.',
        details: ['Updated June workflow.'],
        areas: ['June workflow'],
        pushedAt: '2026-06-19T09:00:00Z',
      },
      {
        version: '0526.2.0',
        updateKind: 'major' as const,
        title: 'May update',
        description: 'Updated May workflow.',
        summary: 'Updated May workflow.',
        details: ['Updated May workflow.'],
        areas: ['May workflow'],
        pushedAt: '2026-05-21T14:00:29Z',
      },
    ];

    expect(getRecentReleaseHistoryMonths(history, 2)).toEqual([
      { key: '0626', label: 'June 2026' },
      { key: '0526', label: 'May 2026' },
    ]);
    expect(getRecentReleaseHistoryMonths(history)).toEqual([
      { key: '0626', label: 'June 2026' },
      { key: '0526', label: 'May 2026' },
      { key: '0426', label: 'April 2026' },
      { key: '0326', label: 'March 2026' },
    ]);
    expect(getReleaseHistoryEntriesForMonth(history, '0526')).toEqual([history[1]]);
  });

  it('prepends newest log entry after preamble', () => {
    const updated = prependReleaseLogEntry(
      '# Production release log\n\nPrivate changelog for production builds. Newest entries first.\n\n## 0526.0.0\n',
      '## 0526.1.0\n\n**GIT COMMIT MESSAGE**\n`feat(app): test`\n'
    );

    expect(updated.indexOf('## 0526.1.0')).toBeLessThan(updated.indexOf('## 0526.0.0'));
  });
});
