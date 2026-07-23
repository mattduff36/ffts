import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

export interface InvoiceDateRange {
  from: string;
  to: string;
}

export interface CreateInvoiceOptions extends InvoiceDateRange {
  rate: number;
  supportRate: number;
  includeUnpushed: boolean;
  outputDirectory: string;
  repositoryRoot: string;
  transcriptsRoot: string;
}

export interface ReleaseEvidence {
  version: string;
  pushedAt: string;
  date: string;
  title: string;
  description: string;
  details: string[];
  areas: string[];
  clusterIds: string[];
  releaseLogCommitSubjects: string[];
  sourceReferences: string[];
}

export interface CommitEvidence {
  hash: string;
  shortHash: string;
  committedAt: string;
  date: string;
  subject: string;
  files: string[];
  additions: number;
  deletions: number;
  isUnpushed: boolean;
  clusterId: string;
  excludedReason?: string;
}

export type ChatCompletionStatus = 'completed' | 'mixed' | 'planning-only' | 'unknown';

export interface ChatEvidence {
  id: string;
  firstDate: string;
  lastDate: string;
  title: string;
  requests: string[];
  userTurns: number;
  assistantTurns: number;
  toolUses: number;
  mutationToolUses: number;
  characterCount: number;
  completionStatus: ChatCompletionStatus;
  cancellationSignals: string[];
  clusterId: string;
  isAdministrative: boolean;
  isReviewOnly: boolean;
}

export interface WorkClusterEvidence {
  id: string;
  label: string;
  isSupport: boolean;
  releases: string[];
  commits: string[];
  chats: string[];
  dates: string[];
  additions: number;
  deletions: number;
  changedFiles: number;
  migrationFiles: number;
  testFiles: number;
  transcriptCharacters: number;
  transcriptTurns: number;
  hasUnpushedWork: boolean;
  complexityScore: number;
  recommendedHours: number;
  calibrationRationale: string;
  suggestedHoursBand: {
    minimum: number;
    maximum: number;
  };
}

export interface InvoiceEvidenceReport {
  generatedAt: string;
  period: InvoiceDateRange;
  pricing: {
    developmentRate: number;
    supportRate: number;
    currency: 'GBP';
  };
  settings: {
    includeUnpushed: boolean;
    exactTokenUsageAvailable: false;
    tokenUsageProxy: string;
  };
  summary: {
    releases: number;
    substantiveCommits: number;
    excludedCommits: number;
    completedOrMixedChats: number;
    planningOrUnknownChats: number;
    unpushedCommits: number;
  };
  releases: ReleaseEvidence[];
  commits: CommitEvidence[];
  chats: ChatEvidence[];
  clusters: WorkClusterEvidence[];
  exclusions: {
    commits: CommitEvidence[];
    chats: ChatEvidence[];
  };
}

interface ReleaseHistoryEntry {
  version: string;
  title: string;
  description: string;
  details?: string[];
  areas?: string[];
  areaKeys?: string[];
  pushedAt?: string | null;
}

interface ReleaseLogEntry {
  version: string;
  pushedAt?: string;
  commitSubjects: string[];
}

interface ParsedTranscriptLine {
  role?: string;
  message?: {
    content?: unknown;
  };
}

interface ClusterDefinition {
  id: string;
  label: string;
  isSupport: boolean;
  hourProfile: 'major' | 'focused' | 'support' | 'fallback';
  keywords: RegExp[];
  paths: string[];
  areaKeys: string[];
}

