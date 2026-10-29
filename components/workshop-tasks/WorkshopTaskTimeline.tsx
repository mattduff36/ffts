import {
  CheckCircle2,
  Clock,
  MessageSquare,
  Pause,
  Play,
  Undo2,
  User,
} from 'lucide-react';
import { formatDateTime } from '@/lib/utils/date';
import { StatusHistoryEvent } from '@/lib/utils/workshopTaskStatusHistory';
import {
  buildWorkshopTaskTimelineItems,
  type WorkshopTaskTimelineComment,
  type WorkshopTaskTimelineTask,
} from '@/lib/utils/workshopTaskTimeline';
import type { AdjustTimestampTarget } from '@/components/workshop-tasks/AdjustTaskTimestampDialog';

const getStatusConfig = (status: StatusHistoryEvent['status']) => {
  switch (status) {
    case 'logged':
      return {
        icon: <Clock className="h-4 w-4 text-blue-400 mt-0.5" />,
        dotClass: 'bg-green-500',
        label: 'marked in progress',
      };
    case 'on_hold':
      return {
        icon: <Pause className="h-4 w-4 text-purple-400 mt-0.5" />,
        dotClass: 'bg-purple-500',
        label: 'placed on hold',
      };
    case 'resumed':
      return {
        icon: <Play className="h-4 w-4 text-blue-400 mt-0.5" />,
        dotClass: 'bg-green-500',
        label: 'resumed task',
      };
    case 'completed':
      return {
        icon: <CheckCircle2 className="h-4 w-4 text-green-400 mt-0.5" />,
        dotClass: 'bg-green-500',
        label: 'marked complete',
      };
    case 'undo':
      return {
        icon: <Undo2 className="h-4 w-4 text-slate-400 mt-0.5" />,
        dotClass: 'bg-slate-500',
        label: 'undid status change',
      };
    case 'pending':
    default:
      return {
        icon: <Clock className="h-4 w-4 text-slate-400 mt-0.5" />,
        dotClass: 'bg-slate-500',
        label: 'set to pending',
      };
  }
};

function getAdjustmentLabel(status: StatusHistoryEvent['status']) {
  switch (status) {
    case 'logged':
      return 'In Progress';
    case 'on_hold':
      return 'On Hold';
    case 'resumed':
      return 'Resumed';
    case 'completed':
      return 'Completed';
    case 'undo':
      return 'Undo';
    case 'pending':
    default:
      return 'Status Event';
  }
}

export function WorkshopTaskTimeline({
  task,
  comments = [],
  onAdjustTimestamp,
}: {
  task: WorkshopTaskTimelineTask;
  comments?: WorkshopTaskTimelineComment[];
  onAdjustTimestamp?: (target: AdjustTimestampTarget) => void;
}) {
  const timelineItems = buildWorkshopTaskTimelineItems(task, comments);

  const handleAdjustTimestamp = (target: AdjustTimestampTarget) => {
    if (!onAdjustTimestamp) {
      return;
    }

    onAdjustTimestamp(target);
  };

  const renderTimestamp = (target: AdjustTimestampTarget, className = 'text-xs text-muted-foreground') => {
    if (!onAdjustTimestamp) {
      return (
        <p className={className}>
          {formatDateTime(target.currentTimestamp)}
        </p>
      );
    }

    return (
      <button
        type="button"
        onClick={() => handleAdjustTimestamp(target)}
        className={`${className} inline-flex w-fit cursor-pointer rounded-sm underline underline-offset-2 transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
      >
        {formatDateTime(target.currentTimestamp)}
      </button>
    );
  };

  return (
    <div className="space-y-3 border-l-2 border-border pl-4 ml-2">
      {timelineItems.map((item) => {
        if (item.type === 'created') {
          return (
            <div key={item.key} className="relative">
              <div className="absolute -left-[1.3rem] top-1 h-3 w-3 rounded-full bg-muted border-2 border-slate-900"></div>
              <div className="flex items-start gap-3">
                <User className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{item.author || 'Unknown'}</span>
                    <span className="text-xs text-muted-foreground">created task</span>
                  </div>
                  {renderTimestamp({
                    itemType: 'created',
                    timelineItemId: item.timelineItemId,
                    label: 'Created',
                    currentTimestamp: item.created_at,
                  })}
                </div>
              </div>
            </div>
          );
        }

        if (item.type === 'status') {
          const config = getStatusConfig(item.status);
          const undoSuffix =
            item.status === 'undo' && item.meta?.to
              ? `to ${item.meta.to.replace('_', ' ')}`
              : '';

          return (
            <div key={item.key} className="relative">
              <div
                className={`absolute -left-[1.3rem] top-1 h-3 w-3 rounded-full ${config.dotClass} border-2 border-slate-900`}
              ></div>
              <div className="flex items-start gap-3">
                {config.icon}
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{item.author || 'Unknown'}</span>
                    <span className="text-xs text-muted-foreground">
                      {config.label} {undoSuffix}
                    </span>
                  </div>
                  {item.body && (
                    <p className="text-sm text-muted-foreground">{item.body}</p>
                  )}
                  {item.meta?.signature_data && (
                    <div className="space-y-1">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.meta.signature_data} alt="Completion signature" className="border rounded p-1 bg-white max-w-xs" />
                      {item.meta.signed_at && (
                        <p className="text-xs text-muted-foreground">
                          Signed: {formatDateTime(item.meta.signed_at)}
                        </p>
                      )}
                    </div>
                  )}
                  {renderTimestamp({
                    itemType: 'status_event',
                    timelineItemId: item.timelineItemId,
                    label: `${getAdjustmentLabel(item.status)} event`,
                    currentTimestamp: item.created_at,
                  })}
                </div>
              </div>
            </div>
          );
        }

        return (
          <div key={item.key} className="relative">
            <div className="absolute -left-[1.3rem] top-1 h-3 w-3 rounded-full bg-muted border-2 border-slate-900"></div>
            <div className="flex items-start gap-3">
              <MessageSquare className="h-4 w-4 text-muted-foreground mt-0.5" />
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{item.author || 'Unknown'}</span>
                  <span className="text-xs text-muted-foreground">added comment</span>
                </div>
                <p className="text-sm text-muted-foreground">{item.body}</p>
                <div className="text-xs text-muted-foreground">
                  {renderTimestamp({
                    itemType: 'comment',
                    timelineItemId: item.timelineItemId,
                    label: 'Comment',
                    currentTimestamp: item.created_at,
                  }, 'text-xs text-muted-foreground')}
                  {item.updated_at && <span className="ml-1">(edited)</span>}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
