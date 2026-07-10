import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getCurrentAuthenticatedProfile: vi.fn(),
  insertErrorLogs: vi.fn(),
  logServerError: vi.fn(),
}));

vi.mock('@/lib/server/app-auth/session', () => ({
  getCurrentAuthenticatedProfile: mocks.getCurrentAuthenticatedProfile,
}));

vi.mock('@/lib/server/error-logs', () => ({
  insertErrorLogs: mocks.insertErrorLogs,
}));

vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: mocks.logServerError,
}));

import { POST } from '@/app/api/errors/log/route';

describe('POST /api/errors/log', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insertErrorLogs.mockResolvedValue(undefined);
  });

  it('continues writing runtime error logs without requiring debug PIN access', async () => {
    mocks.getCurrentAuthenticatedProfile.mockResolvedValue(null);

    const response = await POST(new NextRequest('http://localhost/api/errors/log', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost',
        'User-Agent': 'Vitest Browser',
      },
      body: JSON.stringify({
        logs: [{
          timestamp: '2026-05-29T18:00:00.000Z',
          error_message: 'Client runtime error',
          error_type: 'Error',
          page_url: 'https://example.com/dashboard',
          component_name: 'RuntimeLogger',
          additional_data: { source: 'test' },
        }],
      }),
    }));

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ success: true, inserted: 1 });
    expect(mocks.insertErrorLogs).toHaveBeenCalledWith([
      expect.objectContaining({
        error_message: 'Client runtime error',
        error_type: 'Error',
        user_id: null,
        user_email: null,
        page_url: 'https://example.com/dashboard',
        component_name: 'RuntimeLogger',
      }),
    ]);
  });
});