const CLUSTER_DEFINITIONS: ClusterDefinition[] = [
  {
    id: 'error-support',
    label: 'Bug fixes and production support',
    isSupport: true,
    hourProfile: 'support',
    keywords: [
      /\bfixerrors\b/iu,
      /\bproduction (?:incident|issue|error|support|remediation)\b/iu,
      /\bbug fixes?\b/iu,
      /\bhotfix\b/iu,
      /\bstability\b/iu,
      /\boutage\b/iu,
      /\btransient (?:error|failure|noise)\b/iu,
      /\berror (?:reporting|logging|remediation)\b/iu,
    ],
    paths: ['app/(dashboard)/errors/', 'app/(dashboard)/admin/errors/', 'app/api/errors/', 'lib/server/error-'],
    areaKeys: ['error-reporting'],
  },
  {
    id: 'commercial-workflows',
    label: 'Customers, quotes and commercial workflows',
    isSupport: false,
    hourProfile: 'major',
    keywords: [/\bcustomers?\b/iu, /\bquotes?\b/iu, /invoice requests?/iu, /commercial workflow/iu, /\bsuggestions?\b/iu],
    paths: [
      'app/(dashboard)/customers/',
      'app/(dashboard)/quotes/',
      'app/(dashboard)/suggestions/',
      'app/api/customers/',
      'app/api/quotes/',
      'lib/server/customer-',
      'lib/server/quote-',
    ],
    areaKeys: ['customers', 'quotes', 'suggestions'],
  },
  {
    id: 'job-scheduling',
    label: 'Job scheduling and quote visits',
    isSupport: false,
    hourProfile: 'major',
    keywords: [/\bscheduling\b/iu, /schedule (?:a )?(?:job|quote|visit)/iu, /quote visits?/iu, /plant unavailability/iu],
    paths: [
      'app/(dashboard)/scheduling/',
      'app/api/scheduling/',
      'lib/client/scheduling',
      'lib/server/scheduling-',
      'scheduling_module',
      'quote_scheduling',
      'schedule_open_quotes',
    ],
    areaKeys: ['scheduling'],
  },
  {
    id: 'inventory',
    label: 'Inventory tracking, transfers and locations',
    isSupport: false,
    hourProfile: 'focused',
    keywords: [/\binventory\b/iu, /\bstock checks?\b/iu, /inventory transfer/iu, /site locations?/iu],
    paths: ['app/(dashboard)/inventory/', 'app/api/inventory/', 'lib/server/inventory-', 'inventory_location'],
    areaKeys: ['inventory'],
  },
  {
    id: 'daily-tasks',
    label: 'Daily checks for vans, plant and HGVs',
    isSupport: false,
    hourProfile: 'focused',
    keywords: [/\bdaily (?:tasks|checks?)\b/iu, /\binspections?\b/iu, /van checks?/iu, /plant checks?/iu, /hgv checks?/iu],
    paths: [
      'app/(dashboard)/van-inspections/',
      'app/(dashboard)/plant-inspections/',
      'app/(dashboard)/hgv-inspections/',
      'app/api/van-inspections/',
      'app/api/plant-inspections/',
      'app/api/hgv-inspections/',
      'inspection-photos',
    ],
    areaKeys: ['daily-tasks'],
  },
  {
    id: 'timesheets-payroll',
    label: 'Timesheets, payroll and job codes',
    isSupport: false,
    hourProfile: 'focused',
    keywords: [/\btimesheets?\b/iu, /\bpayroll\b/iu, /job codes?/iu, /plant timesheet/iu],
    paths: ['app/(dashboard)/timesheets/', 'app/api/timesheets/', 'lib/server/timesheet-', 'manual-legacy-job-codes'],
    areaKeys: ['timesheets'],
  },
  {
    id: 'absence-approvals',
    label: 'Absence, leave and approvals',
    isSupport: false,
    hourProfile: 'major',
    keywords: [/\babsence\b/iu, /\bleave\b/iu, /\bapprovals?\b/iu, /allowance/iu, /work shifts?/iu],
    paths: [
      'app/(dashboard)/absence/',
      'app/(dashboard)/approvals/',
      'app/api/absence/',
      'app/api/approvals/',
      'lib/server/absence-',
      'processed-absence',
    ],
    areaKeys: ['absence', 'approvals'],
  },
  {
    id: 'workshop-tasks',
    label: 'Workshop tasks and attachments',
    isSupport: false,
    hourProfile: 'major',
    keywords: [/\bworkshop\b/iu, /workshop attachments?/iu],
    paths: ['app/(dashboard)/workshop-tasks/', 'app/api/workshop-tasks/', 'lib/server/workshop-', 'workshop_'],
    areaKeys: ['workshop-tasks'],
  },
  {
    id: 'fleet-maintenance',
    label: 'Fleet, plant and maintenance',
    isSupport: false,
    hourProfile: 'focused',
    keywords: [/\bfleet\b/iu, /\bmaintenance\b/iu, /\bdvla\b/iu, /plant retir/iu, /vehicle maintenance/iu],
    paths: [
      'app/(dashboard)/fleet/',
      'app/(dashboard)/maintenance/',
      'app/api/maintenance/',
      'app/api/admin/vans/',
      'app/api/admin/hgvs/',
      'app/api/admin/plant/',
      'fleet-tracker',
    ],
    areaKeys: ['fleet', 'maintenance'],
  },
  {
    id: 'projects-rams',
    label: 'Projects and RAMS documents',
    isSupport: false,
    hourProfile: 'focused',
    keywords: [/\brams\b/iu, /\bprojects?\b/iu, /risk assessment/iu, /method statement/iu],
    paths: ['app/(dashboard)/projects/', 'app/(dashboard)/rams/', 'app/api/projects/', 'app/api/rams/'],
    areaKeys: ['projects'],
  },
  {
    id: 'reports',
    label: 'Reports and operational exports',
    isSupport: false,
    hourProfile: 'focused',
    keywords: [/\breports?\b/iu, /operational exports?/iu, /conversion funnel/iu, /usage analytics/iu],
    paths: ['app/(dashboard)/reports/', 'app/api/reports/', '-report.ts', 'user-analytics'],
    areaKeys: ['reports'],
  },
  {
    id: 'help-faq',
    label: 'Help and FAQ catalogue',
    isSupport: false,
    hourProfile: 'focused',
    keywords: [/\bfaq\b/iu, /help catalogue/iu, /help and faq/iu, /help articles?/iu],
    paths: ['app/(dashboard)/help/', 'app/(dashboard)/admin/faq/', 'app/api/admin/faq/', 'scripts/help/'],
    areaKeys: ['help'],
  },
  {
    id: 'training-actions',
    label: 'Training, toolbox talks and actions',
    isSupport: false,
    hourProfile: 'focused',
    keywords: [/\btraining\b/iu, /toolbox talks?/iu, /\bactions?\b/iu],
    paths: [
      'app/(dashboard)/training/',
      'app/(dashboard)/toolbox-talks/',
      'app/(dashboard)/actions/',
      'app/api/training/',
      'app/api/toolbox-talks/',
      'app/api/actions/',
    ],
    areaKeys: ['training', 'toolbox-talks', 'actions'],
  },
  {
    id: 'platform-access-admin',
    label: 'Platform access, dashboard and administration',
    isSupport: false,
    hourProfile: 'major',
    keywords: [
      /forest (?:production )?(?:platform|foundation|bootstrap)/iu,
      /\bauth(?:entication)?\b/iu,
      /\bwebauthn\b/iu,
      /\bsign[ -]?in\b/iu,
      /\bdashboard\b/iu,
      /\bnavigation\b/iu,
      /user management/iu,
      /admin settings/iu,
      /permission matrix/iu,
      /sensitive access/iu,
    ],
    paths: [
      'app/(auth)/',
      'app/(dashboard)/dashboard/',
      'app/(dashboard)/admin/users/',
      'app/(dashboard)/admin/settings/',
      'app/(dashboard)/profile/',
      'app/api/auth/',
      'components/layout/',
      'lib/server/app-auth/',
      'lib/server/webauthn/',
      'sensitive-pin',
      'scripts/production/bootstrap-forest-farm',
    ],
    areaKeys: ['dashboard', 'navigation', 'user-management', 'admin-settings', 'profile', 'sign-in', 'debug'],
  },
  {
    id: 'reminders-notifications',
    label: 'Reminders and notifications',
    isSupport: false,
    hourProfile: 'focused',
    keywords: [/\breminders?\b/iu, /\bnotifications?\b/iu, /notification preferences/iu],
    paths: [
      'app/(dashboard)/reminders/',
      'app/(dashboard)/notifications/',
      'app/api/reminders/',
      'app/api/notifications/',
      'app/api/messages/',
      'lib/server/notifications',
    ],
    areaKeys: ['reminders', 'notifications'],
  },
  {
    id: 'other-development',
    label: 'Other development',
    isSupport: false,
    hourProfile: 'fallback',
    keywords: [],
    paths: [],
    areaKeys: [],
  },
];
const PRIORITIZED_CLUSTER_IDS = [
  'error-support',
  'job-scheduling',
  ...CLUSTER_DEFINITIONS
    .map((definition) => definition.id)
    .filter((id) => id !== 'error-support' && id !== 'job-scheduling'),
];
const CLUSTER_PRIORITY = new Map(
  PRIORITIZED_CLUSTER_IDS.map((id, index) => [id, index]),
);

