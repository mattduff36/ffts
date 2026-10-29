'use client';

import { createElement } from 'react';
import { Check } from 'lucide-react';
import { toast } from 'sonner';

/** One acknowledgement replaces the previous one during rapid edits. */
export function acknowledgeSuccess(): void {
  toast.success('Done', {
    id: 'ffts-action-success',
    duration: 1400,
    icon: createElement(Check, { className: 'h-4 w-4 text-emerald-500', 'aria-hidden': true }),
  });
}
