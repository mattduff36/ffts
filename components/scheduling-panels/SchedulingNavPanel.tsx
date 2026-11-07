'use client';

import * as Dialog from '@radix-ui/react-dialog';
import dynamic from 'next/dynamic';
import { ExternalLink, X } from 'lucide-react';
import type { SchedulingPanelModule } from '@/lib/client/scheduling-panel-events';
import { PanelAccess } from './PanelAccess';

const QuotesPanel = dynamic(() => import('./QuotesPanel').then(module => module.QuotesPanel), { loading: () => <p role="status">Loading quotes...</p> });
const CustomersPanel = dynamic(() => import('./CustomersPanel').then(module => module.CustomersPanel), { loading: () => <p role="status">Loading customers...</p> });

export function SchedulingNavPanel({ module, onClose, returnFocus }: {
  module: SchedulingPanelModule;
  onClose: () => void;
  returnFocus: () => void;
}) {
  const title = module === 'quotes' ? 'Quotes' : 'Customers';
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/40" />
      <Dialog.Content
        data-testid="scheduling-nav-panel"
        className="fixed inset-y-0 left-0 z-[100] flex w-full flex-col overflow-hidden border-r border-slate-700 bg-slate-900 text-slate-100 shadow-2xl transition-none motion-safe:animate-in motion-safe:slide-in-from-left-4 motion-safe:[animation-duration:150ms] md:top-[68px] md:left-16 md:w-[min(60rem,calc(100vw-4rem))]"
        onCloseAutoFocus={event => { event.preventDefault(); returnFocus(); }}
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-slate-700 p-4">
          <div className="min-w-0 flex-1">
            <Dialog.Title className="text-xl font-semibold text-white">{title}</Dialog.Title>
            <Dialog.Description className="text-sm text-slate-400">Work here without leaving your schedule.</Dialog.Description>
          </div>
          <a href={`/${module}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-sm text-slate-300 hover:text-white" aria-label={`Open full ${module} page in a new tab`}>
            <ExternalLink className="h-4 w-4" /><span className="hidden sm:inline">Full page</span>
          </a>
          <Dialog.Close className="rounded p-2 hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-brand-yellow" aria-label={`Close ${title} panel`}><X className="h-5 w-5" /></Dialog.Close>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
          <PanelAccess module={module}>
            {module === 'quotes' ? <QuotesPanel /> : <CustomersPanel />}
          </PanelAccess>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