const COMPLETION_PATTERN = /\b(implemented|completed|complete|committed|pushed|verification passed|tests passed|migration applied)\b/iu;
const CANCELLATION_PATTERN = /\b(cancel(?:led)?|leave (?:it|this|the [^.!?\n]{1,120}) as it is|forget (?:it|about)|do not implement|not completed)\b/iu;
const ADMIN_INVOICE_PATTERN = /\b(invoice bullets?|createinvoice|invoice summary|invoice generation)\b/iu;
const INVOICE_AUTOMATION_COMMIT_PATTERN = /\b(invoice generation|createinvoice|create-invoice)\b/iu;
const READ_ONLY_REVIEW_PATTERN = /\b(read-only review|review of Cursor parent chat transcripts|return a concise evidence table|thoroughness:\s*(?:quick|medium|very thorough))\b/iu;
const MUTATING_TOOL_NAMES = new Set([
  'ApplyPatch',
  'Delete',
  'EditNotebook',
  'Write',
  'StrReplace',
  'MultiEdit',
]);
const INTERNAL_COMMIT_PATTERNS = [
  /^chore\(cursor\):/iu,
  /^chore\(repo\):/iu,
  /^chore\(finalise\):/iu,
  /^chore\(release\):/iu,
  /^chore\(readme-md\):/iu,
];
const EXTERNAL_OR_INHERITED_COMMIT_PATTERNS = [
  /^chore\(demo\):/iu,
];
const RELEASE_METADATA_PATHS = new Set([
  'lib/config/release-version.json',
  'lib/config/release-history.json',
  'docs_private/release-log.md',
]);
const DEFAULT_TRANSCRIPTS_ROOT = path.join(
  homedir(),
  '.cursor',
  'projects',
  'd-Websites-ffts',
  'agent-transcripts',
);

function readFlagValue(args: string[], flag: string): string | undefined {
  const equalsPrefix = `${flag}=`;
  const equalsArg = args.find((arg) => arg.startsWith(equalsPrefix));
  if (equalsArg) {
    const value = equalsArg.slice(equalsPrefix.length);
    if (!value) throw new Error(`${flag} requires a value.`);
    return value;
  }

  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return value;
}

function parseBooleanFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Expected true or false, received "${value}".`);
}

function parsePositiveNumber(value: string | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
  return parsed;
}

export function parseIsoDay(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error(`${label} must use YYYY-MM-DD format.`);
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} is not a valid calendar date.`);
  }

  return value;
}

export function validateDateRange(range: InvoiceDateRange): InvoiceDateRange {
  const from = parseIsoDay(range.from, 'Start date');
  const to = parseIsoDay(range.to, 'End date');
  if (from > to) {
    throw new Error('Start date must be on or before end date.');
  }
  return { from, to };
}

export function isDayInRange(day: string, range: InvoiceDateRange): boolean {
  return day >= range.from && day <= range.to;
}

export function calculateLineValue(hours: number, rate: number): number {
  return Math.round(hours * rate * 100) / 100;
}

