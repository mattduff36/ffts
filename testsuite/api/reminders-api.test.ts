/**
 * Reminders API smoke and auth guard coverage.
 *
 * NON-DESTRUCTIVE: uses fake IDs and unauthenticated requests.
 */
import { describe, it } from 'vitest';
import { expectAuthGuard, expectJsonError, type ApiRouteProbe } from './helpers';

const remindersRoutes: ApiRouteProbe[] = [
  { method: 'GET', path: '/api/reminders' },
  {
    method: 'POST',
    path: '/api/reminders/complete-inspection-action',
    body: {
      assetType: 'van',
      assetId: 'fake-asset-id',
      assignedTo: '00000000-0000-0000-0000-000000000000',
    },
  },
];

describe('Reminders API — Auth Guards', () => {
  for (const route of remindersRoutes) {
    it(`${route.method} ${route.path} requires authentication`, async () => {
      await expectAuthGuard(route);
    });
  }
});

describe('Reminders API — JSON error shape', () => {
  for (const route of remindersRoutes) {
    it(`${route.method} ${route.path} responds with JSON on denied access`, async () => {
      await expectJsonError(route);
    });
  }
});
