import { createHash } from 'crypto';

export const SCHED_ASSIGNMENT_CONFIRM_TOKEN = 'FFTS_SCHED_ASSIGNMENT_SAME_VISIT';

export type ScheduleAssignmentTargetClass =
  | 'local'
  | 'supabase_direct'
  | 'supabase_session'
  | 'supabase_transaction'
  | 'unknown';

export type ScheduleAssignmentTargetDecision =
  | {
      ok: true;
      targetClass: 'local' | 'supabase_direct' | 'supabase_session';
      fingerprint: string;
      projectRef: string | null;
    }
  | {
      ok: false;
      targetClass: ScheduleAssignmentTargetClass;
      fingerprint: string;
      message: string;
    };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function sha256Fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function parseUrl(connectionString: string): URL {
  return new URL(connectionString);
}

export function projectRefFromSupabaseUrl(appUrl: string | undefined): string | null {
  if (!appUrl) return null;
  try {
    const host = new URL(appUrl).hostname.toLowerCase();
    const match = /^([a-z0-9]+)\.supabase\.co$/u.exec(host);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function classifyScheduleAssignmentTarget(connectionString: string): {
  targetClass: ScheduleAssignmentTargetClass;
  projectRef: string | null;
  port: number;
  fingerprintMaterial: string;
} {
  const url = parseUrl(connectionString);
  const host = url.hostname.toLowerCase();
  const port = Number.parseInt(url.port, 10) || 5432;
  const user = decodeURIComponent(url.username);
  const database = decodeURIComponent(url.pathname.replace(/^\//u, '')) || 'postgres';

  if (LOCAL_HOSTS.has(host)) {
    return {
      targetClass: 'local',
      projectRef: null,
      port,
      fingerprintMaterial: `local:${host}:${port}:${database}`,
    };
  }

  const direct = /^db\.([a-z0-9]+)\.supabase\.co$/u.exec(host);
  if (direct) {
    return {
      targetClass: 'supabase_direct',
      projectRef: direct[1] ?? null,
      port,
      fingerprintMaterial: `supabase_direct:${direct[1]}:${port}:${database}`,
    };
  }

  const sessionUser = /^postgres\.([a-z0-9]+)$/u.exec(user);
  if (sessionUser && port === 5432) {
    return {
      targetClass: 'supabase_session',
      projectRef: sessionUser[1] ?? null,
      port,
      fingerprintMaterial: `supabase_session:${sessionUser[1]}:${port}:${database}`,
    };
  }

  if (port === 6543) {
    return {
      targetClass: 'supabase_transaction',
      projectRef: sessionUser?.[1] ?? null,
      port,
      fingerprintMaterial: `supabase_transaction:${sessionUser?.[1] ?? 'unknown'}:${port}:${database}`,
    };
  }

  return {
    targetClass: 'unknown',
    projectRef: null,
    port,
    fingerprintMaterial: `unknown:${port}:${database}`,
  };
}

export function resolveScheduleAssignmentTarget(params: {
  connectionString: string;
  appSupabaseUrl?: string;
  confirmToken?: string | null;
}): ScheduleAssignmentTargetDecision {
  const classified = classifyScheduleAssignmentTarget(params.connectionString);
  const fingerprint = sha256Fingerprint(classified.fingerprintMaterial);
  const appProjectRef = projectRefFromSupabaseUrl(params.appSupabaseUrl);

  if (classified.targetClass === 'unknown') {
    return {
      ok: false,
      targetClass: classified.targetClass,
      fingerprint,
      message: 'Refusing unknown schedule-assignment target class.',
    };
  }

  if (classified.targetClass === 'supabase_transaction') {
    return {
      ok: false,
      targetClass: classified.targetClass,
      fingerprint,
      message: 'Refusing Supavisor transaction-mode target.',
    };
  }

  if (classified.targetClass === 'local') {
    return {
      ok: true,
      targetClass: 'local',
      fingerprint,
      projectRef: null,
    };
  }

  const confirmed =
    params.confirmToken === SCHED_ASSIGNMENT_CONFIRM_TOKEN;
  if (!confirmed) {
    return {
      ok: false,
      targetClass: classified.targetClass,
      fingerprint,
      message: 'Remote apply requires --confirm=FFTS_SCHED_ASSIGNMENT_SAME_VISIT.',
    };
  }

  if (!classified.projectRef || !appProjectRef || classified.projectRef !== appProjectRef) {
    return {
      ok: false,
      targetClass: classified.targetClass,
      fingerprint,
      message: 'App and database project identity do not match.',
    };
  }

  return {
    ok: true,
    targetClass: classified.targetClass,
    fingerprint,
    projectRef: classified.projectRef,
  };
}

export function formatScheduleAssignmentTargetLog(
  decision: ScheduleAssignmentTargetDecision
): string {
  const status = decision.ok ? 'allowed' : 'refused';
  return `schedule-assignment target ${status} class=${decision.targetClass} fingerprint=${decision.fingerprint}`;
}
