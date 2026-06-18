export interface DemoBranchConfig {
  enabled: boolean;
  submissionNumber: number | null;
  companyName: string | null;
  contactName: string | null;
  branchName: string | null;
  generatedAt: string | null;
  branding: DemoBranchBrandingConfig | null;
  navigationPriorityHrefs: string[];
  pdf: DemoBranchPdfConfig | null;
}

export interface DemoBranchBrandingConfig {
  appName: string;
  shortAppName: string;
  companyName: string;
  brandColor: string;
  brandColorHover: string;
  brandColorLight: string;
  backgroundColor: string;
  logoPath: string;
  faviconPath: string;
  sourceUrl: string | null;
}

export interface DemoBranchPdfConfig {
  registeredOffice: string;
  contactLine: string;
  registrationLine: string;
}

export const demoBranchConfig: DemoBranchConfig = {
  enabled: false,
  submissionNumber: null,
  companyName: null,
  contactName: null,
  branchName: null,
  generatedAt: null,
  branding: null,
  navigationPriorityHrefs: [],
  pdf: null,
};
