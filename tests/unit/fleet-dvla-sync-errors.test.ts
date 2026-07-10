import { describe, expect, it } from 'vitest';
import { isExpectedFleetDvlaLookupFailure } from '@/lib/services/fleet-dvla-sync';

describe('isExpectedFleetDvlaLookupFailure', () => {
  it('treats DVLA 404 lookup failures as expected external failures', () => {
    expect(
      isExpectedFleetDvlaLookupFailure('DVLA API Error: API request failed: 404 - Not Found')
    ).toBe(true);
  });

  it('does not suppress unrelated DVLA API failures', () => {
    expect(
      isExpectedFleetDvlaLookupFailure('DVLA API Error: API request failed: 500 - Internal Server Error')
    ).toBe(false);
  });

  it('does not suppress non-DVLA errors', () => {
    expect(isExpectedFleetDvlaLookupFailure('Database insert failed: duplicate key')).toBe(false);
  });
});
