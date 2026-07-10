import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { resolve } from 'path';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';

export type AuthLifecycleIssueSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface AuthLifecycleIssueInput {
  scenario: string;
  details: string;
  severity: AuthLifecycleIssueSeverity;
  route?: string;
  source?: string;
}

export interface AuthLifecycleIssue extends AuthLifecycleIssueInput {
  id: string;
  timestamp: string;
}

const REPORTS_DIR = resolve(process.cwd(), 'testsuite', 'reports');
const ISSUE_LOG_PATH = resolve(REPORTS_DIR, 'auth-lifecycle-issues.jsonl');
const BASELINE_PATH = resolve(REPORTS_DIR, 'auth-lifecycle-baseline.json');
const FIX_QUEUE_PATH = resolve(REPORTS_DIR, 'auth-lifecycle-fix-queue.json');
const ISSUE_THRESHOLD = 5;

function ensureReportsDir(): void {
  if (!existsSync(REPORTS_DIR)) {
    mkdirSync(REPORTS_DIR, { recursive: true });
  }
}

function makeIssueId(): string {
  const random = Math.random().toString(16).slice(2, 10);
  return `issue_${Date.now()}_${random}`;
}

export function clearAuthLifecycleIssueLog(): void {
  ensureReportsDir();
  if (existsSync(ISSUE_LOG_PATH)) {
    unlinkSync(ISSUE_LOG_PATH);
  }
}

export function recordAuthLifecycleIssue(inputIssue: AuthLifecycleIssueInput): void {
  ensureReportsDir();
  const issue: AuthLifecycleIssue = {
    ...inputIssue,
    id: makeIssueId(),
    timestamp: new Date().toISOString(),
  };
  appendFileSync(ISSUE_LOG_PATH, `${JSON.stringify(issue)}\n`, 'utf-8');
}

export function readAuthLifecycleIssues(): AuthLifecycleIssue[] {
  if (!existsSync(ISSUE_LOG_PATH)) {
    return [];
  }

  const raw = readFileSync(ISSUE_LOG_PATH, 'utf-8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const issues: AuthLifecycleIssue[] = [];
  for (const line of raw) {
    try {
      const parsed = JSON.parse(line) as AuthLifecycleIssue;
      if (parsed.id && parsed.scenario && parsed.details && parsed.severity) {
        issues.push(parsed);
      }
    } catch {
      // Ignore malformed issue lines and keep processing.
    }
  }

  return issues;
}

function writeFixQueue(issues: AuthLifecycleIssue[]): void {
  ensureReportsDir();
  writeFileSync(
    FIX_QUEUE_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        issueCount: issues.length,
        issues,
      },
      null,
      2
    ),
    'utf-8'
  );
}

function updateBaseline(issues: AuthLifecycleIssue[]): void {
  ensureReportsDir();
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        issueCount: issues.length,
        issues,
      },
      null,
      2
    ),
    'utf-8'
  );
}

function printIssueSummary(issues: AuthLifecycleIssue[]): void {
  const grouped = {
    critical: issues.filter((issue) => issue.severity === 'critical'),
    high: issues.filter((issue) => issue.severity === 'high'),
    medium: issues.filter((issue) => issue.severity === 'medium'),
    low: issues.filter((issue) => issue.severity === 'low'),
  };

  console.log('\n' + '='.repeat(60));
  console.log('AUTH LIFECYCLE FINDINGS');
  console.log('='.repeat(60));
  console.log(`Total findings: ${issues.length}`);
  console.log(
    `Critical: ${grouped.critical.length}, High: ${grouped.high.length}, Medium: ${grouped.medium.length}, Low: ${grouped.low.length}`
  );
  console.log('-'.repeat(60));

  for (const issue of issues) {
    console.log(`[${issue.severity.toUpperCase()}] ${issue.scenario}`);
    console.log(`  ${issue.details}`);
    if (issue.route) {
      console.log(`  route: ${issue.route}`);
    }
    if (issue.source) {
      console.log(`  source: ${issue.source}`);
    }
  }
  console.log('='.repeat(60) + '\n');
}

async function askForConfirmation(question: string): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(question);
    return answer.trim().toLowerCase().startsWith('y');
  } finally {
    rl.close();
  }
}

export async function enforceAuthLifecycleIssueGate(options?: { interactive?: boolean }): Promise<boolean> {
  const issues = readAuthLifecycleIssues();
  const blockingIssues = issues.filter((issue) => issue.severity === 'critical' || issue.severity === 'high');
  if (blockingIssues.length > 0) {
    printIssueSummary(issues);
    writeFixQueue(blockingIssues);
    console.warn(`Auth lifecycle gate failed: ${blockingIssues.length} critical/high finding(s) require fixes.`);
    return false;
  }

  if (issues.length < ISSUE_THRESHOLD) {
    return true;
  }

  printIssueSummary(issues);

  const canPrompt = options?.interactive !== false && process.stdin.isTTY === true && process.env.CI !== 'true';
  if (!canPrompt) {
    console.warn(
      `Auth lifecycle findings reached ${issues.length}. Interactive confirmation is unavailable; writing fix queue.`
    );
    writeFixQueue(issues);
    return false;
  }

  const accepted = await askForConfirmation(
    'Findings reached threshold (5). Accept these findings as valid baseline? (y/N): '
  );

  if (accepted) {
    updateBaseline(issues);
    console.log(`Baseline updated at ${BASELINE_PATH}`);
    return true;
  }

  writeFixQueue(issues);
  console.warn(`Findings queued for fixes at ${FIX_QUEUE_PATH}`);
  return false;
}
