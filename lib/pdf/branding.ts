import { templateConfig } from '@/lib/config/template-config';

export function getPdfRegisteredOfficeLine(): string {
  return `REGISTERED OFFICE: ${templateConfig.branding.registeredAddress.toUpperCase()}`;
}

export function getPdfContactLine(): string {
  return templateConfig.branding.supportPhone || `Email: ${templateConfig.branding.supportEmail}`;
}

export function getPdfRegistrationLine(): string {
  return templateConfig.branding.registrationText;
}

