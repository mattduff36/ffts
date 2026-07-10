import { describe, expect, it } from 'vitest';
import {
  getInspectionEnteredComment,
  type InspectionCommentTask,
} from '@/lib/utils/inspection-item-comments';

describe('getInspectionEnteredComment', () => {
  it('hides a workshop status comment copied onto a later locked inspection item', () => {
    const task: InspectionCommentTask = {
      inspection_item_id: 'item-current',
      created_at: '2026-05-22T05:05:35.622Z',
      logged_comment: 'waiting for camera Technician',
      workshop_comments: null,
      status: 'logged',
    };

    expect(
      getInspectionEnteredComment(
        {
          id: 'item-current',
          comments: 'WAITING FOR CAMERA TECHNICIAN',
          created_at: '2026-06-04T05:37:39.603Z',
        },
        [task]
      )
    ).toBeNull();
  });

  it('keeps the original inspection comment when the task was created after the item', () => {
    const task: InspectionCommentTask = {
      inspection_item_id: 'item-original',
      created_at: '2026-06-04T05:38:00.000Z',
      logged_comment: 'waiting for camera Technician',
      workshop_comments: null,
      status: 'logged',
    };

    expect(
      getInspectionEnteredComment(
        {
          id: 'item-original',
          comments: 'WAITING FOR CAMERA TECHNICIAN',
          created_at: '2026-06-04T05:37:39.603Z',
        },
        [task]
      )
    ).toBe('WAITING FOR CAMERA TECHNICIAN');
  });

  it('keeps a distinct inspector comment on a later locked inspection item', () => {
    const task: InspectionCommentTask = {
      inspection_item_id: 'item-current',
      created_at: '2026-05-22T05:05:35.622Z',
      logged_comment: 'waiting for camera Technician',
      workshop_comments: null,
      status: 'logged',
    };

    expect(
      getInspectionEnteredComment(
        {
          id: 'item-current',
          comments: 'Camera still not repaired during morning check',
          created_at: '2026-06-04T05:37:39.603Z',
        },
        [task]
      )
    ).toBe('Camera still not repaired during morning check');
  });
});
