'use client';

import { MonitorSmartphone } from 'lucide-react';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

interface TabletModeToggleActionsProps {
  size?: 'compact' | 'dashboard';
}

export function TabletModeToggleActions({ size = 'compact' }: TabletModeToggleActionsProps) {
  const { tabletModeEnabled, toggleTabletMode } = useTabletMode();

  return (
    <Button
      variant="ghost"
      onClick={toggleTabletMode}
      title={tabletModeEnabled ? 'Disable Tablet Mode' : 'Enable Tablet Mode'}
      className={cn(
        'border transition-colors',
        size === 'dashboard'
          ? 'h-16 w-24 md:h-[4.5rem] md:w-[6.75rem] flex-col items-center justify-center gap-1 p-1.5'
          : 'h-9 w-9 p-0 items-center justify-center',
        tabletModeEnabled
          ? 'border-brand-yellow/60 bg-brand-yellow/10 text-brand-yellow hover:bg-brand-yellow/20 hover:text-brand-yellow'
          : 'border-slate-600 text-muted-foreground hover:text-white hover:bg-slate-800/50'
      )}
    >
      <MonitorSmartphone className={size === 'dashboard' ? 'h-5 w-5 md:h-6 md:w-6' : 'h-4 w-4'} />
      {size === 'dashboard' && (
        <span className="text-[10px] md:text-[11px] font-semibold leading-tight text-center">Tablet Mode</span>
      )}
    </Button>
  );
}
