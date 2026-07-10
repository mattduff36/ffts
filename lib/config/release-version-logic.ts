import {
  getFriendlyReleaseScopeLabel,
  getReleaseAreasFromScopes,
  getReleaseDescriptorByArea,
  getReleaseDescriptorByScope,
  uniqueReleaseValues,
} from './release-module-descriptors';

export interface ReleaseVersionState {
  mmyy: string;
  major: number;
  minor: number;
  lastProcessedSha: string;
}

export interface ParsedCommit {
  raw: string;
  type: string;
  scope: string | null;
  subject: string;
  isBreaking: boolean;
}

export type VersionBumpKind = 'major' | 'minor' | 'month_reset' | 'none';

export type ReleaseHistoryUpdateKind = 'major' | 'minor';

export interface ParsedReleaseLogEntry {
  version: string;
  primaryCommitMessage: string | null;
  whatChanged: string;
  detailBullets: string[];
  commitMessages: string[];
  pushedAt: string | null;
}

export interface ReleaseHistoryEntry {
  version: string;
  updateKind: ReleaseHistoryUpdateKind;
  title: string;
  description: string;
  summary: string;
  details: string[];
  areas: string[];
  areaKeys?: string[];
  pushedAt: string | null;
}

export interface ReleaseHistoryMonthOption {
  key: string;
  label: string;
}

const CONVENTIONAL_COMMIT_PATTERN =
  /^([a-z]+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/iu;

const MAJOR_TYPES = new Set(['feat']);
const MINOR_TYPES = new Set(['fix', 'chore', 'docs', 'test', 'refactor', 'perf', 'style']);
const SKIP_VERSION_MARKER = '[skip version]';
const RELEASE_VERSION_HEADING_PATTERN = /^##\s+(\d{4}\.\d+\.\d+)\s*$/gmu;
const DEFAULT_RELEASE_HISTORY_MONTH_LIMIT = 4;
const RELEASE_LOG_LABELS = new Set([
  '**GIT COMMIT MESSAGE**',
  '**PUSHED AT**',
  '**WHAT CHANGED**',
  '**VERSION HISTORY DETAILS**',
  '**COMMITS IN THIS RELEASE**',
]);
const FRIENDLY_SCOPE_LABELS: Record<string, string> = {
  actions: 'Actions',
  admin: 'Admin settings',
  analytics: 'Usage tracking',
  api: 'Background services',
  app: 'App',
  auth: 'Sign in',
  components: 'App screens',
  customers: 'Customers',
  db: 'Data storage',
  errors: 'Error reporting',
  faq: 'Help articles',
  fleet: 'Fleet',
  help: 'Help and FAQ',
  inspections: 'Daily Tasks',
  'van-inspections': 'Daily Tasks',
  'plant-inspections': 'Daily Tasks',
  'hgv-inspections': 'Daily Tasks',
  inventory: 'Inventory',
  layout: 'Navigation',
  logging: 'Error logging',
  maintenance: 'Maintenance',
  mobile: 'Mobile app',
  pdf: 'PDF documents',
  repo: 'App maintenance',
  tests: 'App reliability',
  timesheets: 'Timesheets',
  workshop: 'Workshop tasks',
  debug: 'Debug tools',
  rams: 'Projects',
  projects: 'Projects',
  absence: 'Absence & Leave',
  'toolbox-talks': 'Toolbox Talks',
  training: 'Training',
  approvals: 'Approvals',
  reports: 'Reports',
  suggestions: 'Suggestions',
  'admin-users': 'User Management',
  'admin-settings': 'Admin Settings',
  reminders: 'Reminders',
  quotes: 'Quotes',
};

export function getCurrentMmyy(date: Date, timeZone = 'Europe/London'): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    month: '2-digit',
    year: '2-digit',
  }).formatToParts(date);

  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const year = parts.find((part) => part.type === 'year')?.value ?? '00';
  return `${month}${year}`;
}

export function formatReleaseVersion(state: Pick<ReleaseVersionState, 'mmyy' | 'major' | 'minor'>): string {
  return `${state.mmyy}.${state.major}.${state.minor}`;
}

