import 'server-only';
import type { ResendEmailConfig } from '@/lib/server/resend-email-config';
import {
  getPrimaryResendEmailConfig,
  getQuoteResendEmailConfig,
} from '@/lib/server/resend-email-config';

export function getQuotesCustomersEmailConfig(): ResendEmailConfig {
  return getQuoteResendEmailConfig();
}

export { getPrimaryResendEmailConfig, getQuoteResendEmailConfig };
