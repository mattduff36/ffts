'use client';

import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, BookOpen, Lightbulb, MessageSquareWarning } from 'lucide-react';

const HELP_SHORTCUTS = [
  {
    href: '/help?tab=errors',
    title: 'Report an issue',
    description: 'Open the existing error report workflow from Help.',
    icon: AlertTriangle,
  },
  {
    href: '/help?tab=suggest',
    title: 'Suggest an improvement',
    description: 'Share ideas using the current suggestion workflow.',
    icon: Lightbulb,
  },
  {
    href: '/help?tab=my-suggestions',
    title: 'Track suggestions',
    description: 'Review status updates on your submitted suggestions.',
    icon: MessageSquareWarning,
  },
  {
    href: '/help?tab=faq',
    title: 'Browse FAQs',
    description: 'Jump straight to searchable help content.',
    icon: BookOpen,
  },
];

export function ProfileHelpShortcuts() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Help Shortcuts</CardTitle>
        <CardDescription>Use the same Help workflows without duplicating forms on Profile.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {HELP_SHORTCUTS.map((shortcut) => {
          const Icon = shortcut.icon;
          return (
            <Link
              key={shortcut.href}
              href={shortcut.href}
              className="rounded-md border border-border p-3 transition-colors hover:bg-slate-800/30"
            >
              <div className="mb-2 flex items-center gap-2">
                <Icon className="h-4 w-4 text-brand-yellow" />
                <p className="text-sm font-semibold text-foreground">{shortcut.title}</p>
              </div>
              <p className="text-xs text-muted-foreground">{shortcut.description}</p>
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}

