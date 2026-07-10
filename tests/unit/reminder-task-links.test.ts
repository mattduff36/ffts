import { describe, expect, it } from 'vitest';
import { VAN_DRAFT_SUBMISSION_WORKFLOW_KEY } from '@/lib/config/reminder-workflows';
import { getReminderTaskLink, getReminderTaskLinkForAction, getReminderTaskName } from '@/lib/utils/reminder-task-links';
import { getReminderAssetIdColumn } from '@/lib/server/reminders/complete-reminder-action';

describe('reminder task links', () => {
  it('links fleet inspection reminders to the matching new daily check page', () => {
    expect(getReminderTaskLink('van')).toEqual({
      href: '/van-inspections/new',
      label: 'Start van daily check',
    });
    expect(getReminderTaskLink('plant')).toEqual({
      href: '/plant-inspections/new',
      label: 'Start plant daily check',
    });
    expect(getReminderTaskLink('hgv')).toEqual({
      href: '/hgv-inspections/new',
      label: 'Start HGV daily check',
    });
  });

  it('returns simple task names for user-facing reminder text', () => {
    expect(getReminderTaskName('van')).toBe('van daily check');
    expect(getReminderTaskName('plant')).toBe('plant daily check');
    expect(getReminderTaskName('hgv')).toBe('HGV daily check');
    expect(getReminderTaskName(null)).toBe('assigned task');
  });

  it('links van draft submission reminders directly to the draft edit route', () => {
    expect(getReminderTaskLinkForAction({
      workflow_key: VAN_DRAFT_SUBMISSION_WORKFLOW_KEY,
      asset_type: 'van',
      metadata: {
        draft_inspection_id: '4b227777-9d90-4d41-a7d6-3186c49e9098',
      },
    })).toEqual({
      href: '/van-inspections/new?id=4b227777-9d90-4d41-a7d6-3186c49e9098',
      label: 'click here to submit draft inspection',
    });
  });

  it('prefers the draft inspection id when draft metadata has a stale generic href', () => {
    expect(getReminderTaskLinkForAction({
      workflow_key: VAN_DRAFT_SUBMISSION_WORKFLOW_KEY,
      asset_type: 'van',
      metadata: {
        draft_inspection_id: '4b227777-9d90-4d41-a7d6-3186c49e9098',
        draft_href: '/van-inspections/new',
      },
    })).toEqual({
      href: '/van-inspections/new?id=4b227777-9d90-4d41-a7d6-3186c49e9098',
      label: 'click here to submit draft inspection',
    });
  });

  it('falls back to the draft action dedupe key instead of a generic href', () => {
    expect(getReminderTaskLinkForAction({
      workflow_key: VAN_DRAFT_SUBMISSION_WORKFLOW_KEY,
      dedupe_key: 'van_draft_submission:4b227777-9d90-4d41-a7d6-3186c49e9098',
      asset_type: 'van',
      metadata: {
        draft_href: '/van-inspections/new',
      },
    })).toEqual({
      href: '/van-inspections/new?id=4b227777-9d90-4d41-a7d6-3186c49e9098',
      label: 'click here to submit draft inspection',
    });
  });

  it('does not expose a generic new-check route for draft submission reminders', () => {
    expect(getReminderTaskLinkForAction({
      workflow_key: VAN_DRAFT_SUBMISSION_WORKFLOW_KEY,
      asset_type: 'van',
      metadata: {
        draft_href: '/van-inspections/new',
      },
    })).toBeNull();
  });

  it('maps asset types to reminder action id columns', () => {
    expect(getReminderAssetIdColumn('van')).toBe('van_id');
    expect(getReminderAssetIdColumn('plant')).toBe('plant_id');
    expect(getReminderAssetIdColumn('hgv')).toBe('hgv_id');
  });
});
