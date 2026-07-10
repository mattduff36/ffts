/**
 * @tags @permissions
 * Converted from: TC018_Role_based_permission_checks_on_API_endpoints.py
 *
 * Vitest integration tests for API endpoint role-based access control.
 * NON-DESTRUCTIVE: only makes GET requests to verify access control.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';
import { createAdminClient } from '@/lib/supabase/admin';
import { getUsablePermissionAccessLevel, isPermissionLevelAllowedForModule } from '@/lib/config/permission-access-rules';
import { getUserPermissionMatrix } from '@/lib/server/team-permissions';
import type { ModuleName, PermissionAccessLevel } from '@/types/roles';

config({ path: resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const BASE_URL = process.env.TESTSUITE_BASE_URL || 'http://localhost:4000';

interface TestUsers {
  admin: { email: string; password: string; userId: string };
  manager: { email: string; password: string; userId: string };
  employee: { email: string; password: string; userId: string };
}

interface ReachableRouteResult {
  ok: true;
  response: Response;
}

interface UnreachableRouteResult {
  ok: false;
  message: string;
}

type RouteResult = ReachableRouteResult | UnreachableRouteResult;

interface UserModulePermissionRow {
  user_id: string;
  module_name: ModuleName;
  access_level: number;
}

const UNIVERSAL_PERMISSION_MODULES = new Set<ModuleName>(['reminders']);
const UNIVERSAL_PERMISSION_ACCESS_LEVEL: PermissionAccessLevel = 5;

function requireTestUsers(testUsers: TestUsers | null): TestUsers {
  if (!testUsers) {
    throw new Error('Test users not provisioned. Run npm run testsuite:setup before authenticated permission tests.');
  }
  return testUsers;
}

function loadTestUsers(): TestUsers | null {
  const stateFile = resolve(process.cwd(), 'testsuite', '.state', 'test-users.json');
  if (!existsSync(stateFile)) return null;
  return JSON.parse(readFileSync(stateFile, 'utf-8'));
}

function normalizePermissionAccessLevel(value: number | null | undefined): PermissionAccessLevel {
  if (value === 5) return 5;
  if (value === 4) return 4;
  if (value === 3) return 3;
  if (value === 2) return 2;
  if (value === 1) return 1;
  return 0;
}

async function fetchAllUserModulePermissionRows(): Promise<UserModulePermissionRow[]> {
  const supabase = createAdminClient();
  const pageSize = 1000;
  const rows: UserModulePermissionRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('user_module_permissions')
      .select('user_id, module_name, access_level')
      .order('user_id', { ascending: true })
      .order('module_name', { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`Failed to load user module permission rows: ${error.message}`);
    }

    const pageRows = (data || []) as UserModulePermissionRow[];
    rows.push(...pageRows);

    if (pageRows.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return rows;
}

async function fetchRoute(path: string, init?: RequestInit): Promise<RouteResult> {
  try {
    const response = await fetch(`${BASE_URL}${path}`, init);
    return { ok: true, response };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown fetch error';
    return {
      ok: false,
      message: `Could not reach ${BASE_URL}${path}: ${message}`,
    };
  }
}

function expectReachable(result: RouteResult, path: string): Response {
  if (!result.ok) {
    throw new Error(result.message);
  }

  if (result.response.status >= 500) {
    throw new Error(
      `${path} returned ${result.response.status}. This indicates an app-health issue, not an access-control regression.`
    );
  }

  return result.response;
}

describe('@permissions API Endpoint Access Control', () => {
  let employeeClient: SupabaseClient;
  let testUsers: TestUsers | null;

  beforeAll(async () => {
    testUsers = loadTestUsers();
    if (!testUsers) {
      return;
    }

    // Create an employee-authenticated client
    employeeClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { error } = await employeeClient.auth.signInWithPassword({
      email: testUsers.employee.email,
      password: testUsers.employee.password,
    });
    if (error) {
      throw new Error(`Could not authenticate employee for API tests: ${error.message}`);
    }
  });

  describe('Unauthenticated requests return 401', () => {
    const protectedEndpoints = [
      '/api/admin/users',
      '/api/admin/roles',
      '/api/admin/vans',
      '/api/admin/categories',
      '/api/reports/stats',
    ];

    for (const endpoint of protectedEndpoints) {
      it(`GET ${endpoint} returns 401 without auth`, async () => {
        const res = expectReachable(await fetchRoute(endpoint), endpoint);
        expect(res.status).toBe(401);
      });
    }
  });

  describe('Employee cannot access admin-only endpoints', () => {
    it('employee cannot list users via API', async () => {
      requireTestUsers(testUsers);

      const { data: session } = await employeeClient.auth.getSession();
      expect(session?.session?.access_token, 'Employee session token should be available').toBeTruthy();

      const res = expectReachable(await fetchRoute('/api/admin/users', {
        headers: {
          'Authorization': `Bearer ${session.session.access_token}`,
        },
      }), '/api/admin/users');
      // Should be 401 or 403
      expect(res.status).toBeGreaterThanOrEqual(401);
      expect(res.status).toBeLessThanOrEqual(403);
    });
  });

  describe('Public endpoints', () => {
    it('login page is accessible', async () => {
      const res = expectReachable(await fetchRoute('/login'), '/login');
      expect(res.status).toBe(200);
    });
  });

  describe('User permission matrix regressions', () => {
    it('loads persisted user overrides beyond the default Supabase page size', async () => {
      const supabase = createAdminClient();
      const [matrix, storedPermissionRows] = await Promise.all([
        getUserPermissionMatrix(supabase),
        fetchAllUserModulePermissionRows(),
      ]);
      const usersById = new Map(matrix.users.map((user) => [user.id, user]));
      const modulesByName = new Map(matrix.modules.map((permissionModule) => [
        permissionModule.module_name,
        permissionModule,
      ]));
      const checkedOverrides: string[] = [];
      const mismatches: string[] = [];

      expect(
        storedPermissionRows.length,
        'This regression test must cover Supabase responses larger than the default 1000-row range.'
      ).toBeGreaterThan(1000);

      storedPermissionRows.forEach((row) => {
        const user = usersById.get(row.user_id);
        const permissionModule = modulesByName.get(row.module_name);
        if (!user || !permissionModule || user.is_locked_admin) return;

        const expectedLevel = UNIVERSAL_PERMISSION_MODULES.has(row.module_name)
          ? UNIVERSAL_PERMISSION_ACCESS_LEVEL
          : getUsablePermissionAccessLevel(
              permissionModule,
              normalizePermissionAccessLevel(row.access_level),
              { hasFullAccessRole: false }
            );
        const actualLevel = user.permissions[row.module_name] ?? 0;
        checkedOverrides.push(`${row.user_id}:${row.module_name}`);

        if (actualLevel !== expectedLevel) {
          mismatches.push(`${user.full_name || row.user_id} ${row.module_name}: expected ${expectedLevel}, got ${actualLevel}`);
        }
      });

      expect(checkedOverrides.length).toBeGreaterThan(0);
      expect(mismatches).toEqual([]);
    });

    it('keeps hard module minimums future-proofed in the matrix metadata', async () => {
      const matrix = await getUserPermissionMatrix(createAdminClient());
      const toolboxTalks = matrix.modules.find((permissionModule) => permissionModule.module_name === 'toolbox-talks');
      const adminSettings = matrix.modules.find((permissionModule) => permissionModule.module_name === 'admin-settings');

      expect(toolboxTalks?.enforced_minimum_access_level).toBe(4);
      expect(adminSettings?.enforced_minimum_access_level).toBe(4);
      expect(toolboxTalks && isPermissionLevelAllowedForModule(toolboxTalks, 3, { hasFullAccessRole: false })).toBe(false);
      expect(toolboxTalks && isPermissionLevelAllowedForModule(toolboxTalks, 4, { hasFullAccessRole: false })).toBe(true);
      expect(adminSettings && isPermissionLevelAllowedForModule(adminSettings, 4, { hasFullAccessRole: false })).toBe(true);
    });

    it('exposes sensitive PIN metadata for matrix header toggles', async () => {
      const supabase = createAdminClient();
      const [matrix, modulesResult] = await Promise.all([
        getUserPermissionMatrix(supabase),
        supabase
          .from('permission_modules')
          .select('module_name, requires_sensitive_pin'),
      ]);

      if (modulesResult.error) {
        throw new Error(`Failed to load permission modules: ${modulesResult.error.message}`);
      }

      const dbSensitivePinByModule = new Map(
        (modulesResult.data || []).map((permissionModule) => [
          permissionModule.module_name,
          permissionModule.requires_sensitive_pin === true,
        ])
      );

      expect(matrix.modules.length).toBeGreaterThan(0);
      matrix.modules.forEach((permissionModule) => {
        expect(typeof permissionModule.requires_sensitive_pin).toBe('boolean');
        expect(permissionModule.requires_sensitive_pin).toBe(dbSensitivePinByModule.get(permissionModule.module_name));
      });
    });
  });
});
