import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/debug/legacy-job-codes/route';

const {
  mockRequireDebugConsoleAccess,
  mockAddManualLegacyJobCode,
  mockLogServerError,
} = vi.hoisted(() => ({
  mockRequireDebugConsoleAccess: vi.fn(),
  mockAddManualLegacyJobCode: vi.fn(),
  mockLogServerError: vi.fn(),
}));

vi.mock('@/lib/server/debug-console-access', () => ({
  requireDebugConsoleAccess: mockRequireDebugConsoleAccess,
  createDebugAccessErrorBody: vi.fn((access: { error: string | null; code?: string }) => ({
    error: access.error,
    code: access.code,
  })),
}));

vi.mock('@/lib/server/manual-legacy-job-codes', () => ({
  addManualLegacyJobCode: mockAddManualLegacyJobCode,
}));

vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: mockLogServerError,
}));

describe('POST /api/debug/legacy-job-codes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireDebugConsoleAccess.mockResolvedValue({
      ok: true,
      status: 200,
      error: null,
      profileId: 'admin-1',
    });
  });

  it('requires debug console access', async () => {
    mockRequireDebugConsoleAccess.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'Forbidden',
    });

    const response = await POST(new NextRequest('http://localhost/api/debug/legacy-job-codes', {
      method: 'POST',
      body: JSON.stringify({ job_code: '0003-NF', name: 'Legacy job', customer: 'Customer' }),
    }));

    expect(response.status).toBe(403);
    expect(mockAddManualLegacyJobCode).not.toHaveBeenCalled();
  });

  it('adds a manual legacy job code through the server helper', async () => {
    mockAddManualLegacyJobCode.mockResolvedValue({
      id: 'legacy-1',
      quote_reference: '0003-NF',
      customer_name: 'Internal Use Only',
      title: 'Legacy job',
      source_row: 3000001,
      wasExisting: false,
    });

    const response = await POST(new NextRequest('http://localhost/api/debug/legacy-job-codes', {
      method: 'POST',
      body: JSON.stringify({
        job_code: '0003-NF',
        name: 'Legacy job',
        customer: 'Internal Use Only',
      }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(mockAddManualLegacyJobCode).toHaveBeenCalledWith({
      jobCode: '0003-NF',
      name: 'Legacy job',
      customer: 'Internal Use Only',
      createdBy: 'admin-1',
    });
    expect(payload.legacy_job_code.quote_reference).toBe('0003-NF');
  });
});
