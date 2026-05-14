import { templateConfig } from '@/lib/config/template-config';

export interface DemoEmailCheck {
  isDemoMode: boolean;
  demoDomain: string;
  demoRecipients: string[];
  realRecipients: string[];
  shouldSimulate: boolean;
}

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function getDemoEmailDomain(): string {
  return templateConfig.demoEmailDomain;
}

export function isDemoEmail(email: string, domain = getDemoEmailDomain()): boolean {
  return normaliseEmail(email).endsWith(`@${domain.toLowerCase()}`);
}

export function hasDemoEmails(emails: string | string[]): boolean {
  const list = Array.isArray(emails) ? emails : [emails];
  return list.some((email) => isDemoEmail(email));
}

export function getDemoUserName(email: string): string {
  if (!isDemoEmail(email)) return email;

  return email
    .split('@')[0]
    .split('.')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function replaceDemoEmail(originalEmail: string | string[], realEmail: string): string | string[] {
  if (Array.isArray(originalEmail)) {
    return originalEmail.map((email) => (isDemoEmail(email) ? realEmail : email));
  }

  return isDemoEmail(originalEmail) ? realEmail : originalEmail;
}

export function inspectDemoEmailRecipients(emails: string | string[]): DemoEmailCheck {
  const list = Array.isArray(emails) ? emails : [emails];
  const demoRecipients = list.filter((email) => isDemoEmail(email));
  const realRecipients = list.filter((email) => !isDemoEmail(email));

  return {
    isDemoMode: templateConfig.isDemoMode,
    demoDomain: templateConfig.demoEmailDomain,
    demoRecipients,
    realRecipients,
    shouldSimulate: templateConfig.isDemoMode && demoRecipients.length > 0,
  };
}