export function parseConventionalCommit(message: string): ParsedCommit | null {
  const firstLine = message.split(/\r?\n/u)[0]?.trim() ?? '';
  if (!firstLine || firstLine.includes(SKIP_VERSION_MARKER)) {
    return null;
  }

  const match = CONVENTIONAL_COMMIT_PATTERN.exec(firstLine);
  if (!match) {
    return null;
  }

  const [, rawType, rawScope, breaking, rawSubject] = match;
  const type = (rawType ?? '').toLowerCase();
  const subject = (rawSubject ?? '').trim();
  if (!type || !subject) {
    return null;
  }

  return {
    raw: firstLine,
    type,
    scope: rawScope?.trim() || null,
    subject,
    isBreaking: Boolean(breaking),
  };
}

export function shouldSkipVersionBumpCommit(message: string): boolean {
  return message.toLowerCase().includes(SKIP_VERSION_MARKER);
}

export function isMajorEligibleCommit(commit: ParsedCommit): boolean {
  return commit.isBreaking || MAJOR_TYPES.has(commit.type);
}

export function isMinorEligibleCommit(commit: ParsedCommit): boolean {
  return MINOR_TYPES.has(commit.type);
}

export function parseCommitsFromMessages(messages: string[]): ParsedCommit[] {
  return messages
    .map((message) => parseConventionalCommit(message))
    .filter((commit): commit is ParsedCommit => commit !== null);
}

export function selectPrimaryCommitMessage(commits: ParsedCommit[]): string | null {
  if (commits.length === 0) {
    return null;
  }

  const majorCommit = commits.find((commit) => isMajorEligibleCommit(commit));
  if (majorCommit) {
    return majorCommit.raw;
  }

  const minorCommits = commits.filter((commit) => isMinorEligibleCommit(commit));
  if (minorCommits.length > 0) {
    return minorCommits[minorCommits.length - 1].raw;
  }

  return commits[commits.length - 1].raw;
}

export function selectReleasePrimaryCommitMessage(
  commits: ParsedCommit[],
  bumpKind: VersionBumpKind,
  state: Pick<ReleaseVersionState, 'mmyy'>
): string | null {
  return (
    selectPrimaryCommitMessage(commits) ??
    (bumpKind === 'month_reset' ? `chore(release): reset release version for ${state.mmyy}` : null)
  );
}

export function determineBumpKind(commits: ParsedCommit[]): VersionBumpKind {
  if (commits.length === 0) {
    return 'none';
  }

  if (commits.some((commit) => isMajorEligibleCommit(commit))) {
    return 'major';
  }

  if (commits.some((commit) => isMinorEligibleCommit(commit))) {
    return 'minor';
  }

  return 'none';
}

export function computeNextVersionState(
  current: ReleaseVersionState,
  commits: ParsedCommit[],
  now: Date,
  timeZone = 'Europe/London'
): { next: ReleaseVersionState; bumpKind: VersionBumpKind } {
  const currentMmyy = getCurrentMmyy(now, timeZone);
  const bumpKindFromCommits = determineBumpKind(commits);

  if (current.mmyy !== currentMmyy) {
    return {
      next: {
        mmyy: currentMmyy,
        major: 0,
        minor: 0,
        lastProcessedSha: current.lastProcessedSha,
      },
      bumpKind: 'month_reset',
    };
  }

  if (bumpKindFromCommits === 'none') {
    return {
      next: current,
      bumpKind: 'none',
    };
  }

  if (bumpKindFromCommits === 'major') {
    return {
      next: {
        mmyy: current.mmyy,
        major: current.major + 1,
        minor: 0,
        lastProcessedSha: current.lastProcessedSha,
      },
      bumpKind: 'major',
    };
  }

  return {
    next: {
      mmyy: current.mmyy,
      major: current.major,
      minor: current.minor + 1,
      lastProcessedSha: current.lastProcessedSha,
    },
    bumpKind: 'minor',
  };
}

function humanizeCommitSubject(commit: ParsedCommit): string {
  const subject = commit.subject.trim();
  if (!subject) {
    return commit.raw;
  }

  const normalized = subject.charAt(0).toUpperCase() + subject.slice(1);
  return normalized.endsWith('.') ? normalized : `${normalized}.`;
}

