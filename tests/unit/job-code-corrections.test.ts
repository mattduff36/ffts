import { describe, expect, it } from 'vitest';
import {
  buildJobCodeCorrectionPreviewFromRows,
  buildStoredJobCodeOptionsFromValues,
  getChildJobCodeMutationPlan,
  getLegacyQuoteMutationPlan,
  normalizeJobCodeCorrectionInput,
  type CorrectionRows,
  type JobCodeCorrectionTimesheetSummary,
  type LegacyQuoteRow,
  type TimesheetEntryJobCodeRow,
  type TimesheetEntryRow,
} from '@/lib/server/job-code-corrections';

function childRow(
  id: string,
  timesheetEntryId: string,
  jobNumber: string
): TimesheetEntryJobCodeRow {
  return {
    id,
    timesheet_entry_id: timesheetEntryId,
    job_number: jobNumber,
    display_order: 0,
  };
}

function scalarRow(id: string, timesheetId: string, jobNumber: string): TimesheetEntryRow {
  return {
    id,
    timesheet_id: timesheetId,
    day_of_week: 1,
    job_number: jobNumber,
  };
}

function legacyRow(id: string, quoteReference: string): LegacyQuoteRow {
  return {
    id,
    quote_reference: quoteReference,
  };
}

function timesheetSummary(id: string): JobCodeCorrectionTimesheetSummary {
  return {
    id,
    userId: `user-${id}`,
    employeeName: 'Test Employee',
    employeeId: 'EMP001',
    email: null,
    weekEnding: '2026-06-21',
    status: 'submitted',
    jobCodes: ['5388-LC'],
    matchingJobCodeCount: 1,
  };
}

function correctionRows(overrides: Partial<CorrectionRows> = {}): CorrectionRows {
  return {
    childRows: [],
    duplicateTargetRows: [],
    scalarRows: [],
    legacyRows: [],
    targetLegacyRows: [],
    affectedTimesheets: [],
    ...overrides,
  };
}

describe('job code corrections helper', () => {
  it('normalizes standard and supplemental job code input', () => {
    expect(normalizeJobCodeCorrectionInput({
      scope: 'batch',
      fromJobCode: ' 5388 lc ',
      toJobCode: ' workshop ',
    })).toEqual({
      scope: 'batch',
      fromJobCode: '5388-LC',
      toJobCode: 'WORKSHOP',
      timesheetIds: [],
      deleteOldLegacyQuote: false,
    });
  });

  it('rejects individual corrections without selected weekly timesheets', () => {
    expect(() => normalizeJobCodeCorrectionInput({
      scope: 'individual',
      fromJobCode: '5388-LC',
      toJobCode: '60001-MD',
      timesheetIds: [],
    })).toThrow('Select at least one weekly timesheet.');
  });

  it('updates child rows unless the replacement already exists on the same entry', () => {
    const rows = [
      childRow('old-1', 'entry-1', '5388-LC'),
      childRow('old-2', 'entry-2', '5388-LC'),
    ];
    const duplicateTargets = [
      childRow('target-1', 'entry-2', '60001-MD'),
    ];

    const plan = getChildJobCodeMutationPlan(rows, duplicateTargets);

    expect(plan.rowsToUpdate.map((row) => row.id)).toEqual(['old-1']);
    expect(plan.rowsToDelete.map((row) => row.id)).toEqual(['old-2']);
  });

  it('renames legacy quote rows when the replacement does not already exist', () => {
    const plan = getLegacyQuoteMutationPlan({
      legacyRows: [legacyRow('legacy-old', '5388-LC')],
      targetLegacyRows: [],
      deleteOldLegacyQuote: true,
    });

    expect(plan.rowsToUpdate.map((row) => row.id)).toEqual(['legacy-old']);
    expect(plan.rowsToDelete).toEqual([]);
  });

  it('deletes old legacy quote rows when requested and the replacement already exists', () => {
    const plan = getLegacyQuoteMutationPlan({
      legacyRows: [legacyRow('legacy-old', '5388-LC')],
      targetLegacyRows: [legacyRow('legacy-new', '60001-MD')],
      deleteOldLegacyQuote: true,
    });

    expect(plan.rowsToUpdate).toEqual([]);
    expect(plan.rowsToDelete.map((row) => row.id)).toEqual(['legacy-old']);
  });

  it('builds preview counts for batch corrections', () => {
    const preview = buildJobCodeCorrectionPreviewFromRows({
      scope: 'batch',
      fromJobCode: '5388 LC',
      toJobCode: '60001 md',
      deleteOldLegacyQuote: true,
    }, correctionRows({
      childRows: [
        childRow('old-1', 'entry-1', '5388-LC'),
        childRow('old-2', 'entry-2', '5388-LC'),
      ],
      duplicateTargetRows: [
        childRow('target-1', 'entry-2', '60001-MD'),
      ],
      scalarRows: [
        scalarRow('scalar-1', 'timesheet-1', '5388-LC'),
      ],
      legacyRows: [
        legacyRow('legacy-old', '5388-LC'),
      ],
      targetLegacyRows: [
        legacyRow('legacy-new', '60001-MD'),
      ],
      affectedTimesheets: [
        timesheetSummary('timesheet-1'),
      ],
    }));

    expect(preview.fromJobCode).toBe('5388-LC');
    expect(preview.toJobCode).toBe('60001-MD');
    expect(preview.counts).toEqual({
      timesheetChildRows: 2,
      timesheetScalarRows: 1,
      childRowsToUpdate: 1,
      childRowsToDeleteAsDuplicate: 1,
      legacyQuoteRows: 1,
      targetLegacyQuoteRows: 1,
      legacyQuoteRowsToUpdate: 0,
      legacyQuoteRowsToDelete: 1,
      affectedTimesheets: 1,
    });
    expect(preview.warnings).toEqual([
      '1 duplicate timesheet job-code row(s) will be deleted because the replacement code already exists on the same day.',
      '1 old legacy quote row(s) for 5388-LC will be deleted because 60001-MD already exists.',
    ]);
  });

  it('builds stored source-code options from timesheet and legacy values', () => {
    expect(buildStoredJobCodeOptionsFromValues({
      timesheetCodes: ['5388 lc', '5388-LC', 'BADCODE'],
      legacyQuoteCodes: ['5388-LC', '60001-MD'],
    })).toEqual([
      {
        value: '5388-LC',
        label: '5388-LC',
        customerName: 'Stored in timesheets and legacy quotes',
        quoteTitle: '2 timesheet row(s), 1 legacy quote row(s)',
        source: 'timesheet',
      },
      {
        value: '60001-MD',
        label: '60001-MD',
        customerName: 'Stored in legacy quotes',
        quoteTitle: '1 legacy quote row(s)',
        source: 'legacy_quote',
      },
      {
        value: 'BADCODE',
        label: 'BADCODE',
        customerName: 'Stored in timesheets',
        quoteTitle: '1 timesheet row(s)',
        source: 'timesheet',
      },
    ]);
  });
});
