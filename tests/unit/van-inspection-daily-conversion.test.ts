import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

function readSource(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf-8');
}

describe('van daily inspection conversion artifacts', () => {
  it('uses a single-day van PDF table instead of weekday columns', () => {
    const pdfSource = readSource('lib/pdf/van-inspection-pdf.tsx');

    expect(pdfSource).toContain('COMPANY VAN DAILY CHECK');
    expect(pdfSource).toContain('INSPECTION DATE');
    expect(pdfSource).toContain('PASS');
    expect(pdfSource).toContain('FAIL');
    expect(pdfSource).toContain('COMMENTS');
    expect(pdfSource).not.toContain('WEEK ENDING');
    expect(pdfSource).not.toContain('MON');
    expect(pdfSource).not.toContain('TUE');
    expect(pdfSource).not.toContain('WED');
  });

  it('always uses the daily van PDF for van-inspection PDF endpoints and reports', () => {
    const singlePdfRoute = readSource('app/api/van-inspections/[id]/pdf/route.ts');
    const bulkPdfRoute = readSource('app/api/reports/inspections/bulk-pdf/route.ts');

    expect(singlePdfRoute).toContain('VanInspectionPDF');
    expect(singlePdfRoute).not.toContain("from '@/lib/pdf/inspection-pdf'");
    expect(singlePdfRoute).not.toContain('isVanCategory');

    expect(bulkPdfRoute).toContain('VanInspectionPDF');
    expect(bulkPdfRoute).not.toContain("from '@/lib/pdf/inspection-pdf'");
    expect(bulkPdfRoute).not.toContain('isVanCategory');
  });

  it('keeps duplicate and orphan archival checks in the daily split migration', () => {
    const migrationSource = readSource('supabase/migrations/20260601_van_inspections_daily_split.sql');
    const runnerSource = readSource('scripts/run-van-inspections-daily-migration.ts');

    expect(migrationSource).toContain('van_inspection_daily_duplicate_archive');
    expect(migrationSource).toContain('inspection_orphan_children_archive');
    expect(migrationSource).toContain('inspection_end_date = inspection_date');
    expect(migrationSource).toContain('CREATE UNIQUE INDEX idx_unique_van_inspection_user_date');
    expect(runnerSource).toContain('duplicate_daily_group_count');
    expect(runnerSource).toContain('duplicate_archive_count');
  });

  it('keeps the migration action relink verification for the known Tuesday action', () => {
    const migrationSource = readSource('supabase/migrations/20260601_van_inspections_daily_split.sql');

    expect(migrationSource).toContain('1579a56c-2baa-4168-a59e-3e921a78588c');
    expect(migrationSource).toContain('e26747ef-1ef0-4fef-a6f9-4e6810f9d058');
    expect(migrationSource).toContain('original_day_of_week = 2');
    expect(migrationSource).toContain('a.inspection_item_id IS NULL OR m.new_item_id = a.inspection_item_id');
  });

  it('uses current van inspection item statuses in reports stats', () => {
    const statsRoute = readSource('app/api/reports/stats/route.ts');

    expect(statsRoute).toContain("i.status === 'ok'");
    expect(statsRoute).toContain("i.status === 'attention' || i.status === 'defect'");
    expect(statsRoute).toContain(".in('status', ['attention', 'defect'])");
    expect(statsRoute).not.toContain("i.status === 'pass'");
    expect(statsRoute).not.toContain("i.status === 'fail'");
    expect(statsRoute).not.toContain(".eq('status', 'fail')");
  });
});