export function buildWhatChangedSummary(commits: ParsedCommit[]): string {
  if (commits.length === 0) {
    return 'No conventional commit details were available for this release.';
  }

  return commits.map(humanizeCommitSubject).join(' ');
}

export function formatReleaseLogEntry(options: {
  version: string;
  primaryCommitMessage: string;
  whatChanged: string;
  releaseDetails?: string[];
  commitMessages: string[];
  pushedAt?: string | null;
}): string {
  const commitBullets = options.commitMessages.map((message) => `- \`${message}\``).join('\n');
  const releaseDetails = uniqueStrings((options.releaseDetails ?? []).map((detail) => ensureSentence(detail)));
  const releaseDetailLines = releaseDetails.length > 0
    ? ['', '**VERSION HISTORY DETAILS**', ...releaseDetails.map((detail) => `- ${detail}`)]
    : [];
  const pushedAtLines = options.pushedAt ? ['', '**PUSHED AT**', options.pushedAt] : [];

  return [
    `## ${options.version}`,
    '',
    '**GIT COMMIT MESSAGE**',
    `\`${options.primaryCommitMessage}\``,
    ...pushedAtLines,
    '',
    '**WHAT CHANGED**',
    options.whatChanged,
    ...releaseDetailLines,
    '',
    '**COMMITS IN THIS RELEASE**',
    commitBullets,
    '',
  ].join('\n');
}

function stripInlineCode(value: string): string {
  return value.trim().replace(/^`|`$/gu, '').trim();
}

function getSectionValue(lines: string[], label: string): string {
  const index = lines.findIndex((line) => line.trim() === label);
  if (index === -1) {
    return '';
  }

  const values: string[] = [];
  for (let lineIndex = index + 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]?.trim() ?? '';
    if (RELEASE_LOG_LABELS.has(line)) {
      break;
    }

    if (!line && values.length > 0) {
      break;
    }

    if (line) {
      values.push(line);
    }
  }

  return values.join(' ').trim();
}

function getBulletValuesFromSection(lines: string[], label: string): string[] {
  const index = lines.findIndex((line) => line.trim() === label);
  if (index === -1) {
    return [];
  }

  const values: string[] = [];
  for (let lineIndex = index + 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]?.trim() ?? '';
    if (!line) {
      if (values.length > 0) break;
      continue;
    }

    if (RELEASE_LOG_LABELS.has(line)) {
      break;
    }

    if (line.startsWith('- ')) {
      values.push(line.slice(2).trim());
    }
  }

  return uniqueStrings(values);
}

function getCommitMessagesFromSection(lines: string[]): string[] {
  return getBulletValuesFromSection(lines, '**COMMITS IN THIS RELEASE**').map(stripInlineCode);
}

function getReleaseDetailBulletsFromSection(lines: string[]): string[] {
  return getBulletValuesFromSection(lines, '**VERSION HISTORY DETAILS**').map((detail) =>
    ensureSentence(makePastTenseOpening(sentenceCase(makeFriendlyReleaseText(stripInlineCode(detail)))))
  );
}

function sentenceCase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function ensureSentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  return /[.!?]$/u.test(trimmed) ? trimmed : `${trimmed}.`;
}

