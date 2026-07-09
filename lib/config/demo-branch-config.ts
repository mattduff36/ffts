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
  welcome: DemoBranchWelcomeConfig | null;
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

export interface DemoBranchWelcomeConfig {
  companyDisplayName: string;
  industryLabel: string | null;
  operatingRegion: string | null;
  companySizeLabel: string | null;
  primaryDemoObjectiveLabel: string | null;
  priorityModuleLabels: string[];
  painPointLabels: string[];
  teamLabels: string[];
  assetLabels: string[];
  documentOutputLabels: string[];
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
  welcome: null,
};
