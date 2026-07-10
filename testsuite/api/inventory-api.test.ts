/**
 * Inventory API smoke and auth guard coverage.
 *
 * NON-DESTRUCTIVE: uses fake IDs and unauthenticated requests.
 */
import { describe, it } from 'vitest';
import { expectAuthGuard, type ApiRouteProbe } from './helpers';

const inventoryRoutes: ApiRouteProbe[] = [
  { method: 'GET', path: '/api/inventory' },
  { method: 'GET', path: '/api/inventory?status=retired' },
  { method: 'GET', path: '/api/inventory/context' },
  { method: 'GET', path: '/api/inventory/groups' },
  { method: 'GET', path: '/api/inventory/categories' },
  { method: 'GET', path: '/api/inventory/fake-id/history' },
  { method: 'POST', path: '/api/inventory/move', body: {} },
  { method: 'POST', path: '/api/inventory/fake-id/move', body: {} },
  { method: 'POST', path: '/api/inventory/fake-id/checks', body: {} },
  { method: 'PATCH', path: '/api/inventory/fake-id/check-interval', body: {} },
  { method: 'GET', path: '/api/inventory/fake-id/checks/fake-check-id/pdf' },
];

describe('Inventory API — Auth Guards', () => {
  for (const route of inventoryRoutes) {
    it(`${route.method} ${route.path} requires inventory access`, async () => {
      await expectAuthGuard(route);
    });
  }
});
