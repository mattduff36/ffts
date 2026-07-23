import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireDebugConsoleAccess: vi.fn(),
  getManagedSampleDataStatus: vi.fn(),
  previewSampleDataOperation: vi.fn(),
  executeSampleDataOperation: vi.fn(),
}));

vi.mock('@/lib/server/debug-console-access', () => ({
  requireDebugConsoleAccess: mocks.requireDebugConsoleAccess,
  createDebugAccessErrorBody: (access: { error: string | null; code?: string }) => ({
    error: access.error,
    code: access.code,
  }),
}));
vi.mock('@/lib/server/sample-data/registry', () => ({
  getManagedSampleDataStatus: mocks.getManagedSampleDataStatus,
  previewSampleDataOperation: mocks.previewSampleDataOperation,
  executeSampleDataOperation: mocks.executeSampleDataOperation,
}));
vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: vi.fn(),
}));

import { GET } from '@/app/api/debug/sample-data/route';
import { POST as PREVIEW } from '@/app/api/debug/sample-data/preview/route';
import { POST as EXECUTE } from '@/app/api/debug/sample-data/execute/route';

const registry = {
  generatedAt: '2026-07-23T19:00:00.000Z',
  fixtures: [],
  clearAll: {
    canRemove: true,
    blockers: [],
    fixtureKeys: [
      'scheduling-sample-v1',
      'fleet-inventory-sample-v1',
    ],
  },
};

function request(
  path: string,
  body?: Record<string, unknown>,
  origin = 'http://localhost'
) {
  return new NextRequest(`http://localhost${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body
      ? { 'Content-Type': 'application/json', Origin: origin }
      : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('Debug Sample Data API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireDebugConsoleAccess.mockResolvedValue({
      ok: true,
      status: 200,
      error: null,
      profileId: 'super-admin-profile',
    });
    mocks.getManagedSampleDataStatus.mockResolvedValue(registry);
  });

  it('requires the Debug PIN boundary for status', async () => {
    mocks.requireDebugConsoleAccess.mockResolvedValue({
      ok: false,
      status: 428,
      error: 'Sensitive access PIN required.',
      code: 'SENSITIVE_PIN_REQUIRED',
    });

    const response = await GET(request('/api/debug/sample-data'));
    expect(response.status).toBe(428);
    expect(mocks.getManagedSampleDataStatus).not.toHaveBeenCalled();
  });

  it('returns the managed registry to an unlocked actual Super Admin', async () => {
    const response = await GET(request('/api/debug/sample-data'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, status: registry });
  });

  it('rejects cross-origin previews before touching the fixture service', async () => {
    const response = await PREVIEW(
      request(
        '/api/debug/sample-data/preview',
        {
          fixtureKey: 'scheduling-sample-v1',
          action: 'create-base',
        },
        'https://attacker.example'
      )
    );
    expect(response.status).toBe(403);
    expect(mocks.previewSampleDataOperation).not.toHaveBeenCalled();
  });

  it('rejects non-allowlisted fixture actions', async () => {
    const response = await PREVIEW(
      request('/api/debug/sample-data/preview', {
        fixtureKey: 'unmanaged-zz99',
        action: 'remove',
      })
    );
    expect(response.status).toBe(400);
    expect(mocks.previewSampleDataOperation).not.toHaveBeenCalled();
  });

  it('passes exact create-complete requests to the preview service', async () => {
    mocks.previewSampleDataOperation.mockResolvedValue({
      fixtureKey: 'scheduling-sample-v1',
      action: 'create-complete',
      canExecute: true,
    });
    const response = await PREVIEW(
      request('/api/debug/sample-data/preview', {
        fixtureKey: 'scheduling-sample-v1',
        action: 'create-complete',
      })
    );
    expect(response.status).toBe(200);
    expect(mocks.previewSampleDataOperation).toHaveBeenCalledWith({
      fixtureKey: 'scheduling-sample-v1',
      action: 'create-complete',
    });
  });

  it('attributes mutations to the authenticated Debug actor', async () => {
    mocks.executeSampleDataOperation.mockResolvedValue({
      success: true,
      outcome: 'succeeded',
      fixtureKey: 'fleet-inventory-sample-v1',
      action: 'create',
      message: 'Created',
      completedFixtures: ['fleet-inventory-sample-v1'],
      failedFixture: null,
      recovery: null,
      status: registry,
    });
    const response = await EXECUTE(
      request('/api/debug/sample-data/execute', {
        fixtureKey: 'fleet-inventory-sample-v1',
        action: 'create',
        confirmation: 'CREATE FLEET INVENTORY SAMPLE',
        fingerprint: 'signed-preview-fingerprint-value',
      })
    );
    expect(response.status).toBe(200);
    expect(mocks.executeSampleDataOperation).toHaveBeenCalledWith(
      expect.objectContaining({ actorProfileId: 'super-admin-profile' })
    );
  });

  it('returns a partial clear-all result without pretending rollback', async () => {
    mocks.executeSampleDataOperation.mockResolvedValue({
      success: false,
      outcome: 'partial',
      fixtureKey: 'all-managed',
      action: 'clear-all',
      message: 'Fleet cleanup failed',
      completedFixtures: ['scheduling-sample-v1'],
      failedFixture: 'fleet-inventory-sample-v1',
      recovery: 'Scheduling is already committed.',
      status: registry,
    });
    const response = await EXECUTE(
      request('/api/debug/sample-data/execute', {
        fixtureKey: 'all-managed',
        action: 'clear-all',
        confirmation: 'CLEAR ALL MANAGED SAMPLE DATA',
        fingerprint: 'signed-preview-fingerprint-value',
      })
    );
    expect(response.status).toBe(207);
    expect((await response.json()).result).toEqual(
      expect.objectContaining({
        outcome: 'partial',
        completedFixtures: ['scheduling-sample-v1'],
        failedFixture: 'fleet-inventory-sample-v1',
      })
    );
  });
});
