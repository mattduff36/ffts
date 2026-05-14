import { existsSync } from 'fs';
import { resolve } from 'path';
import { envLocalPath, getRequiredEnvKeys, loadSetupState, readEnvFile } from './shared';

interface ValidationIssue {
  level: 'error' | 'warning';
  message: string;
}

const expectedScriptFiles = [
  'scripts/maintenance/setup-storage.ts',
  'scripts/seed/seed-sample-data.ts',
  'scripts/seed/seed-inspections-sql.ts',
  'scripts/maintenance/clear-inspections.ts',
  'scripts/template/setup.ts',
  'scripts/template/validate.ts',
  'scripts/template/audit.ts',
  'scripts/demo/setup-storage.ts',
  'scripts/demo/seed.ts',
  'scripts/demo/reset.ts',
  'scripts/demo/wipe-database.ts',
  'scripts/migrations/apply-baseline.ts',
];

function checkEnv(): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const env = readEnvFile(envLocalPath);

  if (!existsSync(envLocalPath)) {
    issues.push({ level: 'error', message: '.env.local is missing. Run npm run template:setup first.' });
    return issues;
  }

  for (const key of getRequiredEnvKeys()) {
    if (!env.get(key)) {
      issues.push({ level: 'error', message: `${key} is missing from .env.local` });
    }
  }

  const appMode = env.get('APP_MODE');
  const publicAppMode = env.get('NEXT_PUBLIC_APP_MODE');
  const appUrl = env.get('NEXT_PUBLIC_APP_URL');

  if (appMode !== publicAppMode) {
    issues.push({ level: 'error', message: 'APP_MODE and NEXT_PUBLIC_APP_MODE must match.' });
  }

  if (!env.get('POSTGRES_URL_NON_POOLING')) {
    issues.push({ level: 'error', message: 'POSTGRES_URL_NON_POOLING is required for db:baseline and db:validate.' });
  }

  if ((appMode === 'demo' || publicAppMode === 'demo') && !env.get('DEMO_SUPABASE_PROJECT_REF')) {
    issues.push({ level: 'error', message: 'DEMO_SUPABASE_PROJECT_REF is required in demo mode for reset safety.' });
  }

  if ((appMode === 'demo' || publicAppMode === 'demo') && appUrl?.includes('localhost')) {
    issues.push({ level: 'warning', message: 'NEXT_PUBLIC_APP_URL is localhost while app mode is demo.' });
  }

  for (const key of [
    'SUPABASE_SERVICE_ROLE_KEY',
    'POSTGRES_URL_NON_POOLING',
    'RESEND_API_KEY',
    'APP_SESSION_SECRET',
    'APP_SESSION_HASH_SECRET',
  ]) {
    const value = env.get(key);
    if (value && value.length < 20) {
      issues.push({ level: 'warning', message: `${key} is set but looks shorter than expected.` });
    }
  }

  if (env.get('APP_MODE') === 'production' && env.get('NEXT_PUBLIC_DEMO_EMAIL_DOMAIN')) {
    issues.push({
      level: 'warning',
      message: 'Demo email domain is present in production mode. Keep demo data isolated from customer data.',
    });
  }

  return issues;
}

function checkScripts(): ValidationIssue[] {
  return expectedScriptFiles
    .filter((file) => !existsSync(resolve(process.cwd(), file)))
    .map((file) => ({ level: 'error' as const, message: `Expected script file is missing: ${file}` }));
}

function checkSetupState(): ValidationIssue[] {
  try {
    const state = loadSetupState();
    if (!state) {
      return [{ level: 'warning', message: 'template-setup.local.json is missing. The wizard state cannot be reused.' }];
    }

    return [];
  } catch (error) {
    return [
      {
        level: 'error',
        message: `template-setup.local.json is invalid: ${error instanceof Error ? error.message : String(error)}`,
      },
    ];
  }
}

function main() {
  const issues = [...checkEnv(), ...checkScripts(), ...checkSetupState()];
  const errors = issues.filter((issue) => issue.level === 'error');
  const warnings = issues.filter((issue) => issue.level === 'warning');

  for (const issue of issues) {
    const prefix = issue.level === 'error' ? 'ERROR' : 'WARN';
    console.log(`${prefix}: ${issue.message}`);
  }

  console.log(`Template validation complete: ${errors.length} error(s), ${warnings.length} warning(s).`);

  if (errors.length > 0) process.exit(1);
}

main();
