import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { homedir, tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildWorkClusters,
  classifyWorkCluster,
  collectParentChats,
  collectReleases,
  isParentTranscriptPath,
  parseCreateInvoiceArgs,
  parseGitLogOutput,
  parseParentTranscript,
  parseReleaseLog,
  validateDateRange,
  type ChatEvidence,
  type CommitEvidence,
  type CreateInvoiceOptions,
} from '@/scripts/create-invoice';

const temporaryDirectories: string[] = [];

function createTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function createOptions(
  repositoryRoot: string,
  transcriptsRoot = path.join(repositoryRoot, 'transcripts'),
): CreateInvoiceOptions {
  return {
    from: '2026-07-01',
    to: '2026-07-31',
    rate: 28,
    supportRate: 5,
    includeUnpushed: true,
    outputDirectory: path.join(repositoryRoot, 'docs_private', 'invoices'),
    repositoryRoot,
    transcriptsRoot,
  };
}

function createTranscript(
  transcriptsRoot: string,
  id: string,
  query: string,
  assistantText: string,
  toolNames: string[] = [],
): string {
  const directory = path.join(transcriptsRoot, id);
  mkdirSync(directory, { recursive: true });
  const lines = [
    JSON.stringify({
      role: 'user',
      message: {
        content: [{
          type: 'text',
          text: `<timestamp>2026-07-10T09:00:00.000Z</timestamp><user_query>${query}</user_query>`,
        }],
      },
    }),
    JSON.stringify({
      role: 'assistant',
      message: {
        content: [
          { type: 'text', text: assistantText },
          ...toolNames.map((name) => ({ type: 'tool_use', name })),
        ],
      },
    }),
  ];
  const filePath = path.join(directory, `${id}.jsonl`);
  writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
  return filePath;
}

function createCommit(overrides: Partial<CommitEvidence> = {}): CommitEvidence {
  return {
    hash: 'a'.repeat(40),
    shortHash: 'aaaaaaaa',
    committedAt: '2026-07-10T10:00:00.000Z',
    date: '2026-07-10',
    subject: 'feat(app): update workflow',
    files: ['app/example.ts'],
    additions: 20,
    deletions: 2,
    isUnpushed: false,
    clusterId: 'other-development',
    ...overrides,
  };
}

