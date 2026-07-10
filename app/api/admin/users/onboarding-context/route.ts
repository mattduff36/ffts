import { NextResponse } from 'next/server';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { requireAdminUsersModuleAccess } from '@/lib/server/admin-users-module-access';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  buildFinancialYearBounds,
  getFinancialYearBankHolidays,
  getFinancialYearStartYear,
  listBulkAbsenceBatches,
} from '@/lib/services/absence-bank-holiday-sync';
import { listWorkShiftTemplates } from '@/lib/server/work-shifts';

function formatIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function GET() {
  try {
    const effectiveRole = await getEffectiveRole();
    if (!effectiveRole.user_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sensitiveAccessResponse = await requireAdminUsersModuleAccess();
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const financialYearStartYear = getFinancialYearStartYear(new Date());
    const financialYear = buildFinancialYearBounds(financialYearStartYear);
    const todayIso = formatIsoDate(new Date());
    const supabaseAdmin = createAdminClient();

    const [bankHolidays, workShiftTemplates, bulkAbsenceBatches] = await Promise.all([
      getFinancialYearBankHolidays(financialYearStartYear),
      listWorkShiftTemplates(supabaseAdmin),
      listBulkAbsenceBatches(supabaseAdmin, { financialYearStartYear, limit: 500 }),
    ]);

    const passedBankHolidayCount = bankHolidays.filter((holiday) => holiday.date < todayIso).length;
    const remainingBankHolidayCount = bankHolidays.filter((holiday) => holiday.date >= todayIso).length;

    return NextResponse.json({
      success: true,
      financialYear: {
        startYear: financialYearStartYear,
        label: financialYear.label,
        startDate: formatIsoDate(financialYear.start),
        endDate: formatIsoDate(financialYear.end),
      },
      bankHolidays: {
        totalCount: bankHolidays.length,
        passedCount: passedBankHolidayCount,
        remainingCount: remainingBankHolidayCount,
        today: todayIso,
      },
      workShiftTemplates,
      bulkAbsenceBatches,
    });
  } catch (error) {
    console.error('Error loading new-user onboarding context:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load onboarding context' },
      { status: 500 }
    );
  }
}
