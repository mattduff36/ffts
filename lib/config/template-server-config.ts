import 'server-only';

import { templateConfig } from '@/lib/config/template-config';

export interface TemplateEmailConfig {
  primaryApiKey?: string;
  primaryFromEmail: string;
  quotesApiKey?: string;
  quotesFromEmail: string;
  adminEmail: string;
  supportEmail: string;
}

function readServerEnv(key: string): string | undefined {
  const value = process.env[key];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

export function getTemplateEmailConfig(): TemplateEmailConfig {
  const fallbackFrom = `${templateConfig.branding.appName} <no-reply@example.test>`;
  const primaryFromEmail = readServerEnv('RESEND_FROM_EMAIL') || fallbackFrom;

  return {
    primaryApiKey: readServerEnv('RESEND_API_KEY'),
    primaryFromEmail,
    quotesApiKey: readServerEnv('RESEND_API_KEY_2') || readServerEnv('RESEND_API_KEY'),
    quotesFromEmail: readServerEnv('RESEND_FROM_EMAIL_2') || primaryFromEmail,
    adminEmail:
      readServerEnv('ADMIN_EMAIL') ||
      readServerEnv('TEMPLATE_SUPERADMIN_EMAIL') ||
      templateConfig.branding.adminEmail,
    supportEmail: readServerEnv('SUPPORT_EMAIL') || templateConfig.branding.supportEmail,
  };
}

export function getTemplateSuperAdminEmail(): string {
  return (
    readServerEnv('TEMPLATE_SUPERADMIN_EMAIL') ||
    readServerEnv('ADMIN_EMAIL') ||
    templateConfig.branding.adminEmail
  );
}
