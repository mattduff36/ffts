type InspectionCommentItem = {
  id: string;
  comments: string | null;
  created_at?: string | null;
};

export type InspectionCommentTask = {
  inspection_item_id?: string | null;
  created_at?: string | null;
  logged_comment?: string | null;
  workshop_comments?: string | null;
  status?: string | null;
};

export function getInspectionEnteredComment(
  item: InspectionCommentItem,
  tasks: InspectionCommentTask[]
): string | null {
  const originalComment = item.comments?.trim() || '';
  if (!originalComment) return null;

  const normalizedComment = normalizeComment(originalComment);
  const itemCreatedAt = parseTimestamp(item.created_at);
  const hasCopiedWorkshopComment = tasks.some(task => {
    if (task.inspection_item_id !== item.id) return false;
    const taskCreatedAt = parseTimestamp(task.created_at);
    if (itemCreatedAt !== null && taskCreatedAt !== null && taskCreatedAt > itemCreatedAt) return false;

    return [task.logged_comment, task.workshop_comments]
      .map(comment => normalizeComment(comment))
      .filter(Boolean)
      .includes(normalizedComment);
  });

  return hasCopiedWorkshopComment ? null : originalComment;
}

function normalizeComment(value: string | null | undefined): string {
  return value?.trim().replace(/\s+/g, ' ').toLowerCase() || '';
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}
