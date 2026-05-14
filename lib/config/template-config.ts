export const appModes = {
  development: 'development',
  template: 'template',
  demo: 'demo',
  production: 'production',
} as const;

export type AppMode = (typeof appModes)[keyof typeof appModes];

export interface DemoPersona {
  key: 'admin' | 'manager' | 'employee' | 'contractor';
  label: string;
  name: string;
  description: string;
  email: string;
  password: string;
}

export interface TemplateBrandingConfig {
  appName: string;
  shortAppName: string;
  companyName: string;
  registeredAddress: string;
  supportEmail: string;
  adminEmail: string;
  publicUrl: string;
  logoPath: string;
  faviconPath: string;
  brandColor: string;
  brandColorHover: string;
  backgroundColor: string;
}

export interface TemplatePublicConfig {
  mode: AppMode;
  isDemoMode: boolean;
  demoEmailDomain: string;
  branding: TemplateBrandingConfig;
  demoPersonas: DemoPersona[];
}

function readPublicEnv(key: string, fallback: string): string {
  const value = process.env[key];
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

function normaliseMode(value: string | undefined): AppMode {
  if (value === appModes.template || value === appModes.demo || value === appModes.production) {
    return value;
  }

  return appModes.development;
}

function trimLeadingAt(value: string): string {
  return value.startsWith('@') ? value.slice(1) : value;
}

const mode = normaliseMode(process.env.NEXT_PUBLIC_APP_MODE || process.env.APP_MODE);
const demoEmailDomain = trimLeadingAt(readPublicEnv('NEXT_PUBLIC_DEMO_EMAIL_DOMAIN', 'demo.example.test'));

export const templateConfig: TemplatePublicConfig = {
  mode,
  isDemoMode: mode === appModes.demo,
  demoEmailDomain,
  branding: {
    appName: readPublicEnv('NEXT_PUBLIC_APP_NAME', 'DigiDocs'),
    shortAppName: readPublicEnv('NEXT_PUBLIC_SHORT_APP_NAME', 'DigiDocs'),
    companyName: readPublicEnv('NEXT_PUBLIC_COMPANY_NAME', 'DigiDocs Demo Ltd'),
    registeredAddress: readPublicEnv(
      'NEXT_PUBLIC_COMPANY_ADDRESS',
      'Example House, Template Street, Example Town'
    ),
    supportEmail: readPublicEnv('NEXT_PUBLIC_SUPPORT_EMAIL', 'support@example.test'),
    adminEmail: readPublicEnv('NEXT_PUBLIC_ADMIN_EMAIL', 'template-admin@example.com'),
    publicUrl: readPublicEnv(
      'NEXT_PUBLIC_APP_URL',
      readPublicEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:4000')
    ),
    logoPath: readPublicEnv('NEXT_PUBLIC_LOGO_PATH', '/images/logo.svg'),
    faviconPath: readPublicEnv('NEXT_PUBLIC_FAVICON_PATH', '/favicon.svg'),
    brandColor: readPublicEnv('NEXT_PUBLIC_BRAND_COLOR', '#F1D64A'),
    brandColorHover: readPublicEnv('NEXT_PUBLIC_BRAND_COLOR_HOVER', '#D4B83A'),
    backgroundColor: readPublicEnv('NEXT_PUBLIC_PWA_BACKGROUND_COLOR', '#0f172a'),
  },
  demoPersonas: [
    {
      key: 'admin',
      label: 'Administrator',
      name: 'Avery Stone',
      description: 'Full system access and admin controls',
      email: `avery.stone@${demoEmailDomain}`,
      password: 'DemoPass123!',
    },
    {
      key: 'manager',
      label: 'Manager',
      name: 'Morgan Reid',
      description: 'Team oversight, approvals, and reports',
      email: `morgan.reid@${demoEmailDomain}`,
      password: 'DemoPass123!',
    },
    {
      key: 'employee',
      label: 'Employee',
      name: 'Jamie Carter',
      description: 'Timesheets, inspections, and messages',
      email: `jamie.carter@${demoEmailDomain}`,
      password: 'DemoPass123!',
    },
    {
      key: 'contractor',
      label: 'Contractor',
      name: 'Taylor Brooks',
      description: 'Limited access demo contractor profile',
      email: `taylor.brooks@${demoEmailDomain}`,
      password: 'DemoPass123!',
    },
  ],
};

export function getTemplateConfig(): TemplatePublicConfig {
  return templateConfig;
}

export function isDemoModeEnabled(): boolean {
  return templateConfig.isDemoMode;
}

export function getDemoPersonas(): DemoPersona[] {
  return templateConfig.demoPersonas;
}
