import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { runAbsenceFinancialYearArchive } from '@/lib/services/absence-archive';
import { requireAdminAbsenceAccess } from '@/lib/server/absence-work-shift-auth';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminAbsenceAccess();
    if (auth.response) {
      return auth.response;
    }

    const supabase = await createServerClient();
    const profile = await getProfileWithRole(auth.user.id);
    if (!profile) {
      return NextResponse.json(
        { error: 'Forbidden: Profile required' },
        { status: 403 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      financialYearStartYear?: number;
      allEligible?: boolean;
      force?: boolean;
      notes?: string;
    };
    const runAllEligible = body.allEligible === true;
    const hasSpecificYear = typeof body.financialYearStartYear === 'number';

    if (!runAllEligible && !hasSpecificYear) {
      return NextResponse.json(
        {
          error: 'Provide either financialYearStartYear or allEligible: true',
        },
        { status: 400 }
      );
    }

    const result = await runAbsenceFinancialYearArchive(supabase, {
      financialYearStartYear: body.financialYearStartYear,
      allEligible: runAllEligible,
      force: body.force === true,
      notes: body.notes,
      actorId: profile.id,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Error running absence archive:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to run absence archive',
      },
      { status: 500 }
    );
  }
}
