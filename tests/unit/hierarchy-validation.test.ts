import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  isBlockingHierarchyIssue,
  isMissingHierarchySchemaError,
  runHierarchyValidation,
} from '@/lib/server/hierarchy-validation';

type MockRow = {
  id: string;
  full_name: string | null;
  team_id?: string | null;
  line_manager_id?: string | null;
  secondary_manager_id?: string | null;
  is_placeholder?: boolean | null;
  role?: { role_class?: 'admin' | 'manager' | 'employee' } | null;
};

type MockTeam = {
  id: string;
  name: string;
  manager_1_profile_id?: string | null;
  manager_2_profile_id?: string | null;
};

type MockReportingLine = {
  profile_id: string;
  manager_profile_id: string;
  relation_type: 'primary' | 'secondary' | 'line_manager';
};

function buildClient(
  rows: MockRow[],
  teams: MockTeam[] = [],
  reportingLines: MockReportingLine[] = [],
  error: unknown = null
) {
  return {
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            order: async () => ({ data: rows, error }),
          }),
        };
      }

      if (table === 'org_teams') {
        return {
          select: () => ({
            order: async () => ({ data: teams, error }),
          }),
        };
      }

      return {
        select: () => ({
          in: () => ({
            is: async () => ({ data: reportingLines, error }),
          }),
        }),
      };
    },
  } as unknown as SupabaseClient;
}

describe('runHierarchyValidation', () => {
  it('treats drift and advisory hierarchy issues as non-blocking', () => {
    expect(isBlockingHierarchyIssue('MISSING_TEAM')).toBe(true);
    expect(isBlockingHierarchyIssue('MISSING_LINE_MANAGER')).toBe(true);
    expect(isBlockingHierarchyIssue('SELF_MANAGER')).toBe(true);
    expect(isBlockingHierarchyIssue('UNKNOWN_MANAGER')).toBe(true);
    expect(isBlockingHierarchyIssue('MANAGER_CYCLE')).toBe(true);

    expect(isBlockingHierarchyIssue('INVALID_MANAGER_ROLE')).toBe(false);
    expect(isBlockingHierarchyIssue('MANAGER_SHOULD_NOT_HAVE_MANAGER')).toBe(false);
    expect(isBlockingHierarchyIssue('TEAM_MANAGER_DRIFT')).toBe(false);
    expect(isBlockingHierarchyIssue('INVALID_TEAM_MANAGER')).toBe(false);
  });

  it('does not treat constraint errors mentioning columns as missing schema', () => {
    expect(
      isMissingHierarchySchemaError({
        code: '23502',
        message: 'null value in column "team_id" of relation "profiles" violates not-null constraint',
      })
    ).toBe(false);

    expect(
      isMissingHierarchySchemaError({
        message: 'column "team_id" does not exist',
      })
    ).toBe(true);
  });

  it('returns configured false when schema is missing', async () => {
    const client = buildClient([], [], [], { code: '42703', message: 'column does not exist' });
    const result = await runHierarchyValidation(client);

    expect(result.configured).toBe(false);
    expect(result.issues).toHaveLength(0);
    expect(result.blocking_issue_count).toBe(0);
  });

  it('detects manager cycle and unknown manager issues', async () => {
    const rows: MockRow[] = [
      {
        id: 'a',
        full_name: 'Alice',
        team_id: 'transport',
        line_manager_id: 'b',
        role: { role_class: 'employee' },
      },
      {
        id: 'b',
        full_name: 'Bob',
        team_id: 'transport',
        line_manager_id: 'a',
        role: { role_class: 'manager' },
      },
      {
        id: 'c',
        full_name: 'Cara',
        team_id: 'workshop_yard',
        line_manager_id: 'missing-manager',
        role: { role_class: 'employee' },
      },
    ];

    const teams: MockTeam[] = [
      { id: 'transport', name: 'Transport', manager_1_profile_id: 'b' },
      { id: 'workshop_yard', name: 'Workshop Yard', manager_1_profile_id: 'missing-manager' },
    ];

    const result = await runHierarchyValidation(buildClient(rows, teams));

    expect(result.configured).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'MANAGER_CYCLE' && issue.profile_id === 'a')).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'MANAGER_CYCLE' && issue.profile_id === 'b')).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'UNKNOWN_MANAGER' && issue.profile_id === 'c')).toBe(true);
    expect(result.blocking_issue_count).toBeGreaterThan(0);
  });

  it('supports team-scoped responses while retaining overall team issue counts', async () => {
    const rows: MockRow[] = [
      {
        id: 'transport-employee',
        full_name: 'Transport Employee',
        team_id: 'transport',
        line_manager_id: null,
        role: { role_class: 'employee' },
      },
      {
        id: 'workshop-employee',
        full_name: 'Workshop Employee',
        team_id: 'workshop_yard',
        line_manager_id: null,
        role: { role_class: 'employee' },
      },
    ];

    const teams: MockTeam[] = [
      { id: 'transport', name: 'Transport', manager_1_profile_id: 'transport-manager' },
      { id: 'workshop_yard', name: 'Workshop Yard', manager_1_profile_id: 'workshop-manager' },
    ];
    const reportingLines: MockReportingLine[] = [
      { profile_id: 'transport-employee', manager_profile_id: 'transport-manager', relation_type: 'primary' },
      { profile_id: 'workshop-employee', manager_profile_id: 'workshop-manager', relation_type: 'primary' },
    ];
    const extendedRows: MockRow[] = [
      ...rows,
      { id: 'transport-manager', full_name: 'Transport Manager', team_id: 'transport', role: { role_class: 'manager' } },
      { id: 'workshop-manager', full_name: 'Workshop Manager', team_id: 'workshop_yard', role: { role_class: 'manager' } },
    ];

    const result = await runHierarchyValidation(buildClient(extendedRows, teams, reportingLines), { teamId: 'transport' });

    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.every((issue) => issue.team_id === 'transport')).toBe(true);
    expect(result.team_issue_counts.transport).toBeGreaterThan(0);
    expect(result.team_issue_counts.workshop_yard).toBeGreaterThan(0);
  });

  it('flags managers who still have managers and employee manager drift', async () => {
    const rows: MockRow[] = [
      {
        id: 'employee-1',
        full_name: 'Employee One',
        team_id: 'transport',
        line_manager_id: 'employee-manager',
        role: { role_class: 'employee' },
      },
      {
        id: 'employee-manager',
        full_name: 'Employee Manager',
        team_id: 'transport',
        role: { role_class: 'employee' },
      },
      {
        id: 'manager-1',
        full_name: 'Manager One',
        team_id: 'transport',
        line_manager_id: 'admin-1',
        role: { role_class: 'manager' },
      },
      {
        id: 'admin-1',
        full_name: 'Admin One',
        team_id: 'transport',
        role: { role_class: 'admin' },
      },
    ];
    const teams: MockTeam[] = [
      { id: 'transport', name: 'Transport', manager_1_profile_id: 'manager-1' },
    ];

    const result = await runHierarchyValidation(buildClient(rows, teams));

    expect(result.issues.some((issue) => issue.code === 'INVALID_MANAGER_ROLE' && issue.profile_id === 'employee-1')).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'MANAGER_SHOULD_NOT_HAVE_MANAGER' && issue.profile_id === 'manager-1')).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'TEAM_MANAGER_DRIFT' && issue.profile_id === 'employee-1')).toBe(true);
  });
});
