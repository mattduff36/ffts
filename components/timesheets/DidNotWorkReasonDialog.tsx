'use client';

import { useState } from 'react';
import { ArrowLeft, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import type { DidNotWorkTrainingSession } from '@/lib/utils/timesheet-did-not-work-bookings';

export type DidNotWorkReasonDecision =
  | { kind: 'sickness' }
  | { kind: 'training'; trainingSession: DidNotWorkTrainingSession }
  | { kind: 'other'; reason: string };

type DialogStep = 'choice' | 'training' | 'other';

const DIALOG_CONTENT_CLASSNAME =
  'max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-md gap-8 overflow-y-auto border-border bg-white p-6 text-white dark:bg-slate-900 sm:p-7';
const DIALOG_HEADER_CLASSNAME = 'space-y-4 text-center';
const DIALOG_TITLE_CLASSNAME = 'text-3xl font-bold leading-tight text-foreground';
const DIALOG_DESCRIPTION_CLASSNAME = 'text-lg leading-relaxed text-muted-foreground';
const ACTION_GRID_CLASSNAME = 'grid gap-4';
const CHOICE_GRID_CLASSNAME = 'grid grid-cols-3 gap-3 sm:gap-4';
const CHOICE_BUTTON_BASE_CLASSNAME =
  'flex h-auto min-h-24 aspect-square w-full items-center justify-center rounded-lg border-2 px-2 py-0 text-xl font-bold text-white shadow-lg transition-all hover:text-white disabled:cursor-not-allowed disabled:opacity-30';
const SICK_CHOICE_BUTTON_CLASSNAME = `${CHOICE_BUTTON_BASE_CLASSNAME} border-red-600 bg-red-600/25 shadow-red-600/15 hover:bg-red-600/35`;
const TRAINING_CHOICE_BUTTON_CLASSNAME = `${CHOICE_BUTTON_BASE_CLASSNAME} border-emerald-500 bg-emerald-500/25 shadow-emerald-500/15 hover:bg-emerald-500/35`;
const OTHER_CHOICE_BUTTON_CLASSNAME = `${CHOICE_BUTTON_BASE_CLASSNAME} border-indigo-500 bg-indigo-500/25 shadow-indigo-500/15 hover:bg-indigo-500/35`;
const LARGE_ACTION_BUTTON_CLASSNAME =
  'flex h-20 w-full items-center justify-center rounded-lg border-2 border-slate-700 bg-slate-800/30 px-4 py-5 text-xl font-semibold text-foreground shadow-sm transition-all hover:bg-slate-800/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30';
const LARGE_PRIMARY_BUTTON_CLASSNAME =
  'flex h-20 w-full items-center justify-center rounded-lg border-2 border-emerald-500 bg-emerald-500/20 px-4 py-5 text-xl font-semibold text-emerald-100 shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-500/30 hover:text-emerald-50 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-800/30 disabled:text-muted-foreground disabled:opacity-50 disabled:shadow-none';
const COMPACT_CANCEL_BUTTON_CLASSNAME =
  'mx-auto flex h-14 w-auto items-center justify-center rounded-lg border-2 border-slate-700 bg-slate-800/30 px-8 text-lg font-semibold text-foreground shadow-sm transition-all hover:bg-slate-800/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30';
const DIALOG_FOOTER_CLASSNAME = 'flex flex-row flex-wrap items-center justify-center gap-3';
const DIALOG_FOOTER_SINGLE_CLASSNAME = 'grid gap-4';

interface DidNotWorkReasonDialogProps {
  open: boolean;
  dayName: string;
  initialReason?: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (decision: DidNotWorkReasonDecision) => void;
}

export function DidNotWorkReasonDialog({
  open,
  dayName,
  initialReason = '',
  onOpenChange,
  onConfirm,
}: DidNotWorkReasonDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <DidNotWorkReasonDialogContent
          key={`${dayName}:${initialReason}`}
          dayName={dayName}
          initialReason={initialReason}
          onOpenChange={onOpenChange}
          onConfirm={onConfirm}
        />
      ) : null}
    </Dialog>
  );
}

interface DidNotWorkReasonDialogContentProps {
  dayName: string;
  initialReason: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (decision: DidNotWorkReasonDecision) => void;
}

