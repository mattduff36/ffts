import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { getQuotesCustomersEmailConfig } from '@/lib/server/quotes-customers-email-config';
import { getPrimaryResendEmailConfig, getQuoteResendEmailConfig } from '@/lib/server/resend-email-config';

const originalResendApiKey = process.env.RESEND_API_KEY;
const originalResendFromEmail = process.env.RESEND_FROM_EMAIL;
const originalResendApiKey2 = process.env.RESEND_API_KEY_2;
const originalResendFromEmail2 = process.env.RESEND_FROM_EMAIL_2;

afterEach(() => {
  restoreEnv('RESEND_API_KEY', originalResendApiKey);
  restoreEnv('RESEND_FROM_EMAIL', originalResendFromEmail);
  restoreEnv('RESEND_API_KEY_2', originalResendApiKey2);
  restoreEnv('RESEND_FROM_EMAIL_2', originalResendFromEmail2);
});

function restoreEnv(key: 'RESEND_API_KEY' | 'RESEND_FROM_EMAIL' | 'RESEND_API_KEY_2' | 'RESEND_FROM_EMAIL_2', value: string | undefined) {
  if (typeof value === 'undefined') {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

describe('getQuotesCustomersEmailConfig', () => {
  it('prefers the dedicated quote resend settings when present', () => {
    process.env.RESEND_API_KEY = 'primary-key';
    process.env.RESEND_FROM_EMAIL = 'Primary <primary@example.com>';
    process.env.RESEND_API_KEY_2 = 'secondary-key';
    process.env.RESEND_FROM_EMAIL_2 = 'Quotes <quotes@example.com>';

    expect(getQuoteResendEmailConfig()).toEqual({
      apiKey: 'secondary-key',
      fromEmail: 'Quotes <quotes@example.com>',
    });
  });

  it('falls back to the primary resend settings when quote values are missing', () => {
    process.env.RESEND_API_KEY = 'primary-key';
    process.env.RESEND_FROM_EMAIL = 'Primary <primary@example.com>';
    delete process.env.RESEND_API_KEY_2;
    delete process.env.RESEND_FROM_EMAIL_2;

    expect(getQuoteResendEmailConfig()).toEqual({
      apiKey: 'primary-key',
      fromEmail: 'Primary <primary@example.com>',
    });
  });

  it('keeps the shared primary config on the main resend account when quote values exist', () => {
    process.env.RESEND_API_KEY = 'primary-key';
    process.env.RESEND_FROM_EMAIL = 'Primary <primary@example.com>';
    process.env.RESEND_API_KEY_2 = 'secondary-key';
    process.env.RESEND_FROM_EMAIL_2 = 'Quotes <quotes@example.com>';

    expect(getPrimaryResendEmailConfig()).toEqual({
      apiKey: 'primary-key',
      fromEmail: 'Primary <primary@example.com>',
    });
  });

  it('keeps the legacy quote helper on the quote routing config', () => {
    process.env.RESEND_API_KEY = 'primary-key';
    process.env.RESEND_FROM_EMAIL = 'Primary <primary@example.com>';
    process.env.RESEND_API_KEY_2 = 'secondary-key';
    process.env.RESEND_FROM_EMAIL_2 = 'Quotes <quotes@example.com>';

    expect(getQuotesCustomersEmailConfig()).toEqual(getQuoteResendEmailConfig());
  });
});
