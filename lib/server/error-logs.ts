import { createAdminClient } from '@/lib/supabase/admin';
import { requireDebugConsoleAccess } from '@/lib/server/debug-console-access';
import type { Database } from '@/types/database';

type ErrorLogInsertRow = Database['public']['Tables']['error_logs']['Insert'];
type ErrorLogRow = Database['public']['Tables']['error_logs']['Row'];

export interface ErrorLogListEntry extends ErrorLogRow {
  user_name: string | null;
}

export interface ErrorLogAccessResult {
  ok: boolean;
  status: number;
  error: string | null;
  code?: string;
  sensitive_access?: unknown;
}

const ERROR_LOG_FETCH_LIMIT_MAX = 500;

function clampLimit(limit: number): number {
  return Math.min(Math.max(Number.isFinite(limit) ? Math.trunc(limit) : 200, 1), ERROR_LOG_FETCH_LIMIT_MAX);
}

export async function requireErrorLogAdminAccess(): Promise<ErrorLogAccessResult> {
  return requireDebugConsoleAccess();
}

export async function listErrorLogs(limit = 200): Promise<ErrorLogListEntry[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('error_logs')
    .select('id, timestamp, error_message, error_stack, error_type, user_id, user_email, page_url, user_agent, component_name, additional_data, created_at')
    .order('timestamp', { ascending: false })
    .limit(clampLimit(limit));

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data || []) as ErrorLogRow[];
  const uniqueUserIds = [...new Set(rows.map((row) => row.user_id).filter((userId): userId is string => Boolean(userId)))];
  let userNameById = new Map<string, string | null>();

  if (uniqueUserIds.length > 0) {
    const { data: profiles, error: profilesError } = await admin
      .from('profiles')
      .select('id, full_name')
      .in('id', uniqueUserIds);

    if (profilesError) {
      throw new Error(profilesError.message);
    }

    userNameById = new Map(
      (profiles || []).map((profile) => [profile.id, profile.full_name || null])
    );
  }

  return rows.map((row) => ({
    ...row,
    user_name: row.user_id ? userNameById.get(row.user_id) || null : null,
  }));
}

export async function clearAllErrorLogs(): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from('error_logs')
    .delete()
    .gte('timestamp', '1970-01-01');

  if (error) {
    throw new Error(error.message);
  }
}

export async function insertErrorLogs(logs: ErrorLogInsertRow[]): Promise<void> {
  if (logs.length === 0) {
    return;
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from('error_logs')
    .insert(logs);

  if (error) {
    throw new Error(error.message);
  }
}