function lowerFirst(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

function uniqueStrings(values: string[]): string[] {
  return uniqueReleaseValues(values.map((value) => value.trim()).filter(Boolean));
}

function formatFriendlyList(values: string[]): string {
  const items = uniqueStrings(values);
  if (items.length === 0) {
    return '';
  }

  const lowered = items.map(lowerFirst);
  if (lowered.length === 1) {
    return lowered[0];
  }

  if (lowered.length === 2) {
    return `${lowered[0]} and ${lowered[1]}`;
  }

  return `${lowered.slice(0, -1).join(', ')}, and ${lowered[lowered.length - 1]}`;
}

function makeFriendlyReleaseText(value: string): string {
  return value
    .replace(/\bAPI routes?\b/giu, 'background services')
    .replace(/\bAPI\b/gu, 'background services')
    .replace(/\bdatabase migrations?\b/giu, 'data storage')
    .replace(/\brepository files?\b/giu, 'general app maintenance')
    .replace(/\bPDF\b/giu, 'PDF document')
    .replace(/\btransient\b/giu, 'temporary')
    .replace(/\binsert races\b/giu, 'timing issues')
    .replace(/\blookup failures\b/giu, 'lookup problems')
    .replace(/\s+/gu, ' ')
    .trim();
}

function makePastTenseOpening(value: string): string {
  return value.replace(/^(add|fix|handle|improve|normalize|publish|update)\b/iu, (match) => {
    const normalized = match.toLowerCase();
    const replacements: Record<string, string> = {
      add: 'Added',
      fix: 'Fixed',
      handle: 'Handled',
      improve: 'Improved',
      normalize: 'Normalized',
      publish: 'Published',
      update: 'Updated',
    };

    return replacements[normalized] ?? sentenceCase(match);
  });
}

function stripVagueAreaCount(value: string): string {
  return value
    .replace(/,\s*and\s+\d+\s+more areas?\b/giu, '')
    .replace(/\s+and\s+\d+\s+more areas?\b/giu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalizeAreaLabel(value: string): string {
  const trimmed = stripVagueAreaCount(value)
    .replace(/[.!?]$/u, '')
    .replace(/^(add|added|fix|fixed|handle|handled|improve|improved|normalize|normalized|publish|published|update|updated)\s+/iu, '')
    .replace(/^(and|or)\s+/iu, '')
    .trim();

  if (!trimmed || /^\d+\s+more areas?$/iu.test(trimmed)) {
    return '';
  }

  return sentenceCase(trimmed);
}

function extractAreasFromText(value: string): string[] {
  const friendlyText = makeFriendlyReleaseText(value);
  const hasAreaSeparators = /,|\s+and\s+|\bmore areas?\b/iu.test(friendlyText);
  const startsWithAreaVerb = /^(add|added|improve|improved|update|updated)\s+/iu.test(friendlyText);
  if (!hasAreaSeparators && !startsWithAreaVerb) {
    return [];
  }

  const withoutPrefix = friendlyText
    .replace(/[.!?]$/u, '')
    .replace(/^(add|added|fix|fixed|handle|handled|improve|improved|normalize|normalized|publish|published|update|updated)\s+/iu, '')
    .trim();

  return uniqueStrings(
    stripVagueAreaCount(withoutPrefix)
      .split(/\s*,\s*|\s+and\s+/u)
      .map(normalizeAreaLabel)
      .filter((area) => area.length > 0 && area.length <= 80)
  );
}

function removeRedundantAreas(areas: string[]): string[] {
  const seenAreas = new Set<string>();
  const uniqueAreas = areas.filter((area) => {
    const normalizedArea = area.trim().toLowerCase();
    if (!normalizedArea || seenAreas.has(normalizedArea)) return false;
    seenAreas.add(normalizedArea);
    return true;
  });

  return uniqueAreas.filter((area) => {
    const normalizedArea = area.toLowerCase();
    return !uniqueAreas.some((otherArea) => {
      const normalizedOther = otherArea.toLowerCase();
      return normalizedArea !== normalizedOther && normalizedOther.includes(normalizedArea);
    });
  });
}

function getFriendlyScopeLabel(scope: string | null): string {
  const descriptorLabel = getFriendlyReleaseScopeLabel(scope);
  if (descriptorLabel !== 'App') return descriptorLabel;
  if (!scope) return 'App';

  const normalized = scope.toLowerCase();
  if (FRIENDLY_SCOPE_LABELS[normalized]) {
    return FRIENDLY_SCOPE_LABELS[normalized];
  }

  return normalized
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => sentenceCase(part))
    .join(' ');
}

function getReleaseHistoryUpdateKind(version: string): ReleaseHistoryUpdateKind {
  const [, major = '0', minor = '0'] = version.split('.');
  return Number(minor) === 0 && Number(major) > 0 ? 'major' : 'minor';
}

function buildReleaseHistoryTitle(entry: ParsedReleaseLogEntry): string {
  const primaryCommit = entry.primaryCommitMessage ? parseConventionalCommit(entry.primaryCommitMessage) : null;
  const descriptor = getReleaseDescriptorByScope(primaryCommit?.scope ?? null);
  const scopeLabel = descriptor?.versionHistoryArea || getFriendlyScopeLabel(primaryCommit?.scope ?? null);

  if (primaryCommit?.type === 'fix') {
    return `${scopeLabel} improvements`;
  }

  if (primaryCommit?.type === 'feat') {
    return `${scopeLabel} update`;
  }

  if (primaryCommit?.type === 'docs') {
    return `${scopeLabel} guidance update`;
  }

  if (primaryCommit?.type === 'test') {
    return 'App reliability update';
  }

  return `${scopeLabel} maintenance update`;
}

function buildReleaseHistoryAreas(entry: ParsedReleaseLogEntry, commits: ParsedCommit[]): string[] {
  const scopedAreas = getReleaseAreasFromScopes(commits.map((commit) => commit.scope));
  const describedAreas = extractAreasFromText(entry.whatChanged);

  return removeRedundantAreas([...scopedAreas, ...describedAreas]);
}

function buildReleaseHistoryAreaKeys(areas: string[], commits: ParsedCommit[]): string[] {
  return uniqueStrings([
    ...commits
      .map((commit) => getReleaseDescriptorByScope(commit.scope)?.id || '')
      .filter(Boolean),
    ...areas
      .map((area) => getReleaseDescriptorByArea(area)?.id || '')
      .filter(Boolean),
  ]);
}

function buildFriendlyReleaseSummary(entry: ParsedReleaseLogEntry, areas: string[]): string {
  const rawDescription = entry.whatChanged || buildWhatChangedSummary(parseCommitsFromMessages(entry.commitMessages));
  const friendlyDescription = makeFriendlyReleaseText(rawDescription);
  const hasVagueAreaCount = /\b\d+\s+more areas?\b/iu.test(friendlyDescription);

  if (areas.length > 0 && hasVagueAreaCount) {
    return `Updated ${formatFriendlyList(areas)}. Related app improvements were included in the same release.`;
  }

  return ensureSentence(makePastTenseOpening(sentenceCase(stripVagueAreaCount(friendlyDescription))));
}

function buildFriendlyCommitDetail(commit: ParsedCommit): string {
  const friendlySubject = stripVagueAreaCount(makeFriendlyReleaseText(commit.subject));
  return ensureSentence(makePastTenseOpening(sentenceCase(friendlySubject)));
}

function buildReleaseHistoryDetails(entry: ParsedReleaseLogEntry, commits: ParsedCommit[], areas: string[]): string[] {
  if (entry.detailBullets.length > 0) {
    return uniqueStrings(entry.detailBullets);
  }

  const areaDetail = areas.length > 0 ? `Covered ${formatFriendlyList(areas)}.` : '';
  const commitDetails = commits.map(buildFriendlyCommitDetail);
  if (commitDetails.length > 0) {
    return uniqueStrings(commitDetails);
  }

  return uniqueStrings([
    areaDetail,
  ]);
}

function buildReleaseHistoryEntry(
  entry: ParsedReleaseLogEntry,
  timestampLookup: Record<string, string | null | undefined>
): ReleaseHistoryEntry {
  const commits = parseCommitsFromMessages(entry.commitMessages);
  const updateKind = getReleaseHistoryUpdateKind(entry.version);
  const areas = buildReleaseHistoryAreas(entry, commits);
  const areaKeys = buildReleaseHistoryAreaKeys(areas, commits);
  const summary = buildFriendlyReleaseSummary(entry, areas);

  return {
    version: entry.version,
    updateKind,
    title: buildReleaseHistoryTitle(entry),
    description: summary,
    summary,
    details: buildReleaseHistoryDetails(entry, commits, areas),
    areas,
    areaKeys,
    pushedAt: entry.pushedAt ?? timestampLookup[entry.version] ?? null,
  };
}

export function parseReleaseLogEntries(content: string): ParsedReleaseLogEntry[] {
  const headings = Array.from(content.matchAll(RELEASE_VERSION_HEADING_PATTERN));
  return headings.map((heading, index) => {
    const nextHeading = headings[index + 1];
    const blockStart = (heading.index ?? 0) + heading[0].length;
    const blockEnd = nextHeading?.index ?? content.length;
    const lines = content.slice(blockStart, blockEnd).split(/\r?\n/u);

    return {
      version: heading[1] ?? '',
      primaryCommitMessage: stripInlineCode(getSectionValue(lines, '**GIT COMMIT MESSAGE**')) || null,
      whatChanged: getSectionValue(lines, '**WHAT CHANGED**'),
      detailBullets: getReleaseDetailBulletsFromSection(lines),
      commitMessages: getCommitMessagesFromSection(lines),
      pushedAt: getSectionValue(lines, '**PUSHED AT**') || null,
    };
  });
}

export function buildReleaseHistoryEntries(
  releaseLogContent: string,
  timestampLookup: Record<string, string | null | undefined> = {}
): ReleaseHistoryEntry[] {
  return parseReleaseLogEntries(releaseLogContent).map((entry) => buildReleaseHistoryEntry(entry, timestampLookup));
}

export function getReleaseHistoryMonthKey(version: string): string {
  return version.split('.')[0] ?? '';
}

function parseReleaseHistoryMonthKey(key: string): { month: number; year: number } | null {
  if (!/^\d{4}$/u.test(key)) {
    return null;
  }

  const month = Number(key.slice(0, 2));
  const year = 2000 + Number(key.slice(2, 4));
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }

  return { month, year };
}

function formatReleaseHistoryMonthKey(date: Date): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = String(date.getUTCFullYear()).slice(-2);
  return `${month}${year}`;
}

