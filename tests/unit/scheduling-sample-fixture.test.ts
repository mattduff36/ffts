import { describe, expect, it } from 'vitest';
import {
  buildFixtureDefinitions,
  buildQueueFixtureDefinitions,
  createManifest,
  createQueueManifest,
} from '@/scripts/testing/scheduling-sample';

describe('scheduling SAMPLE fixture', () => {
  it('plans the current Monday-Sunday week plus three following weeks', () => {
    const fixture = buildFixtureDefinitions(new Date('2026-07-22T12:00:00Z'));
    expect(fixture.windowStart).toBe('2026-07-20');
    expect(fixture.windowEnd).toBe('2026-08-16');
  });

  it('creates only fictional unassigned Quote-driven work', () => {
    const fixture = buildFixtureDefinitions(new Date('2026-07-22T12:00:00Z'));
    expect(fixture.customers).toHaveLength(5);
    expect(fixture.quotes).toHaveLength(22);
    expect(fixture.quotes.every((quote) => quote.reference.endsWith('-SD'))).toBe(true);
    expect(fixture.quotes.every((quote) => ['po_received', 'in_progress'].includes(quote.status))).toBe(true);
    expect(fixture.quotes.flatMap((quote) => quote.visits)).toHaveLength(36);
    expect(fixture.quotes.some((quote) => quote.visits.length === 5)).toBe(true);
    expect(fixture.quotes.some((quote) => quote.visits.length === 3)).toBe(true);
  });

  it('reports a reversible manifest without assignments', () => {
    const manifest = createManifest('approved-project');
    expect(manifest.project_ref).toBe('approved-project');
    expect(manifest.counts).toEqual({
      customers: 5,
      quotes: 22,
      visits: 36,
      assignments: 0,
    });
    expect(manifest.series).toEqual({
      initials: 'SD',
      number_start: 99000,
      next_number: 99022,
    });
  });

  it('plans a queue extension with three unscheduled Quotes per workflow group', () => {
    const fixture = buildQueueFixtureDefinitions(new Date('2026-07-22T12:00:00Z'));
    expect(fixture.windowStart).toBe('2026-07-20');
    expect(fixture.windowEnd).toBe('2026-07-26');
    expect(fixture.quotes).toHaveLength(12);
    expect(fixture.quotes.filter((quote) => !quote.startDate)).toHaveLength(9);
    expect(fixture.quotes.filter((quote) => quote.startDate)).toHaveLength(3);
    expect(fixture.quotes.flatMap((quote) => quote.visits)).toHaveLength(3);
    expect(fixture.quotes.map((quote) => quote.reference)).toEqual(
      Array.from({ length: 12 }, (_, index) => `${99022 + index}-SD`)
    );
  });

  it('reports the queue Quote, job, visit, and status-group counts', () => {
    const manifest = createQueueManifest('approved-project');
    expect(manifest.counts).toEqual({
      customers: 0,
      quotes: 12,
      jobs: 3,
      visits: 3,
      assignments: 0,
    });
    expect(manifest.unscheduled_status_counts).toEqual({
      draft: 3,
      pending: 3,
      accepted: 3,
    });
    expect(manifest.series).toEqual({
      initials: 'SD',
      number_start: 99022,
      next_number: 99034,
    });
  });
});
