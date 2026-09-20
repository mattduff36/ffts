import { describe, expect, it } from 'vitest';
import {
  areCataloguedJobNumbers,
  collectUniqueJobNumbers,
  formatEntryJobNumbers,
  formatQuoteProjectReference,
  getEntryJobNumbers,
  hasDuplicateJobNumbers,
  isValidJobNumber,
  normalizeCatalogJobCode,
  normalizeJobNumberInput,
} from '@/lib/utils/timesheet-job-codes';

describe('timesheet job code helpers', () => {
  it('normalizes manual input into the expected job format', () => {
    expect(normalizeJobNumberInput('1234ab')).toBe('1234-AB');
    expect(normalizeJobNumberInput('12 34-ab-99')).toBe('1234-AB');
    expect(normalizeJobNumberInput('40001gh')).toBe('40001-GH');
    expect(normalizeJobNumberInput('40001-GH')).toBe('40001-GH');
    expect(normalizeCatalogJobCode('p500')).toBe('P500');
    expect(normalizeCatalogJobCode('workshop')).toBe('WORKSHOP');
    expect(normalizeCatalogJobCode('H-123')).toBe('H123');
  });

  it('validates legacy and quote-backed job code formats', () => {
    expect(isValidJobNumber('1234-AB')).toBe(true);
    expect(isValidJobNumber('40001-GH')).toBe(true);
    expect(isValidJobNumber('40001')).toBe(false);
    expect(isValidJobNumber('123456-GH')).toBe(false);
  });

  it('requires job numbers to be present in the loaded catalog', () => {
    const cataloguedJobNumbers = new Set(['1234-AB', '40001-GH', 'P500', 'WORKSHOP']);

    expect(areCataloguedJobNumbers(['1234ab'], cataloguedJobNumbers)).toBe(true);
    expect(areCataloguedJobNumbers(['40001-GH'], cataloguedJobNumbers)).toBe(true);
    expect(areCataloguedJobNumbers(['p500'], cataloguedJobNumbers)).toBe(true);
    expect(areCataloguedJobNumbers(['workshop'], cataloguedJobNumbers)).toBe(true);
    expect(areCataloguedJobNumbers(['9999-ZZ'], cataloguedJobNumbers)).toBe(false);
    expect(areCataloguedJobNumbers(['1234-AB', '1234ab'], cataloguedJobNumbers)).toBe(false);
    expect(areCataloguedJobNumbers(['P500', 'p500'], cataloguedJobNumbers)).toBe(false);
  });

  it('prefers ordered child job-code rows over the legacy scalar field', () => {
    expect(
      getEntryJobNumbers({
        job_number: '9999-ZZ',
        timesheet_entry_job_codes: [
          { job_number: '5678-CD', display_order: 1 },
          { job_number: '1234-AB', display_order: 0 },
        ],
      })
    ).toEqual(['1234-AB', '5678-CD']);
  });

  it('collects unique job codes across entries while skipping yard and did-not-work rows', () => {
    expect(
      collectUniqueJobNumbers(
        [
          {
            day_of_week: 1,
            did_not_work: false,
            working_in_yard: false,
            job_numbers: ['1234-AB', 'P500'],
          },
          {
            day_of_week: 2,
            did_not_work: false,
            working_in_yard: true,
            job_numbers: ['9999-ZZ'],
          },
          {
            day_of_week: 3,
            did_not_work: true,
            working_in_yard: false,
            job_numbers: ['7777-AA'],
          },
          {
            day_of_week: 4,
            did_not_work: false,
            working_in_yard: false,
            timesheet_entry_job_codes: [
              { job_number: 'P500', display_order: 0 },
              { job_number: '2468-EF', display_order: 1 },
            ],
          },
        ],
        { excludeDidNotWork: true, excludeWorkingInYard: true }
      )
    ).toEqual(['1234-AB', 'P500', '2468-EF']);
  });

  it('formats multiple job codes for display and detects duplicates', () => {
    expect(formatEntryJobNumbers({ job_numbers: ['1234-AB', '5678-CD'] })).toBe('1234-AB, 5678-CD');
    expect(hasDuplicateJobNumbers(['1234-AB', '1234ab'])).toBe(true);
  });

  it('formats owner-range quote and project references', () => {
    expect(formatQuoteProjectReference(10027, 'jc')).toBe('10027-JC');
    expect(formatQuoteProjectReference(80001, 'MD')).toBe('80001-MD');
    expect(formatQuoteProjectReference(90011, 'sd')).toBe('90011-SD');
    expect(formatQuoteProjectReference(10000, 'AA')).toBe('10000-AA');
    expect(formatQuoteProjectReference(99999, 'ZZ')).toBe('99999-ZZ');
    expect(() => formatQuoteProjectReference(27, 'JC')).toThrow(/10000 and 99999/);
    expect(() => formatQuoteProjectReference(9999, 'JC')).toThrow(/10000 and 99999/);
    expect(() => formatQuoteProjectReference(100000, 'JC')).toThrow(/10000 and 99999/);
    expect(() => formatQuoteProjectReference(10001, 'J')).toThrow(/two letters/);
    expect(() => formatQuoteProjectReference(10001, 'JCX')).toThrow(/two letters/);
  });
});
