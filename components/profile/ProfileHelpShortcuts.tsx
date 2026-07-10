'use client';

import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, BookOpen, Bug, Lightbulb, MessageSquareWarning } from 'lucide-react';
import type { ProfileOverviewPayload } from '@/types/profile';

interface ProfileHelpShortcutsProps {
  helpShortcuts: ProfileOverviewPayload['help_shortcuts'];
}

const HELP_SHORTCUTS = [
  {
    href: '/help?tab=errors',
    title: 'Report an issue',
    description: 'Open the error reporting workflow.',
    icon: AlertTriangle,
  },
  {
    href: '/help?tab=suggest',
    title: 'Suggest an improvement',
    description: 'Share an idea with the team.',
    icon: Lightbulb,
  },
  {
    href: '/help?tab=suggest',
    title: 'Track suggestions',
    description: 'Review updates on your submitted suggestions.',
    icon: MessageSquareWarning,
    requiresUnresolved: 'suggestions',
  },
  {
    href: '/help?tab=errors',
    title: 'Track error reports',
    description: 'Review updates on your reported errors.',
    icon: Bug,
    requiresUnresolved: 'errorReports',
  },
  {
    href: '/help?tab=faq',
    title: 'Browse FAQs',
    description: 'Search all help articles available to you.',
    icon: BookOpen,
  },
];

export function ProfileHelpShortcuts({ helpShortcuts }: ProfileHelpShortcutsProps) {
  const visibleShortcuts = HELP_SHORTCUTS.filter((shortcut) => {
    if (shortcut.requiresUnresolved === 'suggestions') {
      return helpShortcuts.has_unresolved_suggestions;
    }
    if (shortcut.requiresUnresolved === 'errorReports') {
      return helpShortcuts.has_unresolved_error_reports;
    }
    return true;
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Help Shortcuts</CardTitle>
        <CardDescription>Jump to the existing support, suggestions, and FAQ workflows.</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
        {visibleShortcuts.map((shortcut) => {
          const Icon = shortcut.icon;
          return (
            <Link
              key={shortcut.title}
              href={shortcut.href}
              className="min-h-32 rounded-lg border border-border p-4 transition-colors hover:bg-slate-800/30 sm:min-h-0 sm:rounded-md sm:p-3"
            >
              <div className="mb-2 flex flex-col items-start gap-2 sm:flex-row sm:items-center">
                <Icon className="h-6 w-6 text-brand-yellow sm:h-4 sm:w-4" />
                <p className="text-base font-semibold leading-tight text-foreground sm:text-sm">{shortcut.title}</p>
              </div>
              <p className="text-sm leading-snug text-muted-foreground sm:text-xs">{shortcut.description}</p>
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}

