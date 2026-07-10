'use client';

import dynamic from 'next/dynamic';
import { FileText, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PanelLoader } from '@/components/ui/panel-loader';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const PDFViewer = dynamic(
  () => import('./PDFViewer').then((mod) => ({ default: mod.PDFViewer })),
  {
    ssr: false,
    loading: () => <PanelLoader message="Preparing PDF viewer..." className="flex-1 py-16" />,
  }
);

interface ToolboxTalkPdfDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string | null;
  title: string;
}

export function ToolboxTalkPdfDialog({
  open,
  onOpenChange,
  url,
  title,
}: ToolboxTalkPdfDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none grid-rows-none flex-col gap-0 overflow-hidden bg-white p-0 text-foreground dark:bg-slate-950 sm:h-[92vh] sm:max-w-5xl sm:rounded-xl">
        <DialogHeader className="border-b border-slate-800 bg-slate-950 px-4 py-3 text-left sm:px-5">
          <div className="flex items-center justify-between gap-3 pr-8">
            <div className="min-w-0">
              <DialogTitle className="flex min-w-0 items-center gap-2 text-base text-white">
                <FileText className="h-4 w-4 shrink-0 text-brand-yellow" />
                <span className="truncate">{title}</span>
              </DialogTitle>
              <DialogDescription className="mt-1 text-xs text-slate-300">
                Review the attached toolbox talk PDF without leaving the app.
              </DialogDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="shrink-0 gap-2 border-slate-600 bg-slate-900 text-white hover:bg-slate-800 hover:text-white"
            >
              <X className="h-4 w-4" />
              Close PDF
            </Button>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-100 p-3 dark:bg-slate-950 sm:p-5">
          {url ? (
            <div className="mx-auto max-w-4xl rounded-md bg-white p-2 shadow-sm dark:bg-slate-900 sm:p-4">
              <PDFViewer url={url} />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No PDF selected.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
