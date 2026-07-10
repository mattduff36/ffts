'use client';

import type { ReactNode } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface ReviewDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  icon?: ReactNode;
  statusBadge?: ReactNode;
  children: ReactNode;
  sidebar: ReactNode;
  footer: ReactNode;
  className?: string;
}

export function ReviewDetailDialog({
  open,
  onOpenChange,
  title,
  description,
  icon,
  statusBadge,
  children,
  sidebar,
  footer,
  className,
}: ReviewDetailDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'flex max-h-[92dvh] w-[calc(100vw-1rem)] max-w-6xl flex-col gap-0 overflow-hidden border border-slate-800 bg-slate-950 p-0 text-slate-100 shadow-2xl sm:w-full',
          className
        )}
      >
        <DialogHeader className="border-b border-slate-800 bg-slate-950 px-6 py-5 pr-12 text-left">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              {icon ? (
                <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5">
                  {icon}
                </div>
              ) : null}
              <div className="min-w-0 space-y-1">
                <DialogTitle className="text-xl text-slate-50">
                  {title}
                </DialogTitle>
                <DialogDescription className="text-slate-400">
                  {description}
                </DialogDescription>
              </div>
            </div>
            {statusBadge ? <div className="shrink-0 sm:pt-1">{statusBadge}</div> : null}
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
            <div className="min-w-0 space-y-4">{children}</div>
            <aside className="min-w-0 space-y-4">{sidebar}</aside>
          </div>
        </div>

        <DialogFooter className="border-t border-slate-800 bg-slate-950/95 px-6 py-4">
          {footer}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
