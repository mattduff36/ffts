import { expect } from 'vitest';

export const BASE_URL = process.env.TESTSUITE_BASE_URL || 'http://localhost:4000';

export interface ApiRouteProbe {
  method: string;
  path: string;
  body?: unknown;
  expectedAuthStatuses?: number[];
}

export async function requestApi(route: ApiRouteProbe): Promise<Response> {
  const init: RequestInit = { method: route.method };

  if (route.body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(route.body);
  }

  return fetch(`${BASE_URL}${route.path}`, init);
}

export async function expectAuthGuard(route: ApiRouteProbe): Promise<Response> {
  const response = await requestApi(route);
  expect(response.status).not.toBe(500);
  expect(route.expectedAuthStatuses || [401, 403]).toContain(response.status);
  return response;
}

export async function expectJsonError(route: ApiRouteProbe): Promise<void> {
  const response = await expectAuthGuard(route);
  expect(response.headers.get('content-type')).toContain('application/json');

  const body = await response.json();
  expect(body).toHaveProperty('error');
}
