/**
 * Fix Errors - Automated Error Analysis & Report Generator
 *
 * This script:
 * 1. Fetches recent errors from the error_logs table (matching /debug page filters)
 * 2. Filters out localhost and admin errors
 * 3. Parses stack traces to extract source file paths
 * 4. Groups errors into patterns (by type + normalized message + component)
 * 5. Writes a structured markdown report to docs_private/error-analysis.md
 * 6. Updates the JSON tracking data in docs_private/error-fix-log.md
 * 7. Prints a concise terminal summary
 *
 * Usage: npm run fixerrors
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import * as fs from 'fs';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

const ERROR_ANALYSIS_PATH = resolve(process.cwd(), 'docs_private', 'error-analysis.md');
const ERROR_FIX_LOG_PATH = resolve(process.cwd(), 'docs_private', 'error-fix-log.md');

// Admin email to filter out (matches /debug page default)
const ADMIN_EMAIL = 'template-admin@example.com';

// ─── Types ───────────────────────────────────────────────────────────

type ErrorLogEntry = {
  id: string;
  timestamp: string;
  error_message: string;
  error_stack: string | null;
  error_type: string;
  user_id: string | null;
  user_email: string | null;
  page_url: string;
  user_agent: string;
  component_name: string | null;
  additional_data: Record<string, unknown> | null;
};

type FixLogEntry = {
  signature: string;
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
  status: 'untriaged' | 'investigating' | 'fix_applied' | 'resolved' | 'wontfix' | 'stale';
  fixerId?: string;
  plan?: string;
  notes?: string;
};

type FixLogData = {
  version: string;
  entries: FixLogEntry[];
};

type SourceFileRef = {
  file: string;
  line?: number;
  column?: number;
};

type ErrorPattern = {
  patternKey: string;
  errorType: string;
  component: string;
  normalizedMessage: string;
  occurrences: ErrorLogEntry[];
  sourceFiles: SourceFileRef[];
  affectedPages: string[];
  affectedUsers: string[];
  firstSeen: string;
  lastSeen: string;
};

// ─── Filtering ───────────────────────────────────────────────────────

function filterErrors(errors: ErrorLogEntry[]): ErrorLogEntry[] {
  return errors.filter((error) => {
    // Exclude localhost errors
    if (error.page_url && error.page_url.toLowerCase().includes('localhost')) {
      return false;
    }
    // Exclude admin account errors
    if (error.user_email === ADMIN_EMAIL) {
      return false;
    }
    return true;
  });
}

// ─── Stack Trace Parsing ─────────────────────────────────────────────

function parseStackTrace(stack: string | null): SourceFileRef[] {
  if (!stack) return [];

  const refs: SourceFileRef[] = [];
  const seen = new Set<string>();

  // Match webpack-internal paths:
  //   at FunctionName (webpack-internal:///(app-pages-browser)/./lib/utils/foo.ts:42:15)
  //   at webpack-internal:///(app-pages-browser)/./components/Bar.tsx:88:3
  const webpackPattern = /webpack-internal:\/\/\/[^)]*?\.\/([^:)]+?)(?::(\d+))?(?::(\d+))?(?:\)|$)/g;
  let match: RegExpExecArray | null;

  while ((match = webpackPattern.exec(stack)) !== null) {
    const file = match[1];
    const line = match[2] ? parseInt(match[2], 10) : undefined;
    const column = match[3] ? parseInt(match[3], 10) : undefined;

    // Skip node_modules and internal files
    if (file.includes('node_modules') || file.startsWith('__')) continue;

    const key = `${file}:${line || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ file, line, column });
    }
  }

  // Also match direct file references like:
  //   at /app/lib/utils/foo.ts:42:15
  //   at Object.<anonymous> (/app/components/Bar.tsx:88:3)
  const directPattern = /(?:\/app\/|\.\/)((?:app|lib|components|hooks|utils|services)[^:)]*?)(?::(\d+))?(?::(\d+))?(?:\)|$)/g;

  while ((match = directPattern.exec(stack)) !== null) {
    const file = match[1];
    const line = match[2] ? parseInt(match[2], 10) : undefined;
    const column = match[3] ? parseInt(match[3], 10) : undefined;

    if (file.includes('node_modules')) continue;

    const key = `${file}:${line || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ file, line, column });
    }
  }

  return refs;
}

// ─── Pattern Grouping ────────────────────────────────────────────────

/** Strip dynamic values (UUIDs, hex IDs, timestamps, numbers) from a message to normalize it */
function normalizeMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>')
    .replace(/\b[0-9a-f]{24,}\b/gi, '<ID>')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^\s]*/g, '<TIMESTAMP>')
    .replace(/https?:\/\/[^\s)]+/g, '<URL>')
    .trim()
    .substring(0, 200);
}

