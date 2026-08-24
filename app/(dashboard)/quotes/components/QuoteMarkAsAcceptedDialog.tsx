'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface QuoteMarkAsAcceptedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actionLoading?: boolean;
  onAcceptWithoutRams: () => void | Promise<void>;
}

export function QuoteMarkAsAcceptedDialog({
  open,
  onOpenChange,
  actionLoading = false,
  onAcceptWithoutRams,
}: QuoteMarkAsAcceptedDialogProps) {
  const [stubOpen, setStubOpen] = useState(false);

  function closeQuestion() {
    if (actionLoading) return;
    onOpenChange(false);
  }

  function handleYes() {
    if (actionLoading) return;
    onOpenChange(false);
    setStubOpen(true);
  }

  async function handleNo() {
    if (actionLoading) return;
    await onAcceptWithoutRams();
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) closeQuestion(); }}>
        <DialogContent className="max-w-md bg-slate-900 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle>Are RAMS required for this job?</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Yes will start the RAMS reminder workflow. No marks this quote as accepted without requesting RAMS.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={closeQuestion}
              disabled={actionLoading}
              className="border-slate-600 text-muted-foreground"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleYes}
              disabled={actionLoading}
              className="border-slate-600 text-slate-100"
            >
              Yes
            </Button>
            <Button
              type="button"
              onClick={() => void handleNo()}
              disabled={actionLoading}
              className="bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90"
            >
              {actionLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : 'No'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={stubOpen} onOpenChange={setStubOpen}>
        <DialogContent className="max-w-md bg-slate-900 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle>RAMS workflow still being developed</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              This workflow is still being developed. The quote has not been marked as accepted, and no reminder or email has been sent.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              onClick={() => setStubOpen(false)}
              className="bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
