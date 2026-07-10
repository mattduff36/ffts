export type ErrorClassificationCategory =
  | 'user_error_expected'
  | 'codebase_error'
  | 'connection_error'
  | 'other';

export interface ErrorHandlingSnapshot {
  wasHandled?: boolean;
  didShowMessage?: boolean | null;
  messageChannel?: 'toast' | 'inline' | 'modal' | 'unknown';
  userMessage?: string | null;
  userMessageTitle?: string | null;
  userMessageDescription?: string | null;
  correlationKey?: string | null;
}

export interface ErrorClassificationSnapshot {
  category?: ErrorClassificationCategory | string;
  confidence?: 'high' | 'medium' | 'low' | string;
  reason?: string;
}

export interface ErrorUserActionSnapshot {
  actionType?: 'click' | 'submit' | 'keyboard' | 'navigation' | 'unknown' | string;
  label?: string | null;
  element?: string | null;
  href?: string | null;
  pageUrl?: string;
  timestamp?: string;
  ageMs?: number;
}

export interface ErrorAdditionalData extends Record<string, unknown> {
  errorHandling?: ErrorHandlingSnapshot;
  errorClassification?: ErrorClassificationSnapshot;
  userAction?: ErrorUserActionSnapshot;
  userMessage?: string | null;
  userMessageTitle?: string | null;
  userMessageDescription?: string | null;
  toastCorrelationKey?: string | null;
}

export interface AuditLogEntry {
  id: string;
  table_name: string;
  record_id: string;
  user_id: string | null;
  user_name: string;
  team_id: string | null;
  action: string;
  changes: Record<string, { old?: unknown; new?: unknown }> | null;
  created_at: string | null;
}

export interface ErrorLogEntry {
  id: string;
  timestamp: string;
  error_message: string;
  error_stack: string | null;
  error_type: string;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
  page_url: string;
  user_agent: string;
  component_name: string | null;
  additional_data: ErrorAdditionalData | null;
}

export interface UsageAnalyticsSummary {
  totalEvents: number;
  uniqueUsers: number;
  sessionCount: number;
  pageViews: number;
  errorEvents: number;
  activeSessions: number;
  avgDurationMs: number | null;
}

export interface UsageAnalyticsBreakdown {
  label: string;
  events: number;
  users: number;
  sessions: number;
  pageViews: number;
}

export interface UsageAnalyticsInsight {
  title: string;
  value: string;
  detail: string;
  tone: 'info' | 'success' | 'warning' | 'danger' | 'neutral';
}

export interface UsageAnalyticsPlainSummary {
  headline: string;
  highlights: UsageAnalyticsInsight[];
}

export interface UsageAnalyticsPayload {
  success: true;
  generatedAt: string;
  range: {
    start: string;
    end: string;
  };
  summary: UsageAnalyticsSummary;
  topModules: Array<{ module: string; events: number; users: number }>;
  topPages: Array<{ path: string; views: number; users: number }>;
  topEvents: Array<{ eventName: string; events: number; users: number }>;
  usageSummary: UsageAnalyticsPlainSummary;
  topTeams: UsageAnalyticsBreakdown[];
  roleBreakdown: UsageAnalyticsBreakdown[];
  deviceBreakdown: UsageAnalyticsBreakdown[];
  activeSessions: Array<{
    id: string;
    userId: string | null;
    userName: string;
    teamName: string | null;
    roleName: string | null;
    lastSeenAt: string;
    entryPath: string | null;
    exitPath: string | null;
    deviceType: string | null;
    browserName: string | null;
    eventCount: number;
    pageViewCount: number;
  }>;
  recentEvents: Array<{
    id: string;
    occurredAt: string;
    eventName: string;
    eventCategory: string;
    module: string | null;
    path: string | null;
    userId: string | null;
    userName: string;
    teamName: string | null;
    roleName: string | null;
    deviceType: string | null;
    sessionId: string | null;
    metadata: Record<string, unknown>;
  }>;
}

export interface TestVehicle {
  id: string;
  reg_number: string;
  nickname: string | null;
  status: string;
  fleet_type: 'van' | 'hgv' | 'plant';
}

export interface PurgeActions {
  inspections: boolean;
  workshop_tasks: boolean;
  maintenance: boolean;
  attachments: boolean;
  archives: boolean;
}