function DidNotWorkReasonDialogContent({
  dayName,
  initialReason,
  onOpenChange,
  onConfirm,
}: DidNotWorkReasonDialogContentProps) {
  const [step, setStep] = useState<DialogStep>('choice');
  const [reason, setReason] = useState(initialReason);
  const trimmedReason = reason.trim();

  function handleConfirm() {
    if (!trimmedReason) return;
    onConfirm({ kind: 'other', reason: trimmedReason });
  }

  function handleTrainingConfirm(trainingSession: DidNotWorkTrainingSession) {
    onConfirm({ kind: 'training', trainingSession });
  }

  function renderChoiceStep() {
    return (
      <>
        <DialogHeader className={DIALOG_HEADER_CLASSNAME}>
          <DialogTitle className={DIALOG_TITLE_CLASSNAME}>Why did you not work?</DialogTitle>
          <DialogDescription className={DIALOG_DESCRIPTION_CLASSNAME}>
            {dayName} is a scheduled working day. Select the reason so the right booking can be created.
          </DialogDescription>
        </DialogHeader>
        <div className={CHOICE_GRID_CLASSNAME}>
          <Button
            type="button"
            variant="outline"
            className={SICK_CHOICE_BUTTON_CLASSNAME}
            onClick={() => onConfirm({ kind: 'sickness' })}
          >
            Sick
          </Button>
          <Button
            type="button"
            variant="outline"
            className={TRAINING_CHOICE_BUTTON_CLASSNAME}
            onClick={() => setStep('training')}
          >
            Training
          </Button>
          <Button
            type="button"
            variant="outline"
            className={OTHER_CHOICE_BUTTON_CLASSNAME}
            onClick={() => setStep('other')}
          >
            Other
          </Button>
        </div>
        <DialogFooter className={DIALOG_FOOTER_SINGLE_CLASSNAME}>
          <Button
            type="button"
            variant="outline"
            className={COMPACT_CANCEL_BUTTON_CLASSNAME}
            onClick={() => onOpenChange(false)}
          >
            <XCircle className="h-5 w-5" aria-hidden="true" />
            Cancel
          </Button>
        </DialogFooter>
      </>
    );
  }

  function renderTrainingStep() {
    return (
      <>
        <DialogHeader className={DIALOG_HEADER_CLASSNAME}>
          <DialogTitle className={DIALOG_TITLE_CLASSNAME}>Training Duration</DialogTitle>
          <DialogDescription className={DIALOG_DESCRIPTION_CLASSNAME}>
            Select whether {dayName} was booked as full-day or half-day training.
          </DialogDescription>
        </DialogHeader>
        <div className={ACTION_GRID_CLASSNAME}>
          <Button
            type="button"
            variant="outline"
            className={LARGE_ACTION_BUTTON_CLASSNAME}
            onClick={() => handleTrainingConfirm('FULL')}
          >
            Full Day
          </Button>
          <Button
            type="button"
            variant="outline"
            className={LARGE_ACTION_BUTTON_CLASSNAME}
            onClick={() => handleTrainingConfirm('AM')}
          >
            Half Day AM
          </Button>
          <Button
            type="button"
            variant="outline"
            className={LARGE_ACTION_BUTTON_CLASSNAME}
            onClick={() => handleTrainingConfirm('PM')}
          >
            Half Day PM
          </Button>
        </div>
        <DialogFooter className={DIALOG_FOOTER_CLASSNAME}>
          <Button
            type="button"
            variant="outline"
            className={COMPACT_CANCEL_BUTTON_CLASSNAME}
            onClick={() => setStep('choice')}
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            Back
          </Button>
          <Button
            type="button"
            variant="outline"
            className={COMPACT_CANCEL_BUTTON_CLASSNAME}
            onClick={() => onOpenChange(false)}
          >
            <XCircle className="h-5 w-5" aria-hidden="true" />
            Cancel
          </Button>
        </DialogFooter>
      </>
    );
  }

  function renderOtherStep() {
    return (
      <>
        <DialogHeader className={DIALOG_HEADER_CLASSNAME}>
          <DialogTitle className={DIALOG_TITLE_CLASSNAME}>Why did you not work?</DialogTitle>
          <DialogDescription className={DIALOG_DESCRIPTION_CLASSNAME}>
            {dayName} is a scheduled working day. Please explain why you are selecting Did Not Work so your
            manager or an admin can add the correct absence booking.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Example: I had a personal appointment and need this reviewing."
          rows={4}
          autoFocus
          className="min-h-44 rounded-lg border-2 border-slate-700 bg-slate-900/50 text-xl text-white placeholder:text-muted-foreground"
        />
        <Button
          type="button"
          onClick={handleConfirm}
          disabled={!trimmedReason}
          className={LARGE_PRIMARY_BUTTON_CLASSNAME}
        >
          Save Reason
        </Button>
        <DialogFooter className={DIALOG_FOOTER_CLASSNAME}>
          <Button
            type="button"
            variant="outline"
            className={COMPACT_CANCEL_BUTTON_CLASSNAME}
            onClick={() => setStep('choice')}
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            Back
          </Button>
          <Button
            type="button"
            variant="outline"
            className={COMPACT_CANCEL_BUTTON_CLASSNAME}
            onClick={() => onOpenChange(false)}
          >
            <XCircle className="h-5 w-5" aria-hidden="true" />
            Cancel
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <DialogContent className={DIALOG_CONTENT_CLASSNAME}>
      {step === 'choice' ? renderChoiceStep() : null}
      {step === 'training' ? renderTrainingStep() : null}
      {step === 'other' ? renderOtherStep() : null}
    </DialogContent>
  );
}