export function formatReleaseHistoryMonthLabel(key: string): string {
  const parsed = parseReleaseHistoryMonthKey(key);
  if (!parsed) {
    return 'Unknown month';
  }

  return new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(parsed.year, parsed.month - 1, 1)));
}

export function getRecentReleaseHistoryMonths(
  entries: ReleaseHistoryEntry[],
  limit = DEFAULT_RELEASE_HISTORY_MONTH_LIMIT
): ReleaseHistoryMonthOption[] {
  const latestKey = entries[0] ? getReleaseHistoryMonthKey(entries[0].version) : getCurrentMmyy(new Date());
  const parsed = parseReleaseHistoryMonthKey(latestKey) ?? parseReleaseHistoryMonthKey(getCurrentMmyy(new Date()));
  const startDate = parsed
    ? new Date(Date.UTC(parsed.year, parsed.month - 1, 1))
    : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));

  return Array.from({ length: limit }, (_, index) => {
    const date = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() - index, 1));
    const key = formatReleaseHistoryMonthKey(date);
    return {
      key,
      label: formatReleaseHistoryMonthLabel(key),
    };
  });
}

export function getReleaseHistoryEntriesForMonth(
  entries: ReleaseHistoryEntry[],
  monthKey: string
): ReleaseHistoryEntry[] {
  return entries.filter((entry) => getReleaseHistoryMonthKey(entry.version) === monthKey);
}

export const RELEASE_LOG_PATH = 'docs_private/release-log.md';
export const RELEASE_HISTORY_PATH = 'lib/config/release-history.json';
export const RELEASE_LOG_PREAMBLE =
  '# Production release log\n\nPrivate changelog for production builds. Newest entries first.\n';

export function prependReleaseLogEntry(existingContent: string, entry: string): string {
  const trimmedEntry = entry.trimEnd();
  const body = existingContent.trim();

  if (!body) {
    return `${RELEASE_LOG_PREAMBLE}\n${trimmedEntry}\n`;
  }

  if (body.startsWith('# Production release log')) {
    const withoutPreamble = body.replace(RELEASE_LOG_PREAMBLE, '').trimStart();
    return `${RELEASE_LOG_PREAMBLE}\n${trimmedEntry}\n\n${withoutPreamble}\n`;
  }

  return `${RELEASE_LOG_PREAMBLE}\n${trimmedEntry}\n\n${body}\n`;
}