/** Strip dynamic URL segments to normalize page paths */
function normalizePath(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    // Replace UUID-like segments and numeric IDs in paths
    return pathname
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/<ID>')
      .replace(/\/\d+(?=\/|$)/g, '/<N>');
  } catch {
    return url;
  }
}

function createPatternKey(error: ErrorLogEntry): string {
  const type = error.error_type || 'Unknown';
  const component = error.component_name || 'NoComponent';
  const normalizedMsg = normalizeMessage(error.error_message || '');
  return `${type}::${component}::${normalizedMsg}`;
}

function groupIntoPatterns(errors: ErrorLogEntry[]): ErrorPattern[] {
  const patternMap = new Map<string, ErrorPattern>();

  for (const error of errors) {
    const key = createPatternKey(error);

    if (!patternMap.has(key)) {
      patternMap.set(key, {
        patternKey: key,
        errorType: error.error_type || 'Unknown',
        component: error.component_name || 'Unknown',
        normalizedMessage: normalizeMessage(error.error_message || ''),
        occurrences: [],
        sourceFiles: [],
        affectedPages: [],
        affectedUsers: [],
        firstSeen: error.timestamp,
        lastSeen: error.timestamp,
      });
    }

    const pattern = patternMap.get(key)!;
    pattern.occurrences.push(error);

    // Track timestamps
    if (error.timestamp < pattern.firstSeen) pattern.firstSeen = error.timestamp;
    if (error.timestamp > pattern.lastSeen) pattern.lastSeen = error.timestamp;

    // Track affected pages (normalized)
    const pagePath = error.page_url ? normalizePath(error.page_url) : 'Unknown';
    if (!pattern.affectedPages.includes(pagePath)) {
      pattern.affectedPages.push(pagePath);
    }

    // Track affected users
    const userLabel = error.user_email || error.user_id || 'anonymous';
    if (!pattern.affectedUsers.includes(userLabel)) {
      pattern.affectedUsers.push(userLabel);
    }

    // Parse stack traces and merge source files
    const refs = parseStackTrace(error.error_stack);
    for (const ref of refs) {
      const exists = pattern.sourceFiles.some(
        (s) => s.file === ref.file && s.line === ref.line
      );
      if (!exists) {
        pattern.sourceFiles.push(ref);
      }
    }
  }

  // Sort by occurrence count (most frequent first)
  return Array.from(patternMap.values()).sort(
    (a, b) => b.occurrences.length - a.occurrences.length
  );
}

// ─── Report Generation ───────────────────────────────────────────────

