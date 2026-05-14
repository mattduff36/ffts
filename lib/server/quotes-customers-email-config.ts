import 'server-only';

import { getTemplateEmailConfig } from '@/lib/config/template-server-config';

export interface QuotesCustomersEmailConfig {
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

export function getQuotesCustomersEmailConfig(): QuotesCustomersEmailConfig {
  const templateEmail = getTemplateEmailConfig();
  const secondaryApiKey = readEnvValue(process.env.RESEND_API_KEY_2);
  const primaryApiKey = readEnvValue(process.env.RESEND_API_KEY);
  const secondaryFromEmail = readEnvValue(process.env.RESEND_FROM_EMAIL_2);
  const primaryFromEmail = readEnvValue(process.env.RESEND_FROM_EMAIL);

  return {
    apiKey: secondaryApiKey || primaryApiKey || templateEmail.quotesApiKey || null,
    fromEmail: secondaryFromEmail || primaryFromEmail || templateEmail.quotesFromEmail,
  };
}
