import { existsSync, readdirSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';

export interface TerminalActivity {
  filePath: string;
  pid: number | null;
  command: string;
  startedAt: string | null;
  isRunning: boolean;
  isAgentReview: boolean;
  isFinalise: boolean;
}

export interface FinaliseActivityCheck {
  terminalDirectory: string;
  activities: TerminalActivity[];
  blockingActivities: TerminalActivity[];
}

function getCursorProjectFolderName(repoRoot: string): string {
  const normalized = repoRoot.replace(/\\/gu, '/').replace(/\/$/u, '');
  const driveMatch = normalized.match(/^([a-zA-Z]):\/(.+)$/u);
  if (driveMatch) {
    return `${driveMatch[1].toLowerCase()}-${driveMatch[2].replace(/\//gu, '-')}`;
  }
  return normalized.replace(/^\/+/u, '').replace(/\//gu, '-');
}

export function getDefaultTerminalDirectory(repoRoot: string): string {
  if (process.env.CURSOR_TERMINALS_DIR) return process.env.CURSOR_TERMINALS_DIR;
  return path.join(os.homedir(), '.cursor', 'projects', getCursorProjectFolderName(repoRoot), 'terminals');
}

function getHeader(content: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/u);
  return match?.[1] ?? '';
}

function getHeaderValue(header: string, key: string): string {
  const match = header.match(new RegExp(`^${key}:\\s*(.*)$`, 'imu'));
  return match?.[1]?.trim().replace(/^"|"$/gu, '') ?? '';
}

function getCommandFromHeader(header: string): string {
  return getHeaderValue(header, 'active_command') || getHeaderValue(header, 'command') || getHeaderValue(header, 'last_command');
}

function getPidFromHeader(header: string): number | null {
  const raw = getHeaderValue(header, 'pid');
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasExitFooter(content: string): boolean {
  return /(?:^|\r?\n)---\r?\nexit_code:/u.test(content);
}

function isTerminalCommandRunning(header: string, content: string): boolean {
  if (hasExitFooter(content)) return false;
  if (/^running_for_ms:/imu.test(header)) return true;
  if (/^active_command:/imu.test(header)) return true;
  return /^started_at:/imu.test(header);
}

export function parseTerminalActivity(filePath: string, content: string): TerminalActivity | null {
  const header = getHeader(content);
  if (!header) return null;

  const command = getCommandFromHeader(header);
  const normalizedCommand = command.toLowerCase();
  const isRunning = isTerminalCommandRunning(header, content);

  return {
    filePath,
    pid: getPidFromHeader(header),
    command,
    startedAt: getHeaderValue(header, 'started_at') || null,
    isRunning,
    isAgentReview: /\bagent\s+review\b|\breviewing your changes\b/iu.test(content),
    isFinalise: /\b(finalise|finalize)(?::(?:full|push))*\b/iu.test(normalizedCommand),
  };
}

export function checkFinaliseBlockingActivity(repoRoot: string, ignoredPids: number[] = []): FinaliseActivityCheck {
  const terminalDirectory = getDefaultTerminalDirectory(repoRoot);
  if (!existsSync(terminalDirectory)) {
    return { terminalDirectory, activities: [], blockingActivities: [] };
  }

  const activities = readdirSync(terminalDirectory)
    .filter((fileName) => fileName.endsWith('.txt'))
    .map((fileName) => {
      const filePath = path.join(terminalDirectory, fileName);
      return parseTerminalActivity(filePath, readFileSync(filePath, 'utf8'));
    })
    .filter((activity): activity is TerminalActivity => activity !== null);

  const ignoredPidSet = new Set(ignoredPids.filter((pid) => Number.isFinite(pid)));
  const blockingActivities = activities.filter((activity) =>
    activity.isRunning &&
    !ignoredPidSet.has(activity.pid ?? -1) &&
    (activity.isAgentReview || activity.isFinalise)
  );

  return { terminalDirectory, activities, blockingActivities };
}

export function formatBlockingActivity(activity: TerminalActivity): string {
  const labels = [
    activity.isAgentReview ? 'Agent Review' : null,
    activity.isFinalise ? 'finalise' : null,
  ].filter(Boolean).join(', ');
  return `${path.basename(activity.filePath)} (${labels || 'unknown'}): ${activity.command || 'no command recorded'}`;
}
