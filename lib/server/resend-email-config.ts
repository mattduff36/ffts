import 'server-only';
import { templateConfig } from '@/lib/config/template-config';

export interface ResendEmailConfig {
  apiKey: string | null;
  fromEmail: string;
}

function readEnvValue(value: string | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function getPrimaryResendEmailConfig(): ResendEmailConfig {
  const primaryApiKey = readEnvValue(process.env.RESEND_API_KEY);
  const primaryFromEmail = readEnvValue(process.env.RESEND_FROM_EMAIL);

  return {
    apiKey: primaryApiKey,
    fromEmail:
      primaryFromEmail || `${templateConfig.branding.shortAppName} <onboarding@resend.dev>`,
  };
}

export function getQuoteResendEmailConfig(): ResendEmailConfig {
  const secondaryApiKey = readEnvValue(process.env.RESEND_API_KEY_2);
  const secondaryFromEmail = readEnvValue(process.env.RESEND_FROM_EMAIL_2);
  const primaryConfig = getPrimaryResendEmailConfig();

  return {
    apiKey: secondaryApiKey || primaryConfig.apiKey,
    fromEmail: secondaryFromEmail || primaryConfig.fromEmail,
  };
}
