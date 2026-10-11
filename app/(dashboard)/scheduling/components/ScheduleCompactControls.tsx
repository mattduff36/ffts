'use client';

import {
  createContext,
  useEffect,
  useContext,
  useRef,
  useState,
  type ComponentType,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { CircleHelp } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils/cn';
import { schedulingControlStyles } from './scheduling-control-styles';

export const SCHEDULE_RESOURCES_JOBS_HELP = [
  'Drag a queued job onto a date. Drag a scheduled visit back anywhere into Resources to return it here.',
  'Quotes without a Start Date stay in this queue. In Progress quotes appear under Accepted. Once a Start Date is set, look at that week on the calendar — they leave this list.',
] as const;

export const SCHEDULE_RESOURCES_ASSIGNMENT_HELP = [
  'Select a visit to show resources available for its exact time.',
  'Tap a resource or drag its card onto this or another visit.',
] as const;

export const SCHEDULE_BOARD_HELP =
  'Drag from the grip handle onto a timed visit, or select the visit and tap a resource.';

interface ScheduleHelpHintProps {
  label: string;
  testId?: string;
  children: ReactNode;
}

export function ScheduleHelpCopy({
  paragraphs,
}: {
  paragraphs: readonly string[];
}) {
  return (
    <div className="space-y-2">
      {paragraphs.map((text) => (
        <p key={text}>{text}</p>
      ))}
    </div>
  );
}

export function ScheduleHelpHint({ label, testId, children }: ScheduleHelpHintProps) {
  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const hoverOpenRef = useRef(false);

  function cancelClose() {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function openHelp(from: 'hover' | 'focus' | 'click' = 'click') {
    cancelClose();
    hoverOpenRef.current = from === 'hover';
    setOpen(true);
  }

  function scheduleClose() {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      hoverOpenRef.current = false;
      setOpen(false);
    }, 150);
  }

  useEffect(() => () => cancelClose(), []);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        cancelClose();
        if (!next) hoverOpenRef.current = false;
        setOpen(next);
      }}
    >
      <div
        ref={rootRef}
        className="inline-flex"
        onMouseEnter={() => openHelp('hover')}
        onMouseLeave={scheduleClose}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn('h-6 w-6', schedulingControlStyles.ghost)}
            aria-label={label}
            data-testid={testId}
            onFocus={() => openHelp('focus')}
            onClick={(event) => {
              if (open && hoverOpenRef.current) {
                hoverOpenRef.current = false;
                event.preventDefault();
                event.stopPropagation();
              }
            }}
            onBlur={(event) => {
              const next = event.relatedTarget as Node | null;
              if (next && rootRef.current?.contains(next)) return;
              scheduleClose();
            }}
          >
            <CircleHelp className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="bottom"
          role="note"
          aria-label={label}
          className="w-80 space-y-2 p-3 text-xs leading-snug text-slate-100"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onMouseEnter={() => openHelp('hover')}
          onMouseLeave={scheduleClose}
        >
          {children}
        </PopoverContent>
      </div>
    </Popover>
  );
}

type ScheduleExpandingActionProps = Omit<ButtonProps, 'children'> & {
  icon: ComponentType<{ className?: string }>;
  label: string;
};

const ACTION_LABEL_REVEAL_DELAY_MS = 1800;
const ACTION_LABEL_RESET_DELAY_MS = 3000;
const ScheduleExpandingActionGroupContext = createContext<boolean | null>(null);

export function ScheduleExpandingActionGroup({
  className,
  onPointerEnter,
  onPointerLeave,
  onFocusCapture,
  onBlurCapture,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  const [labelsPrimed, setLabelsPrimed] = useState(false);
  const revealTimerRef = useRef<number | null>(null);
  const resetTimerRef = useRef<number | null>(null);
  const pointerInsideRef = useRef(false);

  function cancelRevealTimer() {
    if (revealTimerRef.current != null) {
      window.clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
  }

  function cancelResetTimer() {
    if (resetTimerRef.current != null) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }

  function beginInteraction() {
    cancelResetTimer();
    if (labelsPrimed || revealTimerRef.current != null) return;
    revealTimerRef.current = window.setTimeout(() => {
      revealTimerRef.current = null;
      setLabelsPrimed(true);
    }, ACTION_LABEL_REVEAL_DELAY_MS);
  }

  function endInteraction() {
    cancelRevealTimer();
    if (!labelsPrimed) return;
    cancelResetTimer();
    resetTimerRef.current = window.setTimeout(() => {
      resetTimerRef.current = null;
      setLabelsPrimed(false);
    }, ACTION_LABEL_RESET_DELAY_MS);
  }

  useEffect(() => () => {
    cancelRevealTimer();
    cancelResetTimer();
  }, []);

  return (
    <ScheduleExpandingActionGroupContext.Provider value={labelsPrimed}>
      <div
        {...props}
        className={cn('flex items-center gap-2', className)}
        onPointerEnter={(event) => {
          pointerInsideRef.current = true;
          beginInteraction();
          onPointerEnter?.(event);
        }}
        onPointerLeave={(event) => {
          pointerInsideRef.current = false;
          if (!event.currentTarget.contains(document.activeElement)) {
            endInteraction();
          }
          onPointerLeave?.(event);
        }}
        onFocusCapture={(event) => {
          beginInteraction();
          onFocusCapture?.(event);
        }}
        onBlurCapture={(event) => {
          const nextTarget = event.relatedTarget as Node | null;
          if (!pointerInsideRef.current && !event.currentTarget.contains(nextTarget)) {
            endInteraction();
          }
          onBlurCapture?.(event);
        }}
      >
        {children}
      </div>
    </ScheduleExpandingActionGroupContext.Provider>
  );
}

export function ScheduleExpandingAction({
  icon: Icon,
  label,
  className,
  ...props
}: ScheduleExpandingActionProps) {
  const labelsPrimed = useContext(ScheduleExpandingActionGroupContext);
  const revealDelayClass = labelsPrimed === true
    ? 'group-hover/action:delay-0 group-focus-visible/action:delay-0'
    : 'group-hover/action:delay-[1800ms] group-focus-visible/action:delay-[1800ms]';

  return (
    <Button
      type="button"
      {...props}
      aria-label={props['aria-label'] ?? label}
      className={cn(
        'group/action h-9 min-w-9 shrink-0 gap-0 overflow-hidden px-2.5',
        className
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span
        aria-hidden
        className={cn(
          'max-w-0 overflow-hidden whitespace-nowrap opacity-0',
          'motion-safe:transition-all motion-safe:duration-[225ms] motion-safe:ease-out motion-reduce:transition-none',
          'group-hover/action:ml-2 group-hover/action:max-w-[14rem] group-hover/action:opacity-100',
          'group-focus-visible/action:ml-2 group-focus-visible/action:max-w-[14rem] group-focus-visible/action:opacity-100',
          revealDelayClass
        )}
      >
        {label}
      </span>
    </Button>
  );
}
