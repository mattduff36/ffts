import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  getVanDraftExpectedChecklistCount,
  getVanDraftSubmissionDedupeKey,
  getVanDraftSubmissionHref,
  isVanDraftInspectionForReminder,
  VAN_DRAFT_SUBMISSION_REMINDER_MESSAGE,
} from '@/lib/utils/van-draft-submission-reminders';

function buildItems(count: number, dayOfWeek = 1) {
  return Array.from({ length: count }, (_, index) => ({
    item_number: index + 1,
    day_of_week: dayOfWeek,
    status: 'ok',
  }));
}

describe('van draft submission reminders', () => {
  it('builds stable one-time ids and draft routes', () => {
    const draftId = '0db2f3af-3fb9-4a4d-bf5d-8f7154b122d9';

    expect(getVanDraftSubmissionDedupeKey(draftId)).toBe(`van_draft_submission:${draftId}`);
    expect(getVanDraftSubmissionHref(draftId)).toBe(`/van-inspections/new?id=${draftId}`);
    expect(VAN_DRAFT_SUBMISSION_REMINDER_MESSAGE).toContain('click here to submit draft inspection');
    expect(VAN_DRAFT_SUBMISSION_REMINDER_MESSAGE).toContain('7-day Van Daily Checks have been retired');
  });

  it('targets unsigned draft van inspections even before all checks are complete', () => {
    expect(getVanDraftExpectedChecklistCount('Van', null)).toBe(15);

    expect(isVanDraftInspectionForReminder({
      id: 'draft-1',
      status: 'draft',
      inspection_date: '2026-06-01',
      current_mileage: null,
      vans: {
        vehicle_type: 'Van',
        van_categories: { name: 'Van' },
      },
      inspection_items: buildItems(4, 1),
    })).toBe(true);
  });

  it('does not target already signed or submitted inspections', () => {
    const baseDraft = {
      id: 'draft-1',
      inspection_date: '2026-06-01',
      current_mileage: null,
      vans: {
        vehicle_type: 'Van',
        van_categories: { name: 'Van' },
      },
    };

    expect(isVanDraftInspectionForReminder({
      ...baseDraft,
      status: 'submitted',
      submitted_at: '2026-06-01T08:00:00.000Z',
      inspection_items: buildItems(15, 1),
    })).toBe(false);

    expect(isVanDraftInspectionForReminder({
      ...baseDraft,
      status: 'draft',
      signed_at: '2026-06-01T08:00:00.000Z',
      inspection_items: buildItems(15, 1),
    })).toBe(false);
  });

  it('keeps the data backfill idempotent and scoped to draft inspections', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260601_van_draft_submission_reminders.sql'),
      'utf-8',
    );

    expect(migration).toContain("vi.status = 'draft'");
    expect(migration).toContain('LEFT JOIN public.inspection_items');
    expect(migration).not.toContain('vi.current_mileage IS NOT NULL');
    expect(migration).not.toContain('completed_item_count >= expected_item_count');
    expect(migration).toContain('WHERE NOT EXISTS');
    expect(migration).toContain('ON CONFLICT (action_id, assigned_to) DO NOTHING');
    expect(migration).toContain("'draft_inspection_id'");
    expect(migration).toContain("'/van-inspections/new?id='");
    expect(migration).toContain('stale_draft_actions');
    expect(migration).toContain("status = 'cancelled'");
    expect(migration).toContain('Draft van daily check no longer needs submission.');
  });
});
