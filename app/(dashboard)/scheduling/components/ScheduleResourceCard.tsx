'use client';

import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import { useDraggable } from '@dnd-kit/react';
import { AlertTriangle, GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { formatOccupancySummary } from '@/lib/utils/scheduling-occupancy';
import type { ScheduleOccupancySegment } from '@/types/scheduling';
import { ResourceOccupancyStrip } from './ResourceOccupancyStrip';
import type { SelectedScheduleResource } from './ScheduleAssignmentDialog';
import { schedulingControlStyles } from './scheduling-control-styles';

export interface ResourceCardProps {
  resource: SelectedScheduleResource;
  subtitle: string;
  metadata: string;
  selected: boolean;
  dragEnabled: boolean;
  warning?: string;
  muted?: boolean;
  occupancySegments?: ScheduleOccupancySegment[];
  onSelect: () => void;
}

export function useDragSafeActivation(isDragging: boolean, onActivate: () => void) {
  const didDrag = useRef(false);

  useEffect(() => {
    if (isDragging) didDrag.current = true;
  }, [isDragging]);

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (didDrag.current) {
      didDrag.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onActivate();
  }

  function resetDragState() {
    if (!isDragging) didDrag.current = false;
  }

  return { handleClick, resetDragState };
}

export const RESOURCE_CARD_HANDLE_CLASS =
  'flex min-h-8 min-w-8 touch-none items-center justify-center self-stretch';

export function ResourceDragCue({ testId }: { testId: string }) {
  return (
    <GripVertical
      aria-hidden="true"
      focusable="false"
      data-testid={testId}
      className="pointer-events-none h-3.5 w-3.5 shrink-0 text-muted-foreground"
    />
  );
}

export function resourceCardTint(type: SelectedScheduleResource['type']): string {
  return type === 'employee'
    ? schedulingControlStyles.resourceEmployee
    : schedulingControlStyles.resourcePlant;
}

export function ScheduleResourceCardShell({
  selected,
  tintClassName,
  occupancySegments,
  occupancyResourceId,
  className,
  children,
}: {
  selected?: boolean;
  tintClassName: string;
  occupancySegments?: ScheduleOccupancySegment[];
  occupancyResourceId?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'relative flex w-full items-center overflow-hidden rounded-lg text-left transition',
        selected ? schedulingControlStyles.primary : tintClassName,
        className
      )}
    >
      {children}
      {occupancySegments && occupancyResourceId ? (
        <ResourceOccupancyStrip resourceId={occupancyResourceId} segments={occupancySegments} />
      ) : null}
    </div>
  );
}

export function ResourceCard({
  resource,
  subtitle,
  metadata,
  selected,
  dragEnabled,
  warning,
  muted,
  occupancySegments,
  onSelect,
}: ResourceCardProps) {
  if (dragEnabled) {
    return (
      <DraggableResourceCard
        resource={resource}
        subtitle={subtitle}
        metadata={metadata}
        selected={selected}
        warning={warning}
        muted={muted}
        occupancySegments={occupancySegments}
        onSelect={onSelect}
      />
    );
  }

  const occupancyLabel = occupancySegments
    ? formatOccupancySummary(occupancySegments)
    : undefined;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${selected ? 'Selected' : 'Select'} ${resource.label}${occupancyLabel ? `. ${occupancyLabel}` : ''}`}
      title={occupancyLabel}
      data-testid={`schedule-resource-${resource.type}-${resource.id}`}
      className={cn(
        'relative flex w-full items-center gap-1.5 overflow-hidden rounded-lg px-1.5 py-1 text-left transition',
        selected
          ? schedulingControlStyles.primary
          : resourceCardTint(resource.type),
        muted && !selected && 'opacity-70'
      )}
    >
      <ResourceDragCue testId="schedule-resource-drag-cue" />
      <span className="min-w-0 flex-1 space-y-0">
        <span className={cn('block truncate text-xs font-semibold', selected ? 'text-slate-950' : 'text-slate-100')} title={resource.label}>
          {resource.label}
        </span>
        <span className={cn('block truncate text-[11px]', selected ? 'text-slate-800' : 'text-slate-300')} title={subtitle}>
          {subtitle}
        </span>
        <span className={cn('block truncate text-[10px]', selected ? 'text-slate-700' : 'text-slate-400')} title={metadata}>
          {metadata}
        </span>
      </span>
      {warning ? <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" aria-label={warning} /> : null}
      {occupancySegments ? (
        <ResourceOccupancyStrip resourceId={resource.id} segments={occupancySegments} />
      ) : null}
    </button>
  );
}

export function DraggableResourceCard({
  resource,
  subtitle,
  metadata,
  selected,
  warning,
  muted,
  occupancySegments,
  onSelect,
}: Omit<ResourceCardProps, 'dragEnabled'>) {
  const { ref, handleRef, isDragging } = useDraggable({
    id: `resource:${resource.type}:${resource.id}`,
    type: 'schedule-resource',
    data: { resource },
  });
  const { handleClick, resetDragState } = useDragSafeActivation(isDragging, onSelect);
  const occupancyLabel = occupancySegments
    ? formatOccupancySummary(occupancySegments)
    : undefined;

  return (
    <button
      ref={(node) => {
        ref(node);
        handleRef(node);
      }}
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        handleClick(event);
      }}
      onPointerDown={resetDragState}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') resetDragState();
      }}
      aria-pressed={selected}
      aria-label={`${resource.label}: select resource or drag to a timed visit${occupancyLabel ? `. ${occupancyLabel}` : ''}`}
      title={occupancyLabel || 'Tap to assign, or drag to a timed visit'}
      data-testid={`schedule-resource-${resource.type}-${resource.id}`}
      className={cn(
        'relative flex min-h-8 w-full touch-none cursor-grab items-stretch overflow-hidden rounded-lg text-left transition',
        selected
          ? schedulingControlStyles.primary
          : resourceCardTint(resource.type),
        muted && !selected && 'opacity-70',
        isDragging && 'cursor-grabbing opacity-40'
      )}
      style={{ touchAction: 'none' }}
    >
      <span
        data-testid={`schedule-resource-drag-handle-${resource.type}-${resource.id}`}
        className={RESOURCE_CARD_HANDLE_CLASS}
        style={{ touchAction: 'none' }}
        aria-hidden="true"
      >
        <ResourceDragCue testId="schedule-resource-drag-cue" />
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-1.5 pl-0">
        <span className="min-w-0 flex-1 space-y-0">
          <span className={cn('block truncate text-xs font-semibold', selected ? 'text-slate-950' : 'text-slate-100')} title={resource.label}>
            {resource.label}
          </span>
          <span className={cn('block truncate text-[11px]', selected ? 'text-slate-800' : 'text-slate-300')} title={subtitle}>
            {subtitle}
          </span>
          <span className={cn('block truncate text-[10px]', selected ? 'text-slate-700' : 'text-slate-300')} title={metadata}>
            {metadata}
          </span>
        </span>
        {warning ? <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" aria-label={warning} /> : null}
      </span>
      {occupancySegments ? (
        <ResourceOccupancyStrip resourceId={resource.id} segments={occupancySegments} />
      ) : null}
    </button>
  );
}
