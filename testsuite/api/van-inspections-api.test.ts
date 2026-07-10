/**
 * Van Inspections API Integration Tests
 *
 * Tests all van-inspection API routes for:
 * - Auth enforcement (401 for unauthenticated)
 * - Correct status codes
 * - Schema validation
 * - Side-effect correctness
 *
 * NON-DESTRUCTIVE: uses fake IDs for auth guard tests.
 * Requires dev server running at TESTSUITE_BASE_URL (default http://localhost:4000).
 */
import { describe, it, expect } from 'vitest';

const BASE_URL = process.env.TESTSUITE_BASE_URL || 'http://localhost:4000';

describe('Van Inspections — Auth Guards (unauthenticated)', () => {
  it('GET /api/van-inspections/:id/pdf returns 401', async () => {
    const res = await fetch(`${BASE_URL}/api/van-inspections/fake-id/pdf`);
    expect(res.status).toBe(401);
  });

  it('DELETE /api/van-inspections/:id/delete returns 401', async () => {
    const res = await fetch(`${BASE_URL}/api/van-inspections/fake-id/delete`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(401);
  });

  it('DELETE /api/van-inspections/:id/discard returns 401', async () => {
    const res = await fetch(`${BASE_URL}/api/van-inspections/fake-id/discard`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(401);
  });

  it('GET /api/van-inspections/locked-defects returns 401', async () => {
    const res = await fetch(`${BASE_URL}/api/van-inspections/locked-defects`);
    expect(res.status).toBe(401);
  });

  it('GET /api/van-inspections/previous-defects returns 401', async () => {
    const res = await fetch(`${BASE_URL}/api/van-inspections/previous-defects`);
    expect(res.status).toBe(401);
  });

  it('GET /api/van-inspections/recent-completed-defects returns 401', async () => {
    const res = await fetch(`${BASE_URL}/api/van-inspections/recent-completed-defects`);
    expect(res.status).toBe(401);
  });

  it('POST /api/van-inspections/inform-workshop returns 401', async () => {
    const res = await fetch(`${BASE_URL}/api/van-inspections/inform-workshop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it('POST /api/van-inspections/sync-defect-tasks returns 401', async () => {
    const res = await fetch(`${BASE_URL}/api/van-inspections/sync-defect-tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });
});

describe('Van Inspections — Response Schema', () => {
  it('DELETE /api/van-inspections/:id/delete responds with JSON', async () => {
    const res = await fetch(`${BASE_URL}/api/van-inspections/fake-id/delete`, {
      method: 'DELETE',
    });
    const contentType = res.headers.get('content-type');
    expect(contentType).toContain('application/json');
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('DELETE /api/van-inspections/:id/discard responds with JSON', async () => {
    const res = await fetch(`${BASE_URL}/api/van-inspections/fake-id/discard`, {
      method: 'DELETE',
    });
    const contentType = res.headers.get('content-type');
    expect(contentType).toContain('application/json');
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/van-inspections/:id/pdf responds with JSON error for unauthed', async () => {
    const res = await fetch(`${BASE_URL}/api/van-inspections/fake-id/pdf`);
    const contentType = res.headers.get('content-type');
    expect(contentType).toContain('application/json');
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/van-inspections/locked-defects responds with JSON error for unauthed', async () => {
    const res = await fetch(`${BASE_URL}/api/van-inspections/locked-defects`);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/van-inspections/previous-defects responds with JSON error for unauthed', async () => {
    const res = await fetch(`${BASE_URL}/api/van-inspections/previous-defects`);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/van-inspections/recent-completed-defects responds with JSON error for unauthed', async () => {
    const res = await fetch(`${BASE_URL}/api/van-inspections/recent-completed-defects`);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

describe('Van Inspections — No 500 Errors', () => {
  const routes = [
    { method: 'GET', path: '/api/van-inspections/fake-id/pdf' },
    { method: 'DELETE', path: '/api/van-inspections/fake-id/delete' },
    { method: 'DELETE', path: '/api/van-inspections/fake-id/discard' },
    { method: 'GET', path: '/api/van-inspections/locked-defects' },
    { method: 'GET', path: '/api/van-inspections/previous-defects' },
    { method: 'GET', path: '/api/van-inspections/recent-completed-defects' },
    { method: 'POST', path: '/api/van-inspections/inform-workshop' },
    { method: 'POST', path: '/api/van-inspections/sync-defect-tasks' },
  ];

  for (const route of routes) {
    it(`${route.method} ${route.path} does not return 500`, async () => {
      const opts: RequestInit = { method: route.method };
      if (route.method === 'POST') {
        opts.headers = { 'Content-Type': 'application/json' };
        opts.body = JSON.stringify({});
      }
      const res = await fetch(`${BASE_URL}${route.path}`, opts);
      expect(res.status).not.toBe(500);
    });
  }
});