function createChat(overrides: Partial<ChatEvidence> = {}): ChatEvidence {
  return {
    id: 'chat-id',
    firstDate: '2026-07-10',
    lastDate: '2026-07-10',
    title: 'Resolve a production issue',
    requests: ['Resolve a production issue'],
    userTurns: 2,
    assistantTurns: 2,
    toolUses: 1,
    mutationToolUses: 1,
    characterCount: 2_000,
    completionStatus: 'completed',
    cancellationSignals: [],
    clusterId: 'error-support',
    isAdministrative: false,
    isReviewOnly: false,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('createinvoice argument and date validation', () => {
  it('requires both dates and validates calendar ranges', () => {
    expect(() => parseCreateInvoiceArgs([])).toThrow(/--from and --to/u);
    expect(() => validateDateRange({ from: '2026-02-30', to: '2026-03-01' }))
      .toThrow(/valid calendar date/u);
    expect(() => validateDateRange({ from: '2026-07-31', to: '2026-07-01' }))
      .toThrow(/on or before/u);
  });

  it('applies defaults and resolves the FFTS transcript root', () => {
    vi.stubEnv('CURSOR_AGENT_TRANSCRIPTS_DIR', undefined);
    const options = parseCreateInvoiceArgs([
      '--from=2026-07-01',
      '--to',
      '2026-07-31',
    ], 'D:\\Websites\\ffts');

    expect(options.rate).toBe(28);
    expect(options.supportRate).toBe(5);
    expect(options.includeUnpushed).toBe(true);
    expect(options.transcriptsRoot).toBe(path.resolve(
      homedir(),
      '.cursor',
      'projects',
      'd-Websites-ffts',
      'agent-transcripts',
    ));
  });

  it('honours transcript overrides and rejects malformed option values', () => {
    vi.stubEnv('CURSOR_AGENT_TRANSCRIPTS_DIR', 'environment-transcripts');
    const environmentOptions = parseCreateInvoiceArgs([
      '--from',
      '2026-07-01',
      '--to',
      '2026-07-31',
    ], 'D:\\Websites\\ffts');
    const commandOptions = parseCreateInvoiceArgs([
      '--from',
      '2026-07-01',
      '--to',
      '2026-07-31',
      '--transcripts-dir',
      'command-transcripts',
      '--include-unpushed',
      'false',
    ], 'D:\\Websites\\ffts');

    expect(environmentOptions.transcriptsRoot).toBe(path.resolve('environment-transcripts'));
    expect(commandOptions.transcriptsRoot).toBe(path.resolve('command-transcripts'));
    expect(commandOptions.includeUnpushed).toBe(false);
    expect(() => parseCreateInvoiceArgs([
      '--from',
      '2026-07-01',
      '--to',
      '2026-07-31',
      '--rate',
    ])).toThrow(/--rate requires a value/u);
    expect(() => parseCreateInvoiceArgs([
      '--from',
      '2026-07-01',
      '--to',
      '2026-07-31',
      '--support-rate',
      '-1',
    ])).toThrow(/non-negative number/u);
  });
});

describe('FFTS parent transcript discovery and filtering', () => {
  it('accepts only the parent UUID path shape', () => {
    const root = createTemporaryDirectory('ffts-invoice-transcripts-');
    const parentPath = path.join(root, 'parent-id', 'parent-id.jsonl');
    const subagentPath = path.join(root, 'parent-id', 'subagents', 'child-id.jsonl');
    const mismatchedPath = path.join(root, 'parent-id', 'different-id.jsonl');

    expect(isParentTranscriptPath(parentPath)).toBe(true);
    expect(isParentTranscriptPath(subagentPath)).toBe(false);
    expect(isParentTranscriptPath(mismatchedPath)).toBe(false);
  });

  it('discovers completed parents while excluding administrative and incomplete work', () => {
    const root = createTemporaryDirectory('ffts-invoice-transcripts-');
    const transcriptsRoot = path.join(root, 'agent-transcripts');
    createTranscript(
      transcriptsRoot,
      'completed-chat',
      'Build the scheduling board',
      'Implemented the scheduling board and tests passed.',
      ['ApplyPatch'],
    );
    createTranscript(
      transcriptsRoot,
      'mixed-chat',
      'Implement quote visits, but cancel the optional map',
      'Implemented quote visits and verification passed.',
      ['ApplyPatch'],
    );
    createTranscript(
      transcriptsRoot,
      'admin-chat',
      'Run createinvoice for July',
      'Invoice generation completed.',
      ['ApplyPatch'],
    );
    createTranscript(
      transcriptsRoot,
      'review-chat',
      'Perform a read-only review with thoroughness: medium',
      'Review complete.',
    );
    createTranscript(
      transcriptsRoot,
      'planning-chat',
      'Plan a reports change',
      'Here is the plan.',
    );
    createTranscript(
      transcriptsRoot,
      'unknown-chat',
      'Investigate a reports change',
      'Investigation notes.',
      ['ApplyPatch'],
    );
    const subagents = path.join(transcriptsRoot, 'completed-chat', 'subagents');
    mkdirSync(subagents, { recursive: true });
    writeFileSync(path.join(subagents, 'child.jsonl'), '{}\n', 'utf8');

    const result = collectParentChats(createOptions(root, transcriptsRoot));

    expect(result.included.map((chat) => chat.id)).toEqual([
      'completed-chat',
      'mixed-chat',
    ]);
    expect(result.included[1]?.completionStatus).toBe('mixed');
    expect(result.excluded.map((chat) => chat.id).sort()).toEqual([
      'admin-chat',
      'planning-chat',
      'review-chat',
      'unknown-chat',
    ]);
  });

  it('ignores out-of-range queries and reports a missing transcript root', () => {
    const root = createTemporaryDirectory('ffts-invoice-transcripts-');
    const transcriptsRoot = path.join(root, 'agent-transcripts');
    const filePath = createTranscript(
      transcriptsRoot,
      'dated-chat',
      'Build inventory transfers',
      'Implemented.',
      ['ApplyPatch'],
    );

    expect(parseParentTranscript(filePath, {
      from: '2026-08-01',
      to: '2026-08-31',
    })).toBeNull();
    expect(() => collectParentChats(
      createOptions(root, path.join(root, 'missing-transcripts')),
    )).toThrow(/transcript directory not found/u);
  });
});

describe('FFTS release-history compatibility', () => {
  it('parses current release-log headings and multiple commit subjects', () => {
    const parsed = parseReleaseLog([
      '# Production release log',
      '',
      '## 0726.7.0',
      '',
      '**PUSHED AT**',
      '2026-07-22T00:06:36.660Z',
      '',
      '**COMMITS IN THIS RELEASE**',
      '- `feat(customers): improve customer records`',
      '- `feat(quotes): improve quote visits`',
      '',
    ].join('\n'));

    expect(parsed.get('0726.7.0')).toEqual({
      version: '0726.7.0',
      pushedAt: '2026-07-22T00:06:36.660Z',
      commitSubjects: [
        'feat(customers): improve customer records',
        'feat(quotes): improve quote visits',
      ],
    });
  });

  it('filters nullable dates and maps multi-area releases to FFTS clusters', () => {
    const root = createTemporaryDirectory('ffts-invoice-releases-');
    mkdirSync(path.join(root, 'lib', 'config'), { recursive: true });
    mkdirSync(path.join(root, 'docs_private'), { recursive: true });
    writeFileSync(
      path.join(root, 'lib', 'config', 'release-history.json'),
      JSON.stringify([
        {
          version: '0726.7.0',
          title: 'Customers update',
          description: 'Updated customers, quotes and reminders.',
          details: ['Added quote visit controls.'],
          areas: ['Customers', 'Quotes', 'Reminders'],
          areaKeys: ['customers', 'quotes', 'reminders'],
          pushedAt: '2026-07-22T00:06:36.660Z',
        },
        {
          version: '0726.6.0',
          title: 'Pending release',
          description: 'Not pushed.',
          pushedAt: null,
        },
      ]),
      'utf8',
    );
    writeFileSync(
      path.join(root, 'docs_private', 'release-log.md'),
      [
        '## 0726.7.0',
        '',
        '**PUSHED AT**',
        '2026-07-22T00:06:36.660Z',
        '',
        '**COMMITS IN THIS RELEASE**',
        '- `feat(customers): improve customer records`',
        '',
      ].join('\n'),
      'utf8',
    );

    const releases = collectReleases(createOptions(root));

    expect(releases).toHaveLength(1);
    expect(releases[0]?.clusterIds).toEqual(expect.arrayContaining([
      'commercial-workflows',
      'reminders-notifications',
    ]));
    expect(releases[0]?.releaseLogCommitSubjects).toEqual([
      'feat(customers): improve customer records',
    ]);
    expect(releases[0]?.sourceReferences).toEqual([
      'lib/config/release-history.json',
      'docs_private/release-log.md',
    ]);
  });
});

describe('commit exclusions', () => {
  it('excludes administrative commits while retaining substantive FFTS work', () => {
    const records = [
      ['1', 'feat(app): shipped duplicate [skip version]', 'app/page.tsx'],
      ['2', 'merge: combine release branch', 'app/page.tsx'],
      ['3', 'chore(invoice): update create-invoice automation', 'scripts/create-invoice.ts'],
      ['4', 'chore(finalise): repo finalisation', 'scripts/finalise.ts'],
      ['5', 'chore(demo): prepare demonstration branch', 'README.md'],
      ['6', 'chore(metadata): refresh release files', 'lib/config/release-history.json'],
      ['7', 'test(app): update coverage', 'tests/unit/example.test.ts'],
      ['8', 'feat(scheduling): add quote visits', 'app/(dashboard)/scheduling/page.tsx'],
    ].map(([hash, subject, file]) => [
      '\u001e',
      hash?.repeat(40),
      '\u001f2026-07-10T10:00:00.000Z\u001f',
      subject,
      '\n1\t1\t',
      file,
      '\n',
    ].join('')).join('');

    const commits = parseGitLogOutput(records, new Set(['8'.repeat(40)]));

    expect(commits.slice(0, 7).map((commit) => commit.excludedReason)).toEqual([
      'duplicate release metadata',
      'merge-only commit',
      'invoice administration automation',
      'internal repository tooling',
      'external or inherited-project setup',
      'version-only release metadata',
      'test-only maintenance',
    ]);
    expect(commits[7]).toMatchObject({
      excludedReason: undefined,
      isUnpushed: true,
      clusterId: 'job-scheduling',
    });
  });
});

describe('FFTS cluster classification and conservative calibration', () => {
  it('classifies representative FFTS subjects and paths without copied-project clusters', () => {
    expect(classifyWorkCluster(
      'feat(quotes): add invoice request workflow',
      ['app/(dashboard)/quotes/page.tsx'],
    )).toBe('commercial-workflows');
    expect(classifyWorkCluster(
      'feat(scheduling): add open quote visits',
      ['lib/server/scheduling-quotes.ts'],
    )).toBe('job-scheduling');
    expect(classifyWorkCluster(
      'fix(scheduling): correct quote visit ordering',
      ['lib/server/scheduling-quotes.ts'],
    )).toBe('job-scheduling');
    expect(classifyWorkCluster(
      'Improve stock transfers',
      ['app/(dashboard)/inventory/page.tsx'],
    )).toBe('inventory');
    expect(classifyWorkCluster('Resolve a production stability incident')).toBe('error-support');
    expect(classifyWorkCluster('Update an unmatched FFTS workflow')).toBe('other-development');

    const clusterIds = buildWorkClusters([], [
      createCommit({ clusterId: 'commercial-workflows' }),
      createCommit({ hash: 'b'.repeat(40), shortHash: 'bbbbbbbb', clusterId: 'job-scheduling' }),
    ], []).map((cluster) => cluster.id);
    expect(clusterIds).not.toContain('yard-kiosk');
    expect(clusterIds).not.toContain('inventory-hardware');
  });

  it('uses five-to-six hours for major scope and two-to-three for refinements', () => {
    const majorFiles = [
      'app/(dashboard)/scheduling/page.tsx',
      'app/(dashboard)/scheduling/components/board.tsx',
      'app/api/scheduling/jobs/route.ts',
      'app/api/scheduling/quotes/route.ts',
      'lib/client/scheduling.ts',
      'lib/server/scheduling-board.ts',
      'lib/server/scheduling-quotes.ts',
      'supabase/migrations/20260715_scheduling_module.sql',
    ];
    const clusters = buildWorkClusters([], [
      createCommit({
        subject: 'feat(scheduling): add scheduling module',
        files: majorFiles,
        additions: 1_500,
        deletions: 30,
        clusterId: 'job-scheduling',
      }),
      createCommit({
        hash: 'b'.repeat(40),
        shortHash: 'bbbbbbbb',
        subject: 'feat(inspections): improve daily checks',
        files: ['app/(dashboard)/van-inspections/page.tsx'],
        clusterId: 'daily-tasks',
      }),
    ], []);

    const scheduling = clusters.find((cluster) => cluster.id === 'job-scheduling');
    const dailyTasks = clusters.find((cluster) => cluster.id === 'daily-tasks');
    expect(scheduling?.recommendedHours).toBeGreaterThanOrEqual(5);
    expect(scheduling?.suggestedHoursBand).toEqual({ minimum: 5, maximum: 6 });
    expect(dailyTasks?.recommendedHours).toBeGreaterThanOrEqual(2);
    expect(dailyTasks?.recommendedHours).toBeLessThanOrEqual(3);
  });

  it('groups and caps explicit production support at six hours', () => {
    const supportCommits = Array.from({ length: 8 }, (_, index) => createCommit({
      hash: String(index).padStart(40, '0'),
      shortHash: String(index).padStart(8, '0'),
      subject: `fix(stability): production remediation ${index}`,
      files: [`lib/server/error-${index}.ts`],
      clusterId: 'error-support',
    }));
    const supportChats = Array.from({ length: 4 }, (_, index) => createChat({
      id: `support-chat-${index}`,
    }));

    const support = buildWorkClusters([], supportCommits, supportChats)
      .find((cluster) => cluster.id === 'error-support');

    expect(support?.isSupport).toBe(true);
    expect(support?.recommendedHours).toBe(6);
    expect(support?.suggestedHoursBand.maximum).toBe(6);
  });
});
