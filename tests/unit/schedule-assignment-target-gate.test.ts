import { describe, expect, it } from 'vitest';
import {
  classifyScheduleAssignmentTarget,
  formatScheduleAssignmentTargetLog,
  resolveScheduleAssignmentTarget,
  SCHED_ASSIGNMENT_CONFIRM_TOKEN,
} from '@/scripts/migrations/schedule-assignment-target-gate';

const APP = 'https://abc123xyz.supabase.co';

describe('schedule assignment target gate', () => {
  it('MIG-SCHED-TARGET-001 allows local, requires confirm, matches project identity, and refuses unsafe targets', () => {
    const local = resolveScheduleAssignmentTarget({
      connectionString: 'postgres://user:pass@localhost:5432/postgres',
      appSupabaseUrl: APP,
    });
    expect(local.ok).toBe(true);
    if (local.ok) expect(local.targetClass).toBe('local');

    const missing = resolveScheduleAssignmentTarget({
      connectionString: 'postgres://postgres.abc123xyz:pass@aws-0-eu-west-2.pooler.supabase.com:5432/postgres',
      appSupabaseUrl: APP,
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.message).toMatch(/--confirm=/);

    const mismatch = resolveScheduleAssignmentTarget({
      connectionString: 'postgres://postgres.otherref:pass@aws-0-eu-west-2.pooler.supabase.com:5432/postgres',
      appSupabaseUrl: APP,
      confirmToken: SCHED_ASSIGNMENT_CONFIRM_TOKEN,
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.message).toMatch(/project identity/);

    const session = resolveScheduleAssignmentTarget({
      connectionString: 'postgres://postgres.abc123xyz:pass@aws-0-eu-west-2.pooler.supabase.com:5432/postgres',
      appSupabaseUrl: APP,
      confirmToken: SCHED_ASSIGNMENT_CONFIRM_TOKEN,
    });
    expect(session.ok).toBe(true);
    if (session.ok) expect(session.targetClass).toBe('supabase_session');

    const direct = resolveScheduleAssignmentTarget({
      connectionString: 'postgres://postgres:pass@db.abc123xyz.supabase.co:5432/postgres',
      appSupabaseUrl: APP,
      confirmToken: SCHED_ASSIGNMENT_CONFIRM_TOKEN,
    });
    expect(direct.ok).toBe(true);
    if (direct.ok) expect(direct.targetClass).toBe('supabase_direct');

    const transaction = resolveScheduleAssignmentTarget({
      connectionString: 'postgres://postgres.abc123xyz:pass@aws-0-eu-west-2.pooler.supabase.com:6543/postgres',
      appSupabaseUrl: APP,
      confirmToken: SCHED_ASSIGNMENT_CONFIRM_TOKEN,
    });
    expect(transaction.ok).toBe(false);
    if (!transaction.ok) expect(transaction.targetClass).toBe('supabase_transaction');

    const unknown = resolveScheduleAssignmentTarget({
      connectionString: 'postgres://user:pass@db.example.com:5432/postgres',
      appSupabaseUrl: APP,
      confirmToken: SCHED_ASSIGNMENT_CONFIRM_TOKEN,
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.targetClass).toBe('unknown');

    const spoofedSession = resolveScheduleAssignmentTarget({
      connectionString: 'postgres://postgres.abc123xyz:pass@db.example.com:5432/postgres',
      appSupabaseUrl: APP,
      confirmToken: SCHED_ASSIGNMENT_CONFIRM_TOKEN,
    });
    expect(spoofedSession.ok).toBe(false);
    if (!spoofedSession.ok) expect(spoofedSession.targetClass).toBe('unknown');

    const log = formatScheduleAssignmentTargetLog(local);
    expect(log).toMatch(/class=local/);
    expect(log).not.toMatch(/localhost|abc123xyz|postgres:\/\//);
  });

  it('MIG-LOCAL-HOST-001 does not treat *.local hosts as local', () => {
    const classified = classifyScheduleAssignmentTarget(
      'postgres://user:pass@db.internal.local:5432/postgres'
    );
    expect(classified.targetClass).not.toBe('local');
    const decision = resolveScheduleAssignmentTarget({
      connectionString: 'postgres://user:pass@ffts.local:5432/postgres',
      appSupabaseUrl: APP,
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.targetClass).toBe('unknown');
  });
});
