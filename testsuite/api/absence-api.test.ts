/**
 * Absence API smoke and auth guard coverage.
 *
 * NON-DESTRUCTIVE: uses unauthenticated requests and fake IDs where needed.
 */
import { describe, it } from 'vitest';
import { expectAuthGuard, type ApiRouteProbe } from './helpers';

const absenceRoutes: ApiRouteProbe[] = [
  { method: 'GET', path: '/api/absence/archive/status' },
  { method: 'GET', path: '/api/absence/archive/report' },
  { method: 'GET', path: '/api/absence/work-shifts/current' },
  { method: 'GET', path: '/api/absence/work-shift-templates' },
  { method: 'GET', path: '/api/absence/permissions/secondary/me' },
  { method: 'POST', path: '/api/absence/message', body: {} },
  { method: 'POST', path: '/api/absence/fake-id/contact-line-manager', body: {} },
];

describe('Absence API — Auth Guards', () => {
  for (const route of absenceRoutes) {
    it(`${route.method} ${route.path} requires absence access`, async () => {
      await expectAuthGuard(route);
    });
  }
});
