/**
 * Admin settings, vehicles, and FAQ API smoke/auth coverage.
 *
 * NON-DESTRUCTIVE: uses unauthenticated requests and fake IDs.
 */
import { describe, it } from 'vitest';
import { expectAuthGuard, type ApiRouteProbe } from './helpers';

const adminRoutes: ApiRouteProbe[] = [
  { method: 'GET', path: '/api/admin/settings/timesheet-exceptions' },
  { method: 'GET', path: '/api/admin/vehicles' },
  { method: 'POST', path: '/api/admin/vehicles', body: {} },
  { method: 'GET', path: '/api/admin/faq/articles' },
  { method: 'POST', path: '/api/admin/faq/articles', body: {} },
  { method: 'GET', path: '/api/admin/faq/categories' },
  { method: 'POST', path: '/api/admin/faq/categories', body: {} },
];

describe('Admin Settings and FAQ API — Auth Guards', () => {
  for (const route of adminRoutes) {
    it(`${route.method} ${route.path} requires admin access`, async () => {
      await expectAuthGuard(route);
    });
  }
});
