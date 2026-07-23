import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260723213000_debug_sample_data_operations.sql'
  ),
  'utf8'
);

describe('Debug Sample Data operation audit migration', () => {
  it('allowlists only managed fixtures and all-managed coordination', () => {
    expect(sql).toContain("'scheduling-sample-v1'");
    expect(sql).toContain("'fleet-inventory-sample-v1'");
    expect(sql).toContain("'all-managed'");
  });

  it('makes operation records immutable and inaccessible to authenticated users', () => {
    expect(sql).toContain('prevent_sample_data_operation_mutation');
    expect(sql).toContain('BEFORE UPDATE OR DELETE');
    expect(sql).toContain('TO authenticated');
    expect(sql).toContain('USING (FALSE)');
    expect(sql).toContain('GRANT SELECT, INSERT');
  });
});
