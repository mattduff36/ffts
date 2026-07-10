import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireTrainingAccess } from '@/lib/server/training-auth';
import { logServerError } from '@/lib/utils/server-error-logger';
import type { TrainingRecord, TrainingSummary } from '@/types/training';

function addDaysIso(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  try {
    const access = await requireTrainingAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const admin = createAdminClient();
    const [{ data: records, error: recordsError }, { data: people, error: peopleError }] = await Promise.all([
      admin
        .from('training_records')
        .select('record_status, expiry_date, cpcs_statuses, qualification_validation_status'),
      admin
        .from('training_people')
        .select('profile_id, profile_match_status'),
    ]);

    if (recordsError) throw recordsError;
    if (peopleError) throw peopleError;

    const todayIso = new Date().toISOString().slice(0, 10);
    const soonIso = addDaysIso(90);
    const trainingRecords = (records || []) as Pick<TrainingRecord, 'record_status' | 'expiry_date' | 'cpcs_statuses' | 'qualification_validation_status'>[];
    const activeRecords = trainingRecords.filter((record) => record.record_status === 'active');

    const summary: TrainingSummary = {
      totalRecords: trainingRecords.length,
      activeRecords: activeRecords.length,
      archivedRecords: trainingRecords.length - activeRecords.length,
      expiredRecords: activeRecords.filter((record) => Boolean(record.expiry_date && record.expiry_date < todayIso)).length,
      expiringSoonRecords: activeRecords.filter((record) => Boolean(record.expiry_date && record.expiry_date >= todayIso && record.expiry_date <= soonIso)).length,
      noExpiryRecords: activeRecords.filter((record) => !record.expiry_date).length,
      needsNvqRecords: activeRecords.filter((record) => record.cpcs_statuses.includes('needs_nvq')).length,
      awaitingCardRecords: activeRecords.filter((record) => record.cpcs_statuses.includes('awaiting_card')).length,
      trainingBookedRecords: activeRecords.filter((record) => record.cpcs_statuses.includes('training_booked')).length,
      manualReviewRecords: activeRecords.filter((record) => record.qualification_validation_status === 'needs_manual_review').length,
      unlinkedPeople: (people || []).filter((person) => !person.profile_id || person.profile_match_status !== 'matched').length,
    };

    return NextResponse.json({ success: true, summary });
  } catch (error) {
    console.error('Error fetching training summary:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/training/summary',
      additionalData: { endpoint: '/api/training/summary' },
    });
    return NextResponse.json({ error: 'Failed to fetch training summary' }, { status: 500 });
  }
}
