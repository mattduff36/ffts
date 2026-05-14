import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { getDemoPersonas, templateConfig } from '@/lib/config/template-config';
import { getDemoUserName, inspectDemoEmailRecipients, isDemoEmail } from '@/lib/utils/demo-email';

describe('template productisation config', () => {
  it('provides central branding defaults', () => {
    expect(templateConfig.branding.appName).toBeTruthy();
    expect(templateConfig.branding.shortAppName).toBeTruthy();
    expect(templateConfig.branding.brandColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('builds demo personas from the configured demo domain', () => {
    const personas = getDemoPersonas();

    expect(personas).toHaveLength(4);
    expect(personas.every((persona) => persona.email.endsWith(`@${templateConfig.demoEmailDomain}`))).toBe(true);
  });
});

describe('demo email utilities', () => {
  it('detects fake demo email recipients', () => {
    expect(isDemoEmail(`avery.stone@${templateConfig.demoEmailDomain}`)).toBe(true);
    expect(isDemoEmail('real.person@example.com')).toBe(false);
  });

  it('separates demo and real recipients', () => {
    const result = inspectDemoEmailRecipients([
      `avery.stone@${templateConfig.demoEmailDomain}`,
      'real.person@example.com',
    ]);

    expect(result.demoRecipients).toEqual([`avery.stone@${templateConfig.demoEmailDomain}`]);
    expect(result.realRecipients).toEqual(['real.person@example.com']);
  });

  it('derives readable names for demo users', () => {
    expect(getDemoUserName(`avery.stone@${templateConfig.demoEmailDomain}`)).toBe('Avery Stone');
  });
});
