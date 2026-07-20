/**
 * run.ts — Testsuite CLI runner
 *
 * Usage:
 *   npx tsx testsuite/runner/run.ts --all
 *   npx tsx testsuite/runner/run.ts --ui
 *   npx tsx testsuite/runner/run.ts --api
 *   npx tsx testsuite/runner/run.ts --tag @fleet
 *   npx tsx testsuite/runner/run.ts --grep "auth"
 */
import { execSync } from 'child_process';
import {
  clearAuthLifecycleIssueLog,
  enforceAuthLifecycleIssueGate,
} from './auth-lifecycle-audit';
import { runTestsuitePreflight } from '../helpers/preflight';

const args = process.argv.slice(2);
const ROOT = process.cwd();

const runApi = args.includes('--all') || args.includes('--api');
const runUi = args.includes('--all') || args.includes('--ui');

// If no flags, default to --all
const runAll = !args.includes('--api') && !args.includes('--ui') && !args.includes('--tag') && !args.includes('--grep');

const tagIndex = args.indexOf('--tag');
const grepIndex = args.indexOf('--grep');
const tagValue = tagIndex >= 0 ? args[tagIndex + 1] : '';
const grepValue = grepIndex >= 0 ? args[grepIndex + 1] : '';

function exec(cmd: string, label: string): boolean {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Running: ${label}`);
  console.log(`Command: ${cmd}`);
  console.log('='.repeat(60) + '\n');

  try {
    execSync(cmd, { stdio: 'inherit', cwd: ROOT });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown command failure';
    console.error(`\n${label} failed: ${message}`);
    return false;
  }
}

async function main(): Promise<void> {
  await runTestsuitePreflight();
  clearAuthLifecycleIssueLog();

  let apiPassed = true;
  let uiPassed = true;

  // API tests (Vitest)
  if (runAll || runApi) {
    let apiCmd = 'npx vitest run --config=testsuite/config/vitest.config.ts';
    if (grepValue) apiCmd += ` -t "${grepValue}"`;
    if (tagValue) apiCmd += ` -t "${tagValue}"`;
    apiPassed = exec(apiCmd, 'API Tests (Vitest)');
  }

  // UI tests (Playwright)
  if (runAll || runUi || tagValue || grepValue) {
    let uiCmd = 'npx playwright test --config=testsuite/config/playwright.config.ts';
    if (grepValue) uiCmd += ` --grep "${grepValue}"`;
    if (tagValue) uiCmd += ` --grep "${tagValue}"`;
    uiPassed = exec(uiCmd, 'UI Tests (Playwright)');
  }

  // Generate report
  console.log('\n' + '='.repeat(60));
  console.log('Generating report...');
  console.log('='.repeat(60) + '\n');

  try {
    execSync('npx tsx testsuite/runner/report.ts', { stdio: 'inherit', cwd: ROOT });
  } catch {
    console.warn('Report generation had issues, but continuing.');
  }

  const issueGatePassed = await enforceAuthLifecycleIssueGate({
    interactive: process.stdin.isTTY === true && process.env.CI !== 'true',
  });

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('TESTSUITE COMPLETE');
  console.log('='.repeat(60));
  console.log(`  API tests: ${apiPassed ? 'PASSED' : 'FAILED'}`);
  console.log(`  UI tests:  ${uiPassed ? 'PASSED' : 'FAILED'}`);
  console.log(`  Report:    testsuite/reports/latest.md`);
  console.log('='.repeat(60) + '\n');

  if (!apiPassed || !uiPassed || !issueGatePassed) {
    process.exit(1);
  }
}

void main();
