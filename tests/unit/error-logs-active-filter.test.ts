import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const CURRENT_ERROR_SURFACES = [
  'lib/server/error-logs.ts',
  'app/api/dashboard/summary/route.ts',
  'app/api/errors/daily-summary/route.ts',
  'app/api/errors/notify-new/route.ts',
  'scripts/analyze-production-errors.ts',
  'scripts/check-error-logs.ts',
  'scripts/test-error-logging.ts',
  'scripts/clear-localhost-errors.ts',
  'scripts/maintenance/clear-network-error-logs.ts',
  'scripts/testing/query-error-logs.ts',
  'testsuite/ui/error-logging.spec.ts',
] as const;

const ARCHIVE_ACTIVE_CLEARS = [
  'scripts/clear-all-error-logs.ts',
  'scripts/clear-localhost-errors.ts',
  'scripts/maintenance/clear-network-error-logs.ts',
  'testsuite/ui/error-logging.spec.ts',
] as const;

describe('current-error product reads', () => {
  it('FXERR-PRODUCT-023 filters active error_logs on all current-error surfaces', () => {
    const errorLogs = readFileSync(resolve(process.cwd(), 'lib/server/error-logs.ts'), 'utf8');
    const dashboard = readFileSync(
      resolve(process.cwd(), 'app/api/dashboard/summary/route.ts'),
      'utf8'
    );
    const dailySummary = readFileSync(
      resolve(process.cwd(), 'app/api/errors/daily-summary/route.ts'),
      'utf8'
    );
    const notifyNew = readFileSync(
      resolve(process.cwd(), 'app/api/errors/notify-new/route.ts'),
      'utf8'
    );

    expect(errorLogs).toContain(".eq('status', 'active')");
    expect(errorLogs).toContain('archiveActiveErrorLogs');
    expect(dashboard).toMatch(/from\('error_logs'\)[\s\S]*\.eq\('status', 'active'\)/u);
    expect(dailySummary).toMatch(/from\('error_logs'\)[\s\S]*\.eq\('status', 'active'\)/u);
    expect(notifyNew).toMatch(/\.eq\('id', error_log_id\)[\s\S]*\.eq\('status', 'active'\)/u);

    for (const relativePath of CURRENT_ERROR_SURFACES) {
      const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8');
      expect(source, relativePath).toMatch(/status['" ]*=['" ]*['"]active['"]|\.eq\('status', 'active'\)/u);
    }

    for (const relativePath of ARCHIVE_ACTIVE_CLEARS) {
      const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8');
      expect(source, relativePath).not.toMatch(/\.delete\(\)/u);
      expect(source, relativePath).toContain("status: 'archived'");
      expect(source, relativePath).toContain('archived_at');
    }
  });
});
