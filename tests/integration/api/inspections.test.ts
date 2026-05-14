import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:4000';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const canAuth =
  Boolean(SUPABASE_URL) &&
  Boolean(SUPABASE_ANON_KEY) &&
  Boolean(process.env.TEST_USER_EMAIL || process.env.TESTSUITE_EMPLOYEE_EMAIL || 'testsuite-employee@example.test');

// SAFETY CHECK: Skip all tests when SUPABASE_URL is not localhost/staging
const isLocalOrStaging = SUPABASE_URL && (SUPABASE_URL.includes('localhost') || SUPABASE_URL.includes('127.0.0.1') || SUPABASE_URL.includes('staging'));
const shouldSkipAll = !isLocalOrStaging;
if (shouldSkipAll) {
  console.warn('⏭️  Skipping Inspections API tests – not running against localhost or staging (URL: %s)', SUPABASE_URL);
}

const describeOrSkip = shouldSkipAll ? describe.skip : describe;
const describeWithAuth = (!shouldSkipAll && canAuth) ? describe : describe.skip;

async function jsonRequest(path: string, init?: RequestInit) {
  const response = await fetch(`${BASE_URL}${path}`, init);
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : null;
  return { response, body };
}

describeOrSkip('Inspections API hardening', () => {
  const unauthRoutes = [
    { method: 'GET', path: '/api/van-inspections/fake-id/pdf' },
    { method: 'DELETE', path: '/api/van-inspections/fake-id/delete' },
    { method: 'GET', path: '/api/van-inspections/locked-defects' },
    { method: 'POST', path: '/api/van-inspections/inform-workshop', body: {} },
    { method: 'POST', path: '/api/van-inspections/sync-defect-tasks', body: {} },
    { method: 'GET', path: '/api/plant-inspections/fake-id/pdf' },
    { method: 'POST', path: '/api/plant-inspections/inform-workshop', body: {} },
    { method: 'POST', path: '/api/plant-inspections/sync-defect-tasks', body: {} },
    { method: 'GET', path: '/api/hgv-inspections/fake-id/pdf' },
    { method: 'POST', path: '/api/hgv-inspections/inform-workshop', body: {} },
    { method: 'POST', path: '/api/hgv-inspections/sync-defect-tasks', body: {} },
  ];

  for (const route of unauthRoutes) {
    it(`${route.method} ${route.path} rejects unauthenticated access and never 500s`, async () => {
      const init: RequestInit = { method: route.method };
      if (route.body) {
        init.headers = { 'Content-Type': 'application/json' };
        init.body = JSON.stringify(route.body);
      }

      const { response, body } = await jsonRequest(route.path, init);
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).not.toBe(500);
      expect(response.headers.get('content-type') || '').toContain('application/json');
      expect(body).toBeTruthy();
    });
  }
});

describeWithAuth('Inspections API payload validation (authenticated)', () => {
  let supabase: SupabaseClient;
  let authHeader: Record<string, string>;

  beforeAll(async () => {
    supabase = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);
    const email = process.env.TESTSUITE_EMPLOYEE_EMAIL || process.env.TEST_USER_EMAIL || 'testsuite-employee@example.test';
    const password = process.env.TESTSUITE_PASSWORD || process.env.TEST_USER_PASSWORD || 'TestSuite2026!Secure';

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.session?.access_token) {
      throw new Error(`Unable to authenticate test user for inspections API tests: ${error?.message}`);
    }
    authHeader = { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' };
  });

  afterAll(async () => {
    if (supabase) {
      await supabase.auth.signOut();
    }
  });

  it('enforces minimum comment length for inform-workshop route', async () => {
    const { response, body } = await jsonRequest('/api/van-inspections/inform-workshop', {
      method: 'POST',
      headers: authHeader,
      body: JSON.stringify({
        inspectionId: 'fake-inspection-id',
        vehicleId: 'fake-vehicle-id',
        comment: 'too short',
      }),
    });

    expect([400, 401]).toContain(response.status);
    if (response.status === 400) {
      expect(body?.error).toMatch(/at least 10 characters/i);
    } else {
      expect(body?.error).toMatch(/unauthorized/i);
    }
  });

  it('rejects missing required fields for sync-defect-tasks route', async () => {
    const { response, body } = await jsonRequest('/api/van-inspections/sync-defect-tasks', {
      method: 'POST',
      headers: authHeader,
      body: JSON.stringify({
        inspectionId: 'fake-inspection-id',
        vehicleId: 'fake-vehicle-id',
        defects: [],
      }),
    });

    expect([400, 401]).toContain(response.status);
    if (response.status === 400) {
      expect(body?.error).toMatch(/Missing required fields/i);
    } else {
      expect(body?.error).toMatch(/unauthorized/i);
    }
  });
});

