import { describe, expect, it } from 'vitest';
import {
  shouldArchiveQuoteSiteLocation,
  shouldQuoteHaveActiveSiteLocation,
} from '@/lib/server/inventory-site-location-sync';

describe('inventory site location sync', () => {
  it('creates active site locations for operational open quotes', () => {
    expect(shouldQuoteHaveActiveSiteLocation({
      status: 'po_received',
      commercial_status: 'open',
    })).toBe(true);
    expect(shouldQuoteHaveActiveSiteLocation({
      status: 'in_progress',
      commercial_status: 'open',
    })).toBe(true);
  });

  it('archives site locations for closed or lost quotes', () => {
    expect(shouldArchiveQuoteSiteLocation({
      status: 'in_progress',
      commercial_status: 'closed',
    })).toBe(true);
    expect(shouldArchiveQuoteSiteLocation({
      status: 'lost',
      commercial_status: 'open',
    })).toBe(true);
  });

  it('does not create site locations for draft quotes', () => {
    expect(shouldQuoteHaveActiveSiteLocation({
      status: 'draft',
      commercial_status: 'open',
    })).toBe(false);
    expect(shouldArchiveQuoteSiteLocation({
      status: 'draft',
      commercial_status: 'open',
    })).toBe(false);
  });
});
