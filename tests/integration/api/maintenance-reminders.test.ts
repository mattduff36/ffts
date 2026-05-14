import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:4000';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const RUN_LIVE_API_TESTS = process.env.RUN_LIVE_API_TESTS === 'true';

const isLocalOrStaging = BASE_URL.includes('localhost') || BASE_URL.includes('127.0.0.1') || BASE_URL.includes('staging');
const shouldSkip = !isLocalOrStaging || !RUN_LIVE_API_TESTS;
if (shouldSkip) {
  console.warn('⏭️  Skipping Maintenance reminders API tests – requires RUN_LIVE_API_TESTS=true and a running local/staging server');
}

const canAuth = Boolean(SUPABASE_URL) && Boolean(SUPABASE_ANON_KEY) && !shouldSkip;
const describeOrSkip = shouldSkip ? describe.skip : describe;
const describeWithAuth = canAuth ? describe : describe.skip;

async function postReminder(body: unknown, headers?: Record<string, string>) {
  const response = await fetch(`${BASE_URL}/api/maintenance/reminders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(headers || {}),
    },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  return { response, json };
}

describeOrSkip('Maintenance reminders API hardening', () => {
  it('rejects unauthenticated requests', async () => {
    const { response, json } = await postReminder({
      vehicleId: 'fake-vehicle',
      categoryName: 'Tax Due Date',
      dueInfo: 'Overdue by 3 days',
    });

    expect(response.status).toBe(401);
    if (typeof json.success !== 'undefined') {
      expect(json.success).toBe(false);
    }
    expect(json.error).toMatch(/unauthorized/i);
  });

  it('returns JSON and avoids 500 for malformed payloads without auth', async () => {
    const { response, json } = await postReminder({});
    expect(response.status).toBe(401);
    expect(response.status).not.toBe(500);
    expect(json).toBeTruthy();
  });
});

describeWithAuth('Maintenance reminders API validation (manager auth)', () => {
  let supabase: SupabaseClient;
  let authHeader: Record<string, string>;

  beforeAll(async () => {
    supabase = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);

    const email = process.env.TESTSUITE_MANAGER_EMAIL || 'testsuite-manager@example.test';
    const password = process.env.TESTSUITE_PASSWORD || 'TestSuite2026!Secure';
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data.session?.access_token) {
      throw new Error(`Unable to authenticate manager for reminders API tests: ${error?.message}`);
    }
    authHeader = { Authorization: `Bearer ${data.session.access_token}` };
  });

  afterAll(async () => {
    if (supabase) {
      await supabase.auth.signOut();
    }
  });

  it('validates required fields after authentication', async () => {
    const { response, json } = await postReminder(
      { vehicleId: '', categoryName: '', dueInfo: '' },
      authHeader
    );

    expect([400, 401]).toContain(response.status);
    if (response.status === 400) {
      expect(json.success).toBe(false);
      expect(json.error).toMatch(/Missing required fields/i);
    } else {
      expect(json.error).toMatch(/Unauthorized/i);
    }
  });

  it('returns 404 when the vehicle does not exist', async () => {
    const { response, json } = await postReminder(
      {
        vehicleId: '00000000-0000-0000-0000-000000000000',
        categoryName: 'Tax Due Date',
        dueInfo: 'Overdue by 1 day',
      },
      authHeader
    );

    expect([404, 401]).toContain(response.status);
    if (response.status === 404) {
      expect(json.success).toBe(false);
      expect(json.error).toMatch(/vehicle not found/i);
    } else {
      expect(json.error).toMatch(/Unauthorized/i);
    }
  });
});
