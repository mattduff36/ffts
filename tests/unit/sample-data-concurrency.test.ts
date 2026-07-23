import { describe, expect, it, vi } from 'vitest';
import { acquireFixtureTransactionLock } from '@/lib/server/sample-data/database';

describe('sample-data advisory locks', () => {
  it('acquires a transaction-scoped fixture lock', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ locked: true }] });
    await acquireFixtureTransactionLock(
      { query } as never,
      'scheduling-sample-v1'
    );

    expect(query).toHaveBeenCalledWith(
      'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked',
      ['ffts:sample-data:scheduling-sample-v1']
    );
  });

  it('rejects concurrent work when the fixture lock is busy', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ locked: false }] });
    await expect(
      acquireFixtureTransactionLock(
        { query } as never,
        'fleet-inventory-sample-v1'
      )
    ).rejects.toThrow('already running');
  });
});
