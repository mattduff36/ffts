/**
 * Quotes and customers API smoke/auth coverage.
 *
 * NON-DESTRUCTIVE: uses unauthenticated requests and fake IDs.
 */
import { describe, it } from 'vitest';
import { expectAuthGuard, type ApiRouteProbe } from './helpers';

const quoteAndCustomerRoutes: ApiRouteProbe[] = [
  { method: 'GET', path: '/api/quotes' },
  { method: 'POST', path: '/api/quotes', body: {} },
  { method: 'GET', path: '/api/quotes/fake-id' },
  { method: 'GET', path: '/api/quotes/fake-id/pdf' },
  { method: 'GET', path: '/api/quotes/metadata' },
  { method: 'GET', path: '/api/customers' },
  { method: 'POST', path: '/api/customers', body: {} },
  { method: 'GET', path: '/api/customers/fake-id' },
];

describe('Quotes and Customers API — Auth Guards', () => {
  for (const route of quoteAndCustomerRoutes) {
    it(`${route.method} ${route.path} requires authenticated business access`, async () => {
      await expectAuthGuard(route);
    });
  }
});
