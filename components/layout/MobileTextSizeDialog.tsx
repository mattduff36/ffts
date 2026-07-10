'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  MOBILE_TEXT_SIZE_CHANGED_EVENT,
  MOBILE_TEXT_SIZE_LABELS,
  type MobileTextSizeStep,
  normalizeMobileTextSizeStep,
  readMobileTextSizePreference,
  writeMobileTextSizePreference,
} from '@/lib/config/mobile-text-size-preference';

interface MobileTextSizeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MobileTextSizeDialog({ open, onOpenChange }: MobileTextSizeDialogProps) {
  const [selectedStep, setSelectedStep] = useState<MobileTextSizeStep>(() => readMobileTextSizePreference());

  useEffect(() => {
    const syncPreference = () => {
      setSelectedStep(readMobileTextSizePreference());
    };

    window.addEventListener('storage', syncPreference);
    window.addEventListener(MOBILE_TEXT_SIZE_CHANGED_EVENT, syncPreference);

    return () => {
      window.removeEventListener('storage', syncPreference);
      window.removeEventListener(MOBILE_TEXT_SIZE_CHANGED_EVENT, syncPreference);
    };
  }, []);

  function handleTextSizeChange(value: string) {
    const nextStep = normalizeMobileTextSizeStep(value);
    setSelectedStep(nextStep);
    writeMobileTextSizePreference(nextStep);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="mx-4 max-h-[calc(100dvh-1rem)] w-[calc(100vw-2rem)] max-w-sm overflow-y-auto border border-slate-700 bg-slate-900 text-white shadow-2xl">
        <DialogHeader className="space-y-3 text-left">
          <DialogTitle className="text-xl text-white">Text size</DialogTitle>
          <DialogDescription className="text-slate-300">
            Adjust the mobile text size for this device. Your choice is saved in this browser.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="rounded-xl border border-slate-700 bg-slate-950/70 p-4">
            <p className="text-sm font-medium text-slate-300">Preview</p>
            <p className="mt-2 text-base font-semibold text-white">Timesheets and daily checks</p>
            <p className="mt-1 text-sm text-slate-400">This is how regular app text will scale on mobile.</p>
          </div>

          <div className="flex items-center gap-4 rounded-full bg-slate-950/80 px-5 py-4">
            <span aria-hidden className="text-lg font-bold leading-none text-slate-400">
              A
            </span>
            <input
              aria-label="Mobile text size"
              aria-valuetext={MOBILE_TEXT_SIZE_LABELS[selectedStep]}
              className="mobile-text-size-slider"
              max={5}
              min={1}
              onChange={(event) => handleTextSizeChange(event.currentTarget.value)}
              step={1}
              type="range"
              value={selectedStep}
            />
            <span aria-hidden className="text-4xl font-bold leading-none text-slate-400">
              A
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            onClick={() => onOpenChange(false)}
            className="min-h-11 w-full bg-brand-yellow text-base font-bold text-slate-950 shadow-sm hover:bg-brand-yellow-hover disabled:bg-brand-yellow disabled:text-slate-950 disabled:opacity-70"
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
