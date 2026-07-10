import { describe, expect, it } from 'vitest';
import { isVisibleWithDefaultErrorLogFilters } from '@/lib/utils/error-log-filters';

describe('default error log filters', () => {
  it('hides localhost and hidden admin error logs by default', () => {
    expect(
      isVisibleWithDefaultErrorLogFilters({
        page_url: 'http://localhost:4000/dashboard',
        user_email: 'engineer@example.com',
      })
    ).toBe(false);

    expect(
      isVisibleWithDefaultErrorLogFilters({
        page_url: 'https://forest-farm.example.test/dashboard',
        user_email: 'admin@mpdee.co.uk',
      })
    ).toBe(false);

    expect(
      isVisibleWithDefaultErrorLogFilters({
        page_url: 'https://forest-farm.example.test/dashboard',
        user_email: null,
      })
    ).toBe(true);
  });
});