export function parseCreateInvoiceArgs(
  args: string[],
  repositoryRoot = process.cwd(),
): CreateInvoiceOptions {
  const from = readFlagValue(args, '--from');
  const to = readFlagValue(args, '--to');
  if (!from || !to) {
    throw new Error('Both --from and --to are required.');
  }

  const range = validateDateRange({ from, to });
  return {
    ...range,
    rate: parsePositiveNumber(readFlagValue(args, '--rate'), 28, 'Development rate'),
    supportRate: parsePositiveNumber(readFlagValue(args, '--support-rate'), 5, 'Support rate'),
    includeUnpushed: parseBooleanFlag(readFlagValue(args, '--include-unpushed'), true),
    outputDirectory: path.resolve(
      repositoryRoot,
      readFlagValue(args, '--output-dir') ?? 'docs_private/invoices',
    ),
    repositoryRoot: path.resolve(repositoryRoot),
    transcriptsRoot: path.resolve(
      readFlagValue(args, '--transcripts-dir') ??
        process.env.CURSOR_AGENT_TRANSCRIPTS_DIR ??
        DEFAULT_TRANSCRIPTS_ROOT,
    ),
  };
}

function runGit(repositoryRoot: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
}

function normalizePath(value: string): string {
  return value.replace(/\\/gu, '/').toLowerCase();
}

