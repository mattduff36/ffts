import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260902130000_schedule_jobs_board_sequence.sql'
  ),
  'utf8'
);
const runner = readFileSync(
  resolve(
    process.cwd(),
    'scripts/migrations/run-schedule-jobs-board-sequence-migration.ts'
  ),
  'utf8'
);
const assignmentMigration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260901210000_schedule_assignment_mutation_requests.sql'
  ),
  'utf8'
);

describe('schedule jobs board_sequence migration', () => {
  it('JOB-ORDER-MIG-001: adds an isolated durable board order column', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS board_sequence BIGINT');
    expect(migration).toContain(
      'ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC)'
    );
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS schedule_jobs_board_sequence_uidx');
    expect(migration).toContain('SEQUENCE NAME public.schedule_jobs_board_sequence_seq');
    expect(migration).toContain('GENERATED ALWAYS AS IDENTITY');
    expect(migration).not.toContain('schedule_assignment_mutation_requests');
    expect(assignmentMigration).not.toContain('board_sequence');
    expect(runner).toContain('20260902130000_schedule_jobs_board_sequence.sql');
    expect(runner).toContain('POSTGRES_URL_NON_POOLING');
    expect(runner).not.toContain('process.env.POSTGRES_URL)');
    expect(runner).not.toContain('20260901210000_schedule_assignment_mutation_requests.sql');
  });

  it('JOB-ORDER-MIG-002: is locked, empty-table safe, and rerun-safe', () => {
    expect(migration).toContain('DISABLE TRIGGER set_updated_at_schedule_jobs');
    expect(migration).toContain('ENABLE TRIGGER set_updated_at_schedule_jobs');
    expect(migration).toContain('LOCK TABLE public.schedule_jobs IN EXCLUSIVE MODE');
    expect(migration).toContain('IF v_nulls > 0 AND v_populated > 0 THEN');
    expect(migration).toContain('partially populated; refusing to continue');
    expect(migration).toContain('IF v_nulls > 0 THEN');
    expect(migration).toContain('COALESCE((SELECT MAX(board_sequence) FROM public.schedule_jobs), 1)');
    expect(migration).toContain("AND attidentity = 'a'");
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS board_sequence BIGINT');
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS');
    expect(runner).toContain("attidentity !== 'a'");
    expect(runner).toContain('null_count');
    expect(runner).toContain('duplicate_count');
    expect(runner).toContain('lastValue < maxSequence');
  });

  it('JOB-ORDER-MIG-003: inserts cannot choose and updates cannot change board_sequence', () => {
    expect(migration).toContain('GENERATED ALWAYS AS IDENTITY');
    expect(migration).toContain('BOARD_SEQUENCE_IMMUTABLE');
    expect(migration).toContain('FUNCTION public.protect_schedule_job_board_sequence');
    expect(migration).toContain(
      'CREATE TRIGGER protect_schedule_job_board_sequence'
    );
    expect(migration).toContain('BEFORE UPDATE ON public.schedule_jobs');
    const databaseTypes = readFileSync(
      resolve(process.cwd(), 'types/database.ts'),
      'utf8'
    );
    expect(databaseTypes).toMatch(/schedule_jobs: \{[\s\S]*board_sequence: number/);
    const insertBlock = databaseTypes.match(
      /schedule_jobs: \{[\s\S]*?Insert: \{([\s\S]*?)\n        \}/
    )?.[1] || '';
    const updateBlock = databaseTypes.match(
      /schedule_jobs: \{[\s\S]*?Update: \{([\s\S]*?)\n        \}/
    )?.[1] || '';
    expect(insertBlock).not.toContain('board_sequence');
    expect(updateBlock).not.toContain('board_sequence');
  });
});
