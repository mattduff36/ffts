/**
 * RAMS and projects API smoke/auth coverage.
 *
 * NON-DESTRUCTIVE: uses unauthenticated requests and fake IDs.
 */
import { describe, it } from 'vitest';
import { expectAuthGuard, type ApiRouteProbe } from './helpers';

const ramsAndProjectsRoutes: ApiRouteProbe[] = [
  { method: 'GET', path: '/api/rams' },
  { method: 'POST', path: '/api/rams/upload', body: {} },
  { method: 'POST', path: '/api/rams/fake-id/assign', body: { employeeIds: [] } },
  { method: 'POST', path: '/api/rams/sign', body: {} },
  { method: 'POST', path: '/api/rams/visitor-sign', body: {} },
  { method: 'GET', path: '/api/projects/document-types' },
  { method: 'GET', path: '/api/projects/favourites' },
];

describe('RAMS and Projects API — Auth Guards', () => {
  for (const route of ramsAndProjectsRoutes) {
    it(`${route.method} ${route.path} requires authenticated project access`, async () => {
      await expectAuthGuard(route);
    });
  }
});
