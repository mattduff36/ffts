import { describe, expect, it } from 'vitest';
import { filterReleaseHistoryEntryForAccess, type ReleaseHistoryAccessSnapshot } from '@/lib/server/version-history-filter';
import type { ReleaseHistoryEntry } from '@/lib/config/release-version-logic';
import type { ModuleName } from '@/types/roles';

function accessWithModules(modules: ModuleName[]): ReleaseHistoryAccessSnapshot {
  return {
    authenticated: true,
    fullAccess: false,
    accessibleModules: new Set(modules),
    sensitivePinModules: new Set(['debug', 'customers', 'quotes']),
    canAccessDebug: false,
  };
}

describe('version history filtering', () => {
  it('keeps a release visible while masking restricted debug details', () => {
    const entry: ReleaseHistoryEntry = {
      version: '0626.25.0',
      updateKind: 'major',
      title: 'Debug tools update',
      description: 'Updated Debug tools and Inventory.',
      summary: 'Updated Debug tools and Inventory.',
      details: [
        'Covered debug tools and inventory.',
        'Added job-code correction tools.',
        'Improved inventory screens.',
      ],
      areas: ['Debug tools', 'Inventory'],
      areaKeys: ['debug', 'inventory'],
      pushedAt: '2026-06-19T10:20:18.087Z',
    };

    expect(filterReleaseHistoryEntryForAccess(entry, accessWithModules(['inventory']))).toEqual({
      ...entry,
      title: 'Inventory update',
      description: 'Updated inventory. Some restricted update details are hidden.',
      summary: 'Updated inventory. Some restricted update details are hidden.',
      details: [
        'Improved inventory screens.',
        'Some details are hidden because your current access does not include every module touched by this release.',
      ],
      areas: ['Inventory', 'Restricted update'],
      areaKeys: ['inventory'],
    });
  });

  it('uses a generic app update when every touched module is restricted', () => {
    const entry: ReleaseHistoryEntry = {
      version: '0626.25.0',
      updateKind: 'major',
      title: 'Debug tools update',
      description: 'Updated Debug tools.',
      summary: 'Updated Debug tools.',
      details: ['Added job-code correction tools.'],
      areas: ['Debug tools'],
      areaKeys: ['debug'],
      pushedAt: null,
    };

    expect(filterReleaseHistoryEntryForAccess(entry, accessWithModules([]))).toMatchObject({
      title: 'App update',
      description: 'This release includes updates to parts of the app that are not available to your current permissions.',
      areas: ['Restricted update'],
      areaKeys: [],
    });
  });
});
