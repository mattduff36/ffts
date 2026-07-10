/**
 * Actions API smoke and auth guard coverage.
 *
 * NON-DESTRUCTIVE: uses fake IDs and unauthenticated requests.
 */
import { describe, it } from 'vitest';
import { expectAuthGuard, expectJsonError, type ApiRouteProbe } from './helpers';

const actionsRoutes: ApiRouteProbe[] = [
  { method: 'GET', path: '/api/actions' },
  { method: 'POST', path: '/api/actions/assign', body: { action_id: 'fake-id', assignee_ids: [] } },
  { method: 'POST', path: '/api/actions/fake-id/ignore', body: { duration: '6_weeks' } },
  { method: 'GET', path: '/api/actions/settings/fleet_inspection_overdue' },
  { method: 'PATCH', path: '/api/actions/settings/fleet_inspection_overdue', body: {} },
];

describe('Actions API — Auth Guards', () => {
  for (const route of actionsRoutes) {
    it(`${route.method} ${route.path} requires actions access`, async () => {
      await expectAuthGuard(route);
    });
  }
});

describe('Actions API — JSON error shape', () => {
  for (const route of actionsRoutes) {
    it(`${route.method} ${route.path} responds with JSON on denied access`, async () => {
      await expectJsonError(route);
    });
  }
});
