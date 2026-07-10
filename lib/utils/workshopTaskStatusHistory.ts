export type StatusHistoryEvent = {
  id: string;
  type: 'status';
  status: 'logged' | 'on_hold' | 'completed' | 'resumed' | 'undo' | 'pending';
  created_at: string;
  author_id: string | null;
  author_name?: string | null;
  body?: string | null;
  meta?: {
    from?: string;
    to?: string;
    signature_data?: string;
    signed_at?: string;
    timestamp_adjusted?: boolean;
  };
};

const generateId = (status: string) => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `status:${status}:${Date.now()}`;
};

export const buildStatusHistoryEvent = ({
  status,
  body,
  authorId,
  authorName,
  meta,
  createdAt,
}: {
  status: StatusHistoryEvent['status'];
  body?: string | null;
  authorId: string | null;
  authorName?: string | null;
  meta?: StatusHistoryEvent['meta'];
  createdAt?: string;
}): StatusHistoryEvent => ({
  id: generateId(status),
  type: 'status',
  status,
  created_at: createdAt || new Date().toISOString(),
  author_id: authorId,
  author_name: authorName,
  body: body || null,
  meta,
});

export const appendStatusHistory = (
  existing: unknown,
  nextEvents: StatusHistoryEvent | StatusHistoryEvent[]
): StatusHistoryEvent[] => {
  const base = Array.isArray(existing) ? (existing as StatusHistoryEvent[]) : [];
  const events = Array.isArray(nextEvents) ? nextEvents : [nextEvents];
  return [...base, ...events];
};

export const updateLatestInProgressStatusHistoryTimestamp = (
  existing: unknown,
  createdAt: string
): StatusHistoryEvent[] => {
  const base = Array.isArray(existing) ? (existing as StatusHistoryEvent[]) : [];
  let latestIndex = -1;
  let latestTime = Number.NEGATIVE_INFINITY;

  base.forEach((event, index) => {
    if (event.status !== 'logged' && event.status !== 'resumed') return;
    const eventTime = Date.parse(event.created_at);
    if (Number.isNaN(eventTime) || eventTime < latestTime) return;
    latestTime = eventTime;
    latestIndex = index;
  });

  if (latestIndex === -1) return base;

  return base.map((event, index) =>
    index === latestIndex
      ? {
          ...event,
          created_at: createdAt,
        }
      : event
  );
};