function findClusterIds(
  text: string,
  files: string[] = [],
  areaKeys: string[] = [],
  areas: string[] = [],
): string[] {
  const normalizedFiles = files.map(normalizePath);
  const normalizedAreaKeys = areaKeys.map((value) => value.trim().toLowerCase());
  const evidenceText = `${text} ${areas.join(' ')}`;
  const areaMatches = CLUSTER_DEFINITIONS
    .filter((candidate) =>
      candidate.id !== 'other-development' &&
      candidate.areaKeys.some((areaKey) => normalizedAreaKeys.includes(areaKey)),
    )
    .sort((left, right) =>
      (CLUSTER_PRIORITY.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (CLUSTER_PRIORITY.get(right.id) ?? Number.MAX_SAFE_INTEGER),
    );
  if (areaMatches.length > 0) return areaMatches.map((definition) => definition.id);

  const matches = CLUSTER_DEFINITIONS.flatMap((candidate) => {
    if (candidate.id === 'other-development') return [];
    const hasKeywordMatch = candidate.keywords.some((pattern) => pattern.test(evidenceText));
    const hasPathMatch = candidate.paths.some((fragment) =>
      normalizedFiles.some((file) => file.includes(fragment.toLowerCase())),
    );
    if (!hasKeywordMatch && !hasPathMatch) return [];
    const score = candidate.isSupport && hasKeywordMatch
      ? 4
      : hasPathMatch
        ? 2
        : 1;
    return [{ definition: candidate, score }];
  });

  if (matches.length === 0) return ['other-development'];

  const highestScore = Math.max(...matches.map((match) => match.score));
  return matches
    .filter((match) => match.score === highestScore)
    .sort((left, right) =>
      (CLUSTER_PRIORITY.get(left.definition.id) ?? Number.MAX_SAFE_INTEGER) -
      (CLUSTER_PRIORITY.get(right.definition.id) ?? Number.MAX_SAFE_INTEGER),
    )
    .map((match) => match.definition.id);
}

export function classifyWorkCluster(text: string, files: string[] = []): string {
  return findClusterIds(text, files)[0] ?? 'other-development';
}

export function parseGitLogOutput(
  output: string,
  unpushedHashes: Set<string>,
): CommitEvidence[] {
  return output
    .split('\u001e')
    .map((section) => section.trim())
    .filter(Boolean)
    .map((section) => {
      const lines = section.split(/\r?\n/u);
      const [hash = '', committedAt = '', subject = ''] = (lines.shift() ?? '').split('\u001f');
      const files: string[] = [];
      let additions = 0;
      let deletions = 0;

      for (const line of lines) {
        const [added, removed, file] = line.split('\t');
        if (!file) continue;
        files.push(file);
        additions += added === '-' ? 0 : Number(added) || 0;
        deletions += removed === '-' ? 0 : Number(removed) || 0;
      }

      const testOnly = files.length > 0 && files.every((file) =>
        /^(tests|testsuite)\//u.test(normalizePath(file)),
      );
      const releaseMetadataOnly = files.length > 0 && files.every((file) =>
        RELEASE_METADATA_PATHS.has(normalizePath(file)),
      );
      let excludedReason: string | undefined;
      if (/\[skip version\]/iu.test(subject)) excludedReason = 'duplicate release metadata';
      else if (/^(merge:|merge pull request)/iu.test(subject)) excludedReason = 'merge-only commit';
      else if (INVOICE_AUTOMATION_COMMIT_PATTERN.test(`${subject} ${files.join(' ')}`)) {
        excludedReason = 'invoice administration automation';
      } else if (INTERNAL_COMMIT_PATTERNS.some((pattern) => pattern.test(subject))) {
        excludedReason = 'internal repository tooling';
      } else if (EXTERNAL_OR_INHERITED_COMMIT_PATTERNS.some((pattern) => pattern.test(subject))) {
        excludedReason = 'external or inherited-project setup';
      } else if (releaseMetadataOnly) {
        excludedReason = 'version-only release metadata';
      } else if (testOnly) {
        excludedReason = 'test-only maintenance';
      }

      return {
        hash,
        shortHash: hash.slice(0, 8),
        committedAt,
        date: committedAt.slice(0, 10),
        subject,
        files,
        additions,
        deletions,
        isUnpushed: unpushedHashes.has(hash),
        clusterId: classifyWorkCluster(subject, files),
        excludedReason,
      };
    });
}

export function collectGitCommits(options: CreateInvoiceOptions): {
  included: CommitEvidence[];
  excluded: CommitEvidence[];
} {
  const unpushedHashes = new Set(
    runGit(options.repositoryRoot, ['rev-list', 'origin/main..HEAD'])
      .split(/\r?\n/u)
      .map((hash) => hash.trim())
      .filter(Boolean),
  );
  const output = runGit(options.repositoryRoot, [
    'log',
    `--since=${options.from}T00:00:00`,
    `--until=${options.to}T23:59:59`,
    '--date=iso-strict',
    '--pretty=format:%x1e%H%x1f%aI%x1f%s',
    '--numstat',
  ]);
  const commits = parseGitLogOutput(output, unpushedHashes);

  const included: CommitEvidence[] = [];
  const excluded: CommitEvidence[] = [];
  for (const commit of commits) {
    if (!options.includeUnpushed && commit.isUnpushed) {
      excluded.push({ ...commit, excludedReason: 'completed locally but not pushed' });
    } else if (commit.excludedReason) {
      excluded.push(commit);
    } else {
      included.push(commit);
    }
  }
  return { included, excluded };
}

export function collectReleases(options: CreateInvoiceOptions): ReleaseEvidence[] {
  const releaseHistoryPath = path.join(
    options.repositoryRoot,
    'lib',
    'config',
    'release-history.json',
  );
  const releaseLogPath = path.join(options.repositoryRoot, 'docs_private', 'release-log.md');
  const entries = JSON.parse(readFileSync(releaseHistoryPath, 'utf8')) as ReleaseHistoryEntry[];
  const releaseLogEntries = existsSync(releaseLogPath)
    ? parseReleaseLog(readFileSync(releaseLogPath, 'utf8'))
    : new Map<string, ReleaseLogEntry>();

  return entries
    .filter((entry): entry is ReleaseHistoryEntry & { pushedAt: string } =>
      typeof entry.pushedAt === 'string' &&
      isDayInRange(entry.pushedAt.slice(0, 10), options),
    )
    .map((entry) => {
      const releaseLogEntry = releaseLogEntries.get(entry.version);
      const details = entry.details ?? [];
      const areas = entry.areas ?? [];
      const releaseText = [
        entry.title,
        entry.description,
        ...details,
        ...areas,
        ...(releaseLogEntry?.commitSubjects ?? []),
      ].join(' ');
      return {
        version: entry.version,
        pushedAt: entry.pushedAt,
        date: entry.pushedAt.slice(0, 10),
        title: entry.title,
        description: entry.description,
        details,
        areas,
        clusterIds: findClusterIds(releaseText, [], entry.areaKeys ?? [], areas),
        releaseLogCommitSubjects: releaseLogEntry?.commitSubjects ?? [],
        sourceReferences: [
          'lib/config/release-history.json',
          ...(releaseLogEntry ? ['docs_private/release-log.md'] : []),
        ],
      };
    })
    .sort((a, b) => a.pushedAt.localeCompare(b.pushedAt));
}

export function parseReleaseLog(markdown: string): Map<string, ReleaseLogEntry> {
  const entries = new Map<string, ReleaseLogEntry>();
  const sections = markdown.split(/^##\s+/gmu).slice(1);

  for (const section of sections) {
    const [heading = '', ...bodyLines] = section.split(/\r?\n/u);
    const version = heading.trim().split(/\s+/u)[0];
    if (!/^\d{4}\.\d+\.\d+$/u.test(version)) continue;
    const body = bodyLines.join('\n');
    const pushedAtMatch = body.match(
      /\*\*PUSHED AT\*\*\s*\n([^\n]+)/u,
    );
    const commitSection = body.match(
      /\*\*COMMITS IN THIS RELEASE\*\*\s*\n([\s\S]*?)(?=\n\*\*|\n##|\s*$)/u,
    );
    const commitSubjects = commitSection
      ? [...commitSection[1].matchAll(/^-\s+`([^`]+)`/gmu)].map((match) => match[1])
      : [];

    entries.set(version, {
      version,
      pushedAt: pushedAtMatch?.[1]?.trim(),
      commitSubjects,
    });
  }

  return entries;
}

function extractContentBlocks(content: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(content)) return [];
  return content.filter(
    (block): block is Record<string, unknown> =>
      typeof block === 'object' && block !== null,
  );
}

function extractMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  return extractContentBlocks(content)
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => String(block.text))
    .join('\n');
}

function extractToolNames(content: unknown): string[] {
  return extractContentBlocks(content)
    .filter((block) => block.type === 'tool_use' && typeof block.name === 'string')
    .map((block) => String(block.name));
}

function extractTimestampDays(text: string): string[] {
  const results: string[] = [];
  const pattern = /<timestamp>([\s\S]*?)<\/timestamp>/gu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const parsed = new Date(match[1].trim());
    if (!Number.isNaN(parsed.getTime())) results.push(parsed.toISOString().slice(0, 10));
  }
  return results;
}

function cleanRequest(value: string): string {
  return value
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\[Image\]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function extractUserQueries(text: string): string[] {
  const queries: string[] = [];
  const pattern = /<user_query>([\s\S]*?)<\/user_query>/gu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const query = cleanRequest(match[1]);
    if (query) queries.push(query);
  }
  return queries;
}

export function isParentTranscriptPath(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  if (normalized.includes('/subagents/')) return false;
  const fileName = path.basename(filePath, '.jsonl');
  return path.basename(path.dirname(filePath)) === fileName;
}

export function parseParentTranscript(
  filePath: string,
  range: InvoiceDateRange,
): ChatEvidence | null {
  if (!isParentTranscriptPath(filePath)) return null;
  const raw = readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/u).filter(Boolean);
  const datedUserQueries: Array<{ day: string; query: string }> = [];
  const assistantTexts: string[] = [];
  const cancellationSignals: string[] = [];
  let userTurns = 0;
  let assistantTurns = 0;
  let toolUses = 0;
  let mutationToolUses = 0;

  for (const line of lines) {
    let parsed: ParsedTranscriptLine;
    try {
      parsed = JSON.parse(line) as ParsedTranscriptLine;
    } catch {
      continue;
    }

    const content = parsed.message?.content;
    const text = extractMessageText(content);
    const tools = extractToolNames(content);
    toolUses += tools.length;
    mutationToolUses += tools.filter((tool) => MUTATING_TOOL_NAMES.has(tool)).length;

    if (parsed.role === 'user') {
      userTurns += 1;
      const days = extractTimestampDays(text);
      const day = days[0];
      if (day && isDayInRange(day, range)) {
        for (const query of extractUserQueries(text)) {
          datedUserQueries.push({ day, query });
          if (CANCELLATION_PATTERN.test(query)) cancellationSignals.push(query);
        }
      }
    } else if (parsed.role === 'assistant') {
      assistantTurns += 1;
      assistantTexts.push(text);
    }
  }

  if (datedUserQueries.length === 0) return null;

  const requests = datedUserQueries.map(({ query }) => query);
  const relevantDays = datedUserQueries.map(({ day }) => day).sort();
  const completionFound = assistantTexts.some((text) => COMPLETION_PATTERN.test(text));
  let completionStatus: ChatCompletionStatus = 'unknown';
  if (completionFound && cancellationSignals.length > 0) completionStatus = 'mixed';
  else if (completionFound) completionStatus = 'completed';
  else if (mutationToolUses === 0) completionStatus = 'planning-only';

  const joinedRequests = requests.join(' ');
  return {
    id: path.basename(filePath, '.jsonl'),
    firstDate: relevantDays[0],
    lastDate: relevantDays[relevantDays.length - 1],
    title: requests[0].slice(0, 120),
    requests,
    userTurns,
    assistantTurns,
    toolUses,
    mutationToolUses,
    characterCount: raw.length,
    completionStatus,
    cancellationSignals,
    clusterId: classifyWorkCluster(joinedRequests),
    isAdministrative: ADMIN_INVOICE_PATTERN.test(joinedRequests),
    isReviewOnly: READ_ONLY_REVIEW_PATTERN.test(joinedRequests),
  };
}

export function collectParentChats(options: CreateInvoiceOptions): {
  included: ChatEvidence[];
  excluded: ChatEvidence[];
} {
  if (!existsSync(options.transcriptsRoot)) {
    throw new Error(`Cursor transcript directory not found: ${options.transcriptsRoot}`);
  }

  const included: ChatEvidence[] = [];
  const excluded: ChatEvidence[] = [];
  for (const directoryName of readdirSync(options.transcriptsRoot)) {
    const filePath = path.join(
      options.transcriptsRoot,
      directoryName,
      `${directoryName}.jsonl`,
    );
    if (!existsSync(filePath)) continue;
    const evidence = parseParentTranscript(filePath, options);
    if (!evidence) continue;

    if (
      evidence.isAdministrative ||
      evidence.isReviewOnly ||
      evidence.completionStatus === 'planning-only' ||
      evidence.completionStatus === 'unknown'
    ) {
      excluded.push(evidence);
    } else {
      included.push(evidence);
    }
  }

  return {
    included: included.sort((a, b) => a.firstDate.localeCompare(b.firstDate)),
    excluded: excluded.sort((a, b) => a.firstDate.localeCompare(b.firstDate)),
  };
}

function clampHours(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function calculateComplexityBand(
  cluster: Omit<
    WorkClusterEvidence,
    'complexityScore' | 'recommendedHours' | 'calibrationRationale' | 'suggestedHoursBand'
  >,
): Pick<
  WorkClusterEvidence,
  'complexityScore' | 'recommendedHours' | 'calibrationRationale' | 'suggestedHoursBand'
> {
  const score =
    cluster.commits.length * 0.8 +
    cluster.changedFiles * 0.08 +
    (cluster.additions + cluster.deletions) / 900 +
    cluster.migrationFiles * 1.5 +
    cluster.testFiles * 0.15 +
    cluster.transcriptTurns * 0.04 +
    cluster.transcriptCharacters / 200_000;
  const roundedScore = Math.round(score * 10) / 10;
  const definition = CLUSTER_DEFINITIONS.find((candidate) => candidate.id === cluster.id);
  const hourProfile = definition?.hourProfile ?? 'fallback';
  const evidenceUnits =
    cluster.chats.length * 1.25 +
    cluster.commits.length * 0.75 +
    cluster.migrationFiles * 0.5 +
    Math.min(cluster.changedFiles, 20) * 0.03;
  const hasMajorScope =
    hourProfile === 'major' &&
    (
      (cluster.migrationFiles > 0 && cluster.changedFiles >= 8) ||
      cluster.commits.length >= 3 ||
      cluster.chats.length >= 3
    );

  let recommendedHours: number;
  let calibrationRationale: string;
  let suggestedHoursBand: WorkClusterEvidence['suggestedHoursBand'];

  if (hourProfile === 'support') {
    recommendedHours = clampHours(evidenceUnits, 2, 6);
    suggestedHoursBand = {
      minimum: Math.max(2, recommendedHours - 1),
      maximum: recommendedHours,
    };
    calibrationRationale = 'Group explicit production remediation into one support allowance capped at six hours.';
  } else if (hasMajorScope) {
    recommendedHours = clampHours(4 + evidenceUnits * 0.25, 5, 6);
    suggestedHoursBand = { minimum: 5, maximum: 6 };
    calibrationRationale = 'Major module evidence uses the conservative accepted five-to-six-hour total band.';
  } else if (hourProfile === 'fallback') {
    recommendedHours = clampHours(evidenceUnits, 2, 4);
    suggestedHoursBand = {
      minimum: Math.max(2, recommendedHours - 1),
      maximum: recommendedHours,
    };
    calibrationRationale = 'Use a conservative fallback allowance only where FFTS evidence has no clearer work area.';
  } else {
    recommendedHours = clampHours(evidenceUnits, 2, 3);
    suggestedHoursBand = {
      minimum: Math.max(2, recommendedHours - 1),
      maximum: recommendedHours,
    };
    calibrationRationale = 'Focused FFTS refinements use a conservative two-to-three-hour total allowance.';
  }

  return {
    complexityScore: roundedScore,
    recommendedHours,
    calibrationRationale,
    suggestedHoursBand,
  };
}

export function buildWorkClusters(
  releases: ReleaseEvidence[],
  commits: CommitEvidence[],
  chats: ChatEvidence[],
): WorkClusterEvidence[] {
  return CLUSTER_DEFINITIONS
    .map((definition) => {
      const matchingReleases = releases.filter((release) => release.clusterIds.includes(definition.id));
      const matchingCommits = commits.filter((commit) => commit.clusterId === definition.id);
      const matchingChats = chats.filter((chat) => chat.clusterId === definition.id);
      const files = new Set(matchingCommits.flatMap((commit) => commit.files));
      const dates = new Set([
        ...matchingReleases.map((release) => release.date),
        ...matchingCommits.map((commit) => commit.date),
        ...matchingChats.flatMap((chat) => [chat.firstDate, chat.lastDate]),
      ]);
      const base = {
        id: definition.id,
        label: definition.label,
        isSupport: definition.isSupport,
        releases: matchingReleases.map((release) => release.version),
        commits: matchingCommits.map((commit) => commit.hash),
        chats: matchingChats.map((chat) => chat.id),
        dates: [...dates].sort(),
        additions: matchingCommits.reduce((sum, commit) => sum + commit.additions, 0),
        deletions: matchingCommits.reduce((sum, commit) => sum + commit.deletions, 0),
        changedFiles: files.size,
        migrationFiles: [...files].filter((file) => /supabase\/migrations\//u.test(normalizePath(file))).length,
        testFiles: [...files].filter((file) => /^(tests|testsuite)\//u.test(normalizePath(file))).length,
        transcriptCharacters: matchingChats.reduce((sum, chat) => sum + chat.characterCount, 0),
        transcriptTurns: matchingChats.reduce(
          (sum, chat) => sum + chat.userTurns + chat.assistantTurns,
          0,
        ),
        hasUnpushedWork: matchingCommits.some((commit) => commit.isUnpushed),
      };
      return {
        ...base,
        ...calculateComplexityBand(base),
      };
    })
    .filter((cluster) =>
      cluster.commits.length > 0 ||
      cluster.chats.length > 0 ||
      (cluster.releases.length > 0 && cluster.id !== 'other-development'),
    )
    .sort((a, b) => (a.dates[0] ?? '').localeCompare(b.dates[0] ?? ''));
}

export function buildInvoiceEvidence(options: CreateInvoiceOptions): InvoiceEvidenceReport {
  const releases = collectReleases(options);
  const commitResult = collectGitCommits(options);
  const chatResult = collectParentChats(options);
  const clusters = buildWorkClusters(releases, commitResult.included, chatResult.included);

  return {
    generatedAt: new Date().toISOString(),
    period: { from: options.from, to: options.to },
    pricing: {
      developmentRate: options.rate,
      supportRate: options.supportRate,
      currency: 'GBP',
    },
    settings: {
      includeUnpushed: options.includeUnpushed,
      exactTokenUsageAvailable: false,
      tokenUsageProxy:
        'Parent transcript character/turn counts, Git change scope, migrations, tests, iterations, and prior invoice charging bands.',
    },
    summary: {
      releases: releases.length,
      substantiveCommits: commitResult.included.length,
      excludedCommits: commitResult.excluded.length,
      completedOrMixedChats: chatResult.included.length,
      planningOrUnknownChats: chatResult.excluded.length,
      unpushedCommits: commitResult.included.filter((commit) => commit.isUnpushed).length,
    },
    releases,
    commits: commitResult.included,
    chats: chatResult.included,
    clusters,
    exclusions: {
      commits: commitResult.excluded,
      chats: chatResult.excluded,
    },
  };
}

function formatMoney(value: number): string {
  return `£${value.toFixed(2)}`;
}

export function renderEvidenceMarkdown(report: InvoiceEvidenceReport): string {
  const lines: string[] = [
    `# Invoice evidence: ${report.period.from} to ${report.period.to}`,
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Pricing',
    '',
    `- Development rate: ${formatMoney(report.pricing.developmentRate)}/hour`,
    `- Support rate: ${formatMoney(report.pricing.supportRate)}/hour`,
    `- Include completed unpushed work: ${report.settings.includeUnpushed ? 'Yes' : 'No'}`,
    '- Exact token counts: unavailable; transcript scope and iteration counts are recorded as a proxy.',
    '',
    '## Evidence summary',
    '',
    `- Production releases: ${report.summary.releases}`,
    `- Substantive commits: ${report.summary.substantiveCommits}`,
    `- Excluded commits: ${report.summary.excludedCommits}`,
    `- Completed/mixed parent chats: ${report.summary.completedOrMixedChats}`,
    `- Planning/unknown parent chats: ${report.summary.planningOrUnknownChats}`,
    `- Included unpushed commits: ${report.summary.unpushedCommits}`,
    '',
    '## Suggested work clusters',
    '',
  ];

  for (const cluster of report.clusters) {
    lines.push(
      `### ${cluster.label}`,
      '',
      `- Dates: ${cluster.dates.join(', ') || 'No dated evidence'}`,
      `- Releases: ${cluster.releases.join(', ') || 'None'}`,
      `- Commits: ${cluster.commits.length}`,
      `- Parent chats: ${cluster.chats.length}`,
      `- Change scope: ${cluster.changedFiles} files, +${cluster.additions}/-${cluster.deletions}`,
      `- Migrations/tests: ${cluster.migrationFiles}/${cluster.testFiles}`,
      `- Transcript proxy: ${cluster.transcriptTurns} turns, ${cluster.transcriptCharacters} characters`,
      `- Complexity score: ${cluster.complexityScore}`,
      `- Calibrated recommended hours: ${cluster.recommendedHours}`,
      `- Suggested hours band: ${cluster.suggestedHoursBand.minimum}–${cluster.suggestedHoursBand.maximum}`,
      `- Calibration: ${cluster.calibrationRationale}`,
      `- Contains completed unpushed work: ${cluster.hasUnpushedWork ? 'Yes' : 'No'}`,
      '',
    );
  }

  lines.push('## Included commits', '');
  for (const commit of report.commits) {
    lines.push(
      `- ${commit.date} \`${commit.shortHash}\` ${commit.subject}${commit.isUnpushed ? ' (completed locally, not pushed)' : ''}`,
    );
  }

  lines.push('', '## Included parent chats', '');
  for (const chat of report.chats) {
    lines.push(
      `- ${chat.firstDate}${chat.lastDate !== chat.firstDate ? `–${chat.lastDate}` : ''} \`${chat.id}\` ${chat.title} (${chat.completionStatus})`,
    );
  }

  lines.push('', '## Exclusions requiring agent review', '');
  for (const commit of report.exclusions.commits) {
    lines.push(`- Commit \`${commit.shortHash}\`: ${commit.excludedReason ?? 'excluded'}`);
  }
  for (const chat of report.exclusions.chats) {
    const reason = chat.isAdministrative
      ? 'invoice administration'
      : chat.isReviewOnly
        ? 'read-only evidence review'
        : chat.completionStatus;
    lines.push(
      `- Chat \`${chat.id}\`: ${reason}`,
    );
  }

  lines.push(
    '',
    '## Agent instructions',
    '',
    '- Deduplicate release, commit, and chat evidence before drafting invoice lines.',
    '- Exclude cancelled sub-work even when its parent chat contains other completed work.',
    '- Use customer-facing outcomes, not technical commit language.',
    '- Keep development and production-support pricing separate.',
    '- Save the final copy-ready Markdown beside this evidence report.',
    '',
  );
  return lines.join('\n');
}

export function writeInvoiceEvidence(
  report: InvoiceEvidenceReport,
  outputDirectory: string,
): { jsonPath: string; markdownPath: string } {
  mkdirSync(outputDirectory, { recursive: true });
  const stem = `invoice-${report.period.from}-to-${report.period.to}`;
  const jsonPath = path.join(outputDirectory, `${stem}-evidence.json`);
  const markdownPath = path.join(outputDirectory, `${stem}-evidence.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(markdownPath, renderEvidenceMarkdown(report), 'utf8');
  return { jsonPath, markdownPath };
}

function printUsage(): void {
  console.log([
    'Usage:',
    '  npm run createinvoice -- --from YYYY-MM-DD --to YYYY-MM-DD [options]',
    '',
    'Options:',
    '  --rate <number>                 Development hourly rate (default: 28)',
    '  --support-rate <number>         Support hourly rate (default: 5)',
    '  --include-unpushed <true|false> Include completed local commits (default: true)',
    '  --transcripts-dir <path>        Override Cursor transcript directory',
    '  --output-dir <path>             Output directory (default: docs_private/invoices)',
  ].join('\n'));
}

export function main(args = process.argv.slice(2)): void {
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  const options = parseCreateInvoiceArgs(args);
  const report = buildInvoiceEvidence(options);
  const output = writeInvoiceEvidence(report, options.outputDirectory);
  console.log(`Invoice evidence generated for ${options.from} to ${options.to}.`);
  console.log(`Evidence JSON: ${path.relative(options.repositoryRoot, output.jsonPath)}`);
  console.log(`Evidence Markdown: ${path.relative(options.repositoryRoot, output.markdownPath)}`);
  console.log(
    `Found ${report.summary.releases} releases, ${report.summary.substantiveCommits} substantive commits, and ${report.summary.completedOrMixedChats} completed/mixed parent chats.`,
  );
}

const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedFile && fileURLToPath(import.meta.url) === invokedFile) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`createinvoice failed: ${message}`);
    process.exitCode = 1;
  }
}
