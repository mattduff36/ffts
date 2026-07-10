/**
 * Approvals backing API smoke/auth coverage.
 *
 * The approvals page currently uses Supabase reads for listing and protected
 * API/report routes for related approval workflows.
 */
import { describe, it } from 'vitest';
import { expectAuthGuard, type ApiRouteProbe } from './helpers';

const approvalRoutes: ApiRouteProbe[] = [
  { method: 'POST', path: '/api/timesheets/fake-id/reject', body: { comments: 'testsuite guard' } },
  { method: 'POST', path: '/api/timesheets/fake-id/adjust', body: {} },
  { method: 'GET', path: '/api/timesheets/fake-id/pdf' },
  { method: 'GET', path: '/api/reports/timesheets/summary' },
  { method: 'GET', path: '/api/reports/absence-leave/bookings?dateFrom=2026-01-01&dateTo=2026-01-31' },
];

describe('Approvals API — Auth Guards', () => {
  for (const route of approvalRoutes) {
    it(`${route.method} ${route.path} requires approval access`, async () => {
      await expectAuthGuard(route);
    });
  }
});