function generateReport(patterns: ErrorPattern[], totalFetched: number, totalFiltered: number): string {
  const now = new Date().toISOString();
  const lines: string[] = [];

  lines.push('# Error Analysis Report');
  lines.push('');
  lines.push(`> **Generated:** ${now}`);
  lines.push(`> **Errors fetched from DB:** ${totalFetched} | **After filtering:** ${totalFiltered} | **Patterns found:** ${patterns.length}`);
  lines.push('');
  lines.push('This file is overwritten each time `npm run fixerrors` runs.');
  lines.push('Use it as context for Cursor AI to analyze and fix codebase issues.');
  lines.push('');

  if (patterns.length === 0) {
    lines.push('## No errors found');
    lines.push('');
    lines.push('The error log is clean. No production errors (excluding localhost and admin) are present.');
    lines.push('');
    return lines.join('\n');
  }

  // ── Section 1: Summary Table ──
  lines.push('## Summary');
  lines.push('');
  lines.push('| # | Error Type | Component | Occurrences | Affected Pages | Source Files | First Seen | Last Seen |');
  lines.push('|---|-----------|-----------|-------------|----------------|-------------|------------|-----------|');

  patterns.forEach((p, i) => {
    const srcCount = p.sourceFiles.length;
    const first = new Date(p.firstSeen).toLocaleDateString('en-GB');
    const last = new Date(p.lastSeen).toLocaleDateString('en-GB');
    lines.push(
      `| ${i + 1} | ${p.errorType} | ${p.component} | ${p.occurrences.length} | ${p.affectedPages.length} | ${srcCount} | ${first} | ${last} |`
    );
  });

  lines.push('');

  // ── Section 2: Detailed Patterns ──
  lines.push('## Error Patterns (by frequency)');
  lines.push('');

  patterns.forEach((p, i) => {
    lines.push(`### ${i + 1}. ${p.errorType} in ${p.component} (${p.occurrences.length} occurrences)`);
    lines.push('');
    lines.push(`**Normalized message:** \`${p.normalizedMessage}\``);
    lines.push('');

    // Full original message from the most recent occurrence
    const latest = p.occurrences[0];
    const fullMsg = (latest.error_message || '').substring(0, 500);
    lines.push(`**Latest full message:**`);
    lines.push('```');
    lines.push(fullMsg);
    lines.push('```');
    lines.push('');

    // Affected pages
    lines.push(`**Affected pages:** ${p.affectedPages.join(', ')}`);
    lines.push('');

    // Affected users
    lines.push(`**Affected users:** ${p.affectedUsers.length} unique (${p.affectedUsers.slice(0, 5).join(', ')}${p.affectedUsers.length > 5 ? '...' : ''})`);
    lines.push('');

    // Source files
    if (p.sourceFiles.length > 0) {
      lines.push('**Source files (from stack trace):**');
      for (const ref of p.sourceFiles.slice(0, 10)) {
        const loc = ref.line ? `${ref.file}:${ref.line}${ref.column ? ':' + ref.column : ''}` : ref.file;
        lines.push(`- \`${loc}\``);
      }
      if (p.sourceFiles.length > 10) {
        lines.push(`- ...and ${p.sourceFiles.length - 10} more`);
      }
      lines.push('');
    } else {
      lines.push('**Source files:** No source file references found in stack trace');
      lines.push('');
    }

    // Stack trace excerpt (from the most recent occurrence)
    if (latest.error_stack) {
      const stackExcerpt = latest.error_stack.split('\n').slice(0, 8).join('\n');
      lines.push('**Stack trace excerpt:**');
      lines.push('```');
      lines.push(stackExcerpt);
      lines.push('```');
      lines.push('');
    }

    // Timestamps
    lines.push(`**First seen:** ${p.firstSeen} | **Last seen:** ${p.lastSeen}`);
    lines.push('');
    lines.push('---');
    lines.push('');
  });

  // ── Section 3: Cross-Cutting Pattern Analysis ──
  lines.push('## Pattern Analysis');
  lines.push('');

  // Group by component
  const componentGroups = new Map<string, ErrorPattern[]>();
  for (const p of patterns) {
    const comp = p.component;
    if (!componentGroups.has(comp)) componentGroups.set(comp, []);
    componentGroups.get(comp)!.push(p);
  }

  if (componentGroups.size > 0) {
    lines.push('### Errors by Component');
    lines.push('');
    for (const [comp, pats] of componentGroups) {
      const totalOccurrences = pats.reduce((sum, p) => sum + p.occurrences.length, 0);
      lines.push(`- **${comp}**: ${pats.length} pattern(s), ${totalOccurrences} total occurrences`);
    }
    lines.push('');
  }

  // Group by error type
  const typeGroups = new Map<string, ErrorPattern[]>();
  for (const p of patterns) {
    if (!typeGroups.has(p.errorType)) typeGroups.set(p.errorType, []);
    typeGroups.get(p.errorType)!.push(p);
  }

  if (typeGroups.size > 0) {
    lines.push('### Errors by Type');
    lines.push('');
    for (const [type, pats] of typeGroups) {
      const totalOccurrences = pats.reduce((sum, p) => sum + p.occurrences.length, 0);
      lines.push(`- **${type}**: ${pats.length} pattern(s), ${totalOccurrences} total occurrences`);
    }
    lines.push('');
  }

  // Identify frequently affected pages
  const pageCount = new Map<string, number>();
  for (const p of patterns) {
    for (const page of p.affectedPages) {
      pageCount.set(page, (pageCount.get(page) || 0) + p.occurrences.length);
    }
  }

  const hotPages = Array.from(pageCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  if (hotPages.length > 0) {
    lines.push('### Most Error-Prone Pages');
    lines.push('');
    for (const [page, count] of hotPages) {
      lines.push(`- **${page}**: ${count} error(s)`);
    }
    lines.push('');
  }

  // Identify common source files across multiple patterns
  const filePatternCount = new Map<string, number>();
  for (const p of patterns) {
    const uniqueFiles = new Set(p.sourceFiles.map((s) => s.file));
    for (const file of uniqueFiles) {
      filePatternCount.set(file, (filePatternCount.get(file) || 0) + 1);
    }
  }

  const hotFiles = Array.from(filePatternCount.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1]);

  if (hotFiles.length > 0) {
    lines.push('### Source Files Appearing in Multiple Patterns');
    lines.push('');
    for (const [file, count] of hotFiles) {
      lines.push(`- \`${file}\` appears in ${count} different error patterns`);
    }
    lines.push('');
  }

  // ── Section 4: Actionable Items ──
  lines.push('## Actionable Items');
  lines.push('');
  lines.push('The following items are recommended for investigation or fixing:');
  lines.push('');

  let actionIndex = 1;

  for (const p of patterns) {
    if (p.sourceFiles.length > 0) {
      const topFile = p.sourceFiles[0];
      const loc = topFile.line ? `${topFile.file}:${topFile.line}` : topFile.file;
      lines.push(
        `${actionIndex}. **\`${loc}\`** - ${p.errorType}: ${p.normalizedMessage.substring(0, 100)} (${p.occurrences.length}x)`
      );
    } else {
      lines.push(
        `${actionIndex}. **${p.component}** - ${p.errorType}: ${p.normalizedMessage.substring(0, 100)} (${p.occurrences.length}x) - no stack trace available, investigate component`
      );
    }
    actionIndex++;
  }

  lines.push('');
  return lines.join('\n');
}

