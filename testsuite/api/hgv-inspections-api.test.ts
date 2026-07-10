/**
 * HGV Inspections API Integration Tests
 *
 * NON-DESTRUCTIVE: uses fake IDs and unauthenticated requests for guard/schema checks.
 */
import { describe, it } from 'vitest';
import { expectAuthGuard, expectJsonError, type ApiRouteProbe } from './helpers';

const hgvRoutes: ApiRouteProbe[] = [
  { method: 'GET', path: '/api/hgv-inspections/fake-id/pdf' },
  { method: 'DELETE', path: '/api/hgv-inspections/fake-id/delete' },
  { method: 'POST', path: '/api/hgv-inspections/fake-id/discard', body: {} },
  { method: 'GET', path: '/api/hgv-inspections/locked-defects' },
  { method: 'GET', path: '/api/hgv-inspections/recent-completed-defects' },
  { method: 'POST', path: '/api/hgv-inspections/inform-workshop', body: {} },
  { method: 'POST', path: '/api/hgv-inspections/sync-defect-tasks', body: {} },
];

describe('HGV Inspections — Auth Guards', () => {
  for (const route of hgvRoutes) {
    it(`${route.method} ${route.path} requires authentication`, async () => {
      await expectAuthGuard(route);
    });
  }
});

describe('HGV Inspections — JSON error shape', () => {
  for (const route of hgvRoutes.slice(0, 4)) {
    it(`${route.method} ${route.path} responds with JSON error`, async () => {
      await expectJsonError(route);
    });
  }
});
