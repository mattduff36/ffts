import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { mkdirSync } from 'fs';
import { z } from 'zod';

export const setupStatePath = resolve(process.cwd(), 'template-setup.local.json');
export const checklistPath = resolve(process.cwd(), 'template-setup-checklist.md');
export const envLocalPath = resolve(process.cwd(), '.env.local');
export const envExamplePath = resolve(process.cwd(), '.env.example');

export const appModeSchema = z.enum(['development', 'template', 'demo', 'production']);

export const templateSetupSchema = z.object({
  companyName: z.string().min(1),
  appName: z.string().min(1),
  shortAppName: z.string().min(1),
  registeredAddress: z.string().min(1),
  mainAdminEmail: z.string().email(),
  supportEmail: z.string().email().optional(),
  publicAppUrl: z.string().url(),
  appMode: appModeSchema.default('template'),
  supabaseUrl: z.string().url().optional(),
  supabaseAnonKey: z.string().optional(),
  supabaseServiceRoleKey: z.string().optional(),
  databaseConnectionString: z.string().optional(),
  resendSenderEmail: z.string().optional(),
  resendApiKey: z.string().optional(),
  maptilerKey: z.string().optional(),
  dvlaApiKey: z.string().optional(),
  fleetsmartApiKey: z.string().optional(),
  includeDummyData: z.boolean().default(false),
  demoEmailDomain: z.string().min(1).default('demo.example.test'),
  brandColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#F1D64A'),
  brandColorHover: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#D4B83A'),
});

export type TemplateSetupState = z.infer<typeof templateSetupSchema>;

export function loadSetupState(): TemplateSetupState | null {
  if (!existsSync(setupStatePath)) return null;
  const raw = JSON.parse(readFileSync(setupStatePath, 'utf8')) as unknown;
  return templateSetupSchema.parse(raw);
}

export function saveSetupState(state: TemplateSetupState): void {
  writeFileSync(setupStatePath, `${JSON.stringify(state, null, 2)}\n`);
}

export function readEnvFile(path: string): Map<string, string> {
  const values = new Map<string, string>();
  if (!existsSync(path)) return values;

  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) values.set(match[1], match[2]);
  }

  return values;
}

export function writeEnvLocal(values: Map<string, string>): void {
  const lines = Array.from(values.entries()).map(([key, value]) => `${key}=${value}`);
  writeFileSync(envLocalPath, `${lines.join('\n')}\n`);
}

export function ensureDirectoryForFile(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

export function setupStateToEnv(state: TemplateSetupState): Map<string, string> {
  const env = readEnvFile(envExamplePath);

  env.set('APP_MODE', state.appMode);
  env.set('NEXT_PUBLIC_APP_MODE', state.appMode);
  env.set('NEXT_PUBLIC_APP_NAME', state.appName);
  env.set('NEXT_PUBLIC_SHORT_APP_NAME', state.shortAppName);
  env.set('NEXT_PUBLIC_COMPANY_NAME', state.companyName);
  env.set('NEXT_PUBLIC_COMPANY_ADDRESS', state.registeredAddress);
  env.set('NEXT_PUBLIC_ADMIN_EMAIL', state.mainAdminEmail);
  env.set('ADMIN_EMAIL', state.mainAdminEmail);
  env.set('TEMPLATE_SUPERADMIN_EMAIL', state.mainAdminEmail);
  env.set('NEXT_PUBLIC_SUPPORT_EMAIL', state.supportEmail || state.mainAdminEmail);
  env.set('SUPPORT_EMAIL', state.supportEmail || state.mainAdminEmail);
  env.set('NEXT_PUBLIC_APP_URL', state.publicAppUrl);
  env.set('NEXT_PUBLIC_SITE_URL', state.publicAppUrl);
  env.set('NEXT_PUBLIC_BRAND_COLOR', state.brandColor);
  env.set('NEXT_PUBLIC_BRAND_COLOR_HOVER', state.brandColorHover);
  env.set('NEXT_PUBLIC_DEMO_EMAIL_DOMAIN', state.demoEmailDomain);
  env.set('NEXT_PUBLIC_SUPABASE_URL', state.supabaseUrl || '');
  env.set('NEXT_PUBLIC_SUPABASE_ANON_KEY', state.supabaseAnonKey || '');
  env.set('SUPABASE_SERVICE_ROLE_KEY', state.supabaseServiceRoleKey || '');
  env.set('POSTGRES_URL_NON_POOLING', state.databaseConnectionString || '');
  env.set('RESEND_FROM_EMAIL', state.resendSenderEmail || '');
  env.set('RESEND_API_KEY', state.resendApiKey || '');
  env.set('NEXT_PUBLIC_MAPTILER_API_KEY', state.maptilerKey || '');
  env.set('DVLA_API_KEY', state.dvlaApiKey || '');
  env.set('FLEETSMART_API_KEY', state.fleetsmartApiKey || '');

  return env;
}

export function getRequiredEnvKeys(): string[] {
  return [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'APP_MODE',
    'NEXT_PUBLIC_APP_NAME',
    'NEXT_PUBLIC_SHORT_APP_NAME',
    'NEXT_PUBLIC_COMPANY_NAME',
    'NEXT_PUBLIC_COMPANY_ADDRESS',
    'NEXT_PUBLIC_APP_URL',
    'ADMIN_EMAIL',
  ];
}

export function buildChecklist(state: TemplateSetupState): string {
  return `# Template Setup Checklist

Generated for ${state.companyName}.

## Completed Locally
- App mode selected: ${state.appMode}
- Branding values captured
- Environment template generated
- Demo data preference captured: ${state.includeDummyData ? 'include dummy data' : 'do not include dummy data'}

## Manual Service Steps
- Create a customer-owned Supabase project.
- Copy the Supabase URL, anon key, service role key, and database connection string into .env.local.
- Apply the clean baseline SQL for fresh installs or the preserved migration history for ongoing deployments.
- Run npm run db:validate after database setup.
- Create required Supabase storage buckets with npm run setup:storage.
- Verify the Resend sending domain and add RESEND_API_KEY / RESEND_FROM_EMAIL.
- Link the repository to a customer-owned Vercel project.
- Add production environment variables in Vercel.
- Configure DNS for ${state.publicAppUrl}.
- Create optional MapTiler, DVLA/MOT, and FleetSmart accounts if those integrations are enabled.

## Safety
- Rotate secrets for every customer.
- Never reuse demo credentials in production.
- Never run demo:reset outside a dedicated demo project.
`;
}
