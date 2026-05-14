import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { existsSync, writeFileSync } from 'fs';
import { randomBytes } from 'crypto';
import {
  buildChecklist,
  checklistPath,
  envLocalPath,
  saveSetupState,
  setupStateToEnv,
  templateSetupSchema,
  writeEnvLocal,
  type TemplateSetupState,
} from './shared';

const args = new Set(process.argv.slice(2));

function parseBoolean(value: string): boolean {
  return ['1', 'true', 'yes', 'y'].includes(value.toLowerCase());
}

function getArgValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function createSecret(): string {
  return randomBytes(32).toString('hex');
}

function buildDefaultState(): TemplateSetupState {
  return templateSetupSchema.parse({
    companyName: getArgValue('company') || 'Example Client Ltd',
    appName: getArgValue('app-name') || 'FieldOps Template',
    shortAppName: getArgValue('short-name') || 'FieldOps',
    registeredAddress: getArgValue('address') || 'Example House, Template Street, Example Town',
    mainAdminEmail: getArgValue('admin-email') || 'template-admin@example.com',
    supportEmail: getArgValue('support-email') || 'support@example.test',
    publicAppUrl: getArgValue('url') || 'http://localhost:4000',
    appMode: getArgValue('mode') || 'template',
    includeDummyData: parseBoolean(getArgValue('dummy-data') || 'false'),
    demoEmailDomain: getArgValue('demo-domain') || 'demo.example.test',
    brandColor: getArgValue('brand-color') || '#F1D64A',
    brandColorHover: getArgValue('brand-color-hover') || '#D4B83A',
    supabaseUrl: getArgValue('supabase-url'),
    supabaseAnonKey: getArgValue('supabase-anon-key'),
    supabaseServiceRoleKey: getArgValue('supabase-service-role-key'),
    databaseConnectionString: getArgValue('database-url'),
    demoSupabaseProjectRef: getArgValue('demo-project-ref'),
    resendSenderEmail: getArgValue('resend-from'),
    resendApiKey: getArgValue('resend-api-key'),
    resendSenderEmail2: getArgValue('resend-from-2'),
    resendApiKey2: getArgValue('resend-api-key-2'),
    appSessionSecret: getArgValue('app-session-secret') || createSecret(),
    appSessionHashSecret: getArgValue('app-session-hash-secret') || createSecret(),
    maptilerKey: getArgValue('maptiler-key'),
    dvlaApiKey: getArgValue('dvla-api-key'),
    fleetsmartApiKey: getArgValue('fleetsmart-api-key'),
  });
}

async function promptForState(defaultState: TemplateSetupState): Promise<TemplateSetupState> {
  if (args.has('--defaults') || !process.stdin.isTTY) return defaultState;

  const rl = createInterface({ input, output });

  try {
    const ask = async (label: string, current: string): Promise<string> => {
      const answer = await rl.question(`${label} [${current}]: `);
      return answer.trim() || current;
    };

    return templateSetupSchema.parse({
      ...defaultState,
      companyName: await ask('Customer company name', defaultState.companyName),
      appName: await ask('App name', defaultState.appName),
      shortAppName: await ask('Short app name', defaultState.shortAppName),
      registeredAddress: await ask('Registered/footer address', defaultState.registeredAddress),
      mainAdminEmail: await ask('Main admin email', defaultState.mainAdminEmail),
      supportEmail: await ask('Support email', defaultState.supportEmail || defaultState.mainAdminEmail),
      publicAppUrl: await ask('Public app URL', defaultState.publicAppUrl),
      appMode: await ask('App mode', defaultState.appMode),
      demoEmailDomain: await ask('Demo email domain', defaultState.demoEmailDomain),
      brandColor: await ask('Brand colour hex', defaultState.brandColor),
      brandColorHover: await ask('Brand hover colour hex', defaultState.brandColorHover),
    });
  } finally {
    rl.close();
  }
}

async function main() {
  const force = args.has('--force');
  const state = await promptForState(buildDefaultState());

  if (existsSync(envLocalPath) && !force) {
    console.error('.env.local already exists. Re-run with --force to overwrite it.');
    process.exit(1);
  }

  saveSetupState(state);
  writeEnvLocal(setupStateToEnv(state));
  writeFileSync(checklistPath, buildChecklist(state));

  console.log('Template setup state saved to template-setup.local.json');
  console.log('Environment written to .env.local');
  console.log('Checklist written to template-setup-checklist.md');
  console.log('Next: fill any missing service credentials, then run npm run template:validate');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
