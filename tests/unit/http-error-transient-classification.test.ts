import { describe, expect, it } from 'vitest';
import { getErrorStatus, isAuthErrorStatus, isNetworkFetchError } from '@/lib/utils/http-error';

describe('http error transient classification', () => {
  it('treats empty JWT errors as auth failures even without an explicit status code', () => {
    const error = new Error('Empty JWT is sent in Authorization header');

    expect(getErrorStatus(error)).toBe(401);
    expect(isAuthErrorStatus(getErrorStatus(error))).toBe(true);
  });

  it('treats load failed errors as transient network failures', () => {
    const error = new TypeError('Load failed');

    expect(isNetworkFetchError(error)).toBe(true);
  });

  it('reads common statusCode fields from error-like objects', () => {
    expect(getErrorStatus({ message: 'Unauthorized', statusCode: 401 })).toBe(401);
  });
});
