/**
 * coverage-audit.ts
 *
 * Scans app routes and existing tests to identify coverage gaps.
 * Outputs a markdown report at testsuite/reports/coverage-gaps.md
 *
 * Usage: npx tsx testsuite/runner/coverage-audit.ts
 */
import { readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, relative, join } from 'path';

const ROOT = process.cwd();
const REPORTS_DIR = resolve(ROOT, 'testsuite', 'reports');

interface RouteInfo {
  path: string;
  relativePath: string;
}

function findFiles(dir: string, pattern: RegExp, results: string[] = []): string[] {
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue;
    const stat = statSync(full);
    if (stat.isDirectory()) {
      findFiles(full, pattern, results);
    } else if (pattern.test(entry)) {
      results.push(full);
    }
  }
  return results;
}

function getApiRoutes(): RouteInfo[] {
  const apiDir = resolve(ROOT, 'app', 'api');
  const files = findFiles(apiDir, /^route\.ts$/);
  return files.map(f => ({
    path: f,
    relativePath: relative(ROOT, f),
  }));
}

function getPageRoutes(): RouteInfo[] {
  const appDir = resolve(ROOT, 'app');
  const files = findFiles(appDir, /^page\.tsx$/);
  return files.filter(f => !f.includes('/api/')).map(f => ({
    path: f,
    relativePath: relative(ROOT, f),
  }));
}

function getTestFiles(): string[] {
  const testDirs = [
    resolve(ROOT, 'tests'),
    resolve(ROOT, 'testsuite'),
  ];
  const results: string[] = [];
  for (const dir of testDirs) {
    findFiles(dir, /\.(test|spec)\.(ts|tsx)$/, results);
  }
  return results.map(f => relative(ROOT, f));
}

function extractRouteSlug(routePath: string): string {
  return routePath
    .replace(/^app\//, '')
    .replace(/\/route\.ts$/, '')
    .replace(/\/page\.tsx$/, '')
    .replace(/\(dashboard\)\//, '')
    .replace(/\(auth\)\//, '')
    .replace(/api\//, '');
}

function isRouteCovered(slug: string, testFiles: string[]): boolean {
  const normalizedSlug = slug.toLowerCase().replace(/[^a-z0-9]/g, '');
  return testFiles.some(t => {
    const normalizedTest = t.toLowerCase().replace(/[^a-z0-9]/g, '');
    // Check if slug keywords appear in test file path
    const keywords = normalizedSlug.split(/(?=[A-Z])|[-_/[\]]/g).filter(Boolean);
    const significantKeywords = keywords.filter(k => k.length > 3);
    return significantKeywords.some(kw => normalizedTest.includes(kw));
  });
}

function main() {
  console.log('Running coverage audit...\n');

  const apiRoutes = getApiRoutes();
  const pageRoutes = getPageRoutes();
  const testFiles = getTestFiles();

  const uncoveredApi: string[] = [];
  const uncoveredPages: string[] = [];

  for (const route of apiRoutes) {
    const slug = extractRouteSlug(route.relativePath);
    if (!isRouteCovered(slug, testFiles)) {
      uncoveredApi.push(route.relativePath);
    }
  }

  for (const route of pageRoutes) {
    const slug = extractRouteSlug(route.relativePath);
    if (!isRouteCovered(slug, testFiles)) {
      uncoveredPages.push(route.relativePath);
    }
  }

  // Generate report
  const lines: string[] = [
    '# Coverage Gaps Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `## Summary`,
    '',
    `- **API routes**: ${apiRoutes.length} total, ${uncoveredApi.length} potentially uncovered`,
    `- **Page routes**: ${pageRoutes.length} total, ${uncoveredPages.length} potentially uncovered`,
    `- **Test files**: ${testFiles.length} total`,
    '',
  ];

  if (uncoveredApi.length > 0) {
    lines.push('## Uncovered API Routes', '');
    for (const r of uncoveredApi.sort()) {
      lines.push(`- \`${r}\``);
    }
    lines.push('');
  }

  if (uncoveredPages.length > 0) {
    lines.push('## Uncovered Page Routes', '');
    for (const r of uncoveredPages.sort()) {
      lines.push(`- \`${r}\``);
    }
    lines.push('');
  }

  lines.push('## High-Priority Recommendations', '');
  lines.push('- Admin user management (create, update, reset password)');
  lines.push('- Timesheet approval/reject/adjust workflows');
  lines.push('- Workshop task delete permissions');
  lines.push('- RAMS sign + export flows');
  lines.push('- Error logging endpoints');
  lines.push('- Plant inspection workflows');
  lines.push('');

  if (!existsSync(REPORTS_DIR)) {
    mkdirSync(REPORTS_DIR, { recursive: true });
  }

  const reportPath = resolve(REPORTS_DIR, 'coverage-gaps.md');
  writeFileSync(reportPath, lines.join('\n'));
  console.log(`Coverage gaps report written to: ${reportPath}`);
  console.log(`  ${uncoveredApi.length} potentially uncovered API routes`);
  console.log(`  ${uncoveredPages.length} potentially uncovered page routes`);
}

main();