// ─── Fix Log (Historical Tracking) ──────────────────────────────────

function loadFixLog(): FixLogData {
  if (!fs.existsSync(ERROR_FIX_LOG_PATH)) {
    return { version: '1.0.0', entries: [] };
  }

  const content = fs.readFileSync(ERROR_FIX_LOG_PATH, 'utf-8');
  const jsonMatch = content.match(/```json[\r\n]+([\s\S]*?)[\r\n]+```/);

  if (!jsonMatch) {
    console.warn('  No JSON block found in error-fix-log.md, starting fresh');
    return { version: '1.0.0', entries: [] };
  }

  try {
    return JSON.parse(jsonMatch[1]);
  } catch {
    console.error('  Failed to parse JSON from error-fix-log.md, starting fresh');
    return { version: '1.0.0', entries: [] };
  }
}

function saveFixLog(data: FixLogData) {
  if (!fs.existsSync(ERROR_FIX_LOG_PATH)) {
    // Create the file from scratch
    const content = [
      '# Error Fix Log',
      '',
      '**Last Updated:** *Auto-updated by fixerrors script*',
      '',
      'This file tracks known errors historically. See `error-analysis.md` for the latest analysis.',
      '',
      '## Machine-Readable Data',
      '',
      '```json',
      JSON.stringify(data, null, 2),
      '```',
      '',
    ].join('\n');
    fs.writeFileSync(ERROR_FIX_LOG_PATH, content, 'utf-8');
    return;
  }

  const content = fs.readFileSync(ERROR_FIX_LOG_PATH, 'utf-8');
  const newJsonBlock = `\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;

  const updated = content.replace(/```json[\r\n]+[\s\S]*?[\r\n]+```/, newJsonBlock);

  if (updated !== content) {
    fs.writeFileSync(ERROR_FIX_LOG_PATH, updated, 'utf-8');
  } else {
    // JSON block not found, write the whole file
    const freshContent = [
      '# Error Fix Log',
      '',
      '**Last Updated:** *Auto-updated by fixerrors script*',
      '',
      'This file tracks known errors historically. See `error-analysis.md` for the latest analysis.',
      '',
      '## Machine-Readable Data',
      '',
      newJsonBlock,
      '',
    ].join('\n');
    fs.writeFileSync(ERROR_FIX_LOG_PATH, freshContent, 'utf-8');
  }
}

/** Create a signature compatible with the existing fix log format */
function createLegacySignature(error: ErrorLogEntry): string {
  const type = error.error_type || 'Unknown';
  const message = (error.error_message || '').trim().substring(0, 200);
  const component = error.component_name || 'NoComponent';
  let page = 'NoPage';
  try {
    page = new URL(error.page_url).pathname;
  } catch {
    page = error.page_url || 'NoPage';
  }
  return `${type}::${component}::${page}::${message}`;
}

function updateFixLog(errors: ErrorLogEntry[]): void {
  const fixLog = loadFixLog();
  const seenSignatures = new Set<string>();

  for (const error of errors) {
    const signature = createLegacySignature(error);
    seenSignatures.add(signature);

    const existing = fixLog.entries.find((e) => e.signature === signature);

    if (existing) {
      existing.lastSeen = error.timestamp;
      existing.occurrences++;

      if (existing.status === 'stale') {
        existing.status = 'investigating';
      }
    } else {
      fixLog.entries.push({
        signature,
        firstSeen: error.timestamp,
        lastSeen: error.timestamp,
        occurrences: 1,
        status: 'untriaged',
        plan: 'Needs investigation',
        notes: `Error Type: ${error.error_type}\nComponent: ${error.component_name || 'N/A'}\nPage: ${error.page_url}`,
      });
    }
  }

  // Mark entries not seen this run as stale (unless resolved)
  for (const entry of fixLog.entries) {
    if (
      !seenSignatures.has(entry.signature) &&
      entry.status !== 'resolved' &&
      entry.status !== 'wontfix' &&
      entry.status !== 'stale'
    ) {
      entry.status = 'stale';
    }
  }

  saveFixLog(fixLog);
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log('FIXERRORS - Error Analysis & Report Generator');
  console.log('=============================================\n');

  // 1. Fetch errors
  console.log('Fetching errors from error_logs...');
  const { data: rawErrors, error: fetchError } = await supabase
    .from('error_logs')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(200);

  if (fetchError) {
    console.error(`FAILED: ${fetchError.message}`);
    process.exit(1);
  }

  if (!rawErrors || rawErrors.length === 0) {
    console.log('No errors in database. Writing empty report.');
    const report = generateReport([], 0, 0);
    fs.writeFileSync(ERROR_ANALYSIS_PATH, report, 'utf-8');
    console.log(`\nReport written to: docs_private/error-analysis.md`);
    process.exit(0);
  }

  console.log(`  Fetched ${rawErrors.length} error(s) from database`);

  // 2. Filter
  const errors = filterErrors(rawErrors);
  const filteredOut = rawErrors.length - errors.length;
  console.log(`  Filtered out ${filteredOut} (localhost/admin) -> ${errors.length} remaining`);

  if (errors.length === 0) {
    console.log('All errors were filtered out. Writing empty report.');
    const report = generateReport([], rawErrors.length, 0);
    fs.writeFileSync(ERROR_ANALYSIS_PATH, report, 'utf-8');
    console.log(`\nReport written to: docs_private/error-analysis.md`);
    process.exit(0);
  }

  // 3. Group into patterns
  console.log('Grouping errors into patterns...');
  const patterns = groupIntoPatterns(errors);
  console.log(`  Found ${patterns.length} distinct pattern(s)`);

  // 4. Generate report
  console.log('Generating analysis report...');
  const report = generateReport(patterns, rawErrors.length, errors.length);
  fs.writeFileSync(ERROR_ANALYSIS_PATH, report, 'utf-8');
  console.log(`  Written to: docs_private/error-analysis.md`);

  // 5. Update historical fix log (JSON only, no run summaries)
  console.log('Updating historical fix log...');
  updateFixLog(errors);
  console.log(`  Updated: docs_private/error-fix-log.md`);

  // 6. Terminal summary
  console.log('\n=============================================');
  console.log('SUMMARY');
  console.log('=============================================');
  console.log(`  Errors fetched:      ${rawErrors.length}`);
  console.log(`  After filtering:     ${errors.length}`);
  console.log(`  Patterns found:      ${patterns.length}`);
  console.log('');

  // Top 5 patterns
  console.log('Top patterns:');
  patterns.slice(0, 5).forEach((p, i) => {
    console.log(`  ${i + 1}. [${p.occurrences.length}x] ${p.errorType} in ${p.component}: ${p.normalizedMessage.substring(0, 60)}`);
  });

  if (patterns.length > 5) {
    console.log(`  ...and ${patterns.length - 5} more`);
  }

  console.log('\n=============================================');
  console.log('Report ready: docs_private/error-analysis.md');
  console.log('=============================================\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
