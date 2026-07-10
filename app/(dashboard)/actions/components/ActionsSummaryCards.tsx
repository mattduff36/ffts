'use client';

import type { ReactNode } from 'react';
import { BellRing, TriangleAlert, UserX } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import type { ActionsSummaryStats } from '@/lib/utils/actions-summary';

interface SummaryCardProps {
  label: string;
  value: number;
  icon: ReactNode;
  tone?: 'default' | 'danger' | 'warning' | 'info';
}

function SummaryCard({ label, value, icon, tone = 'default' }: SummaryCardProps) {
  const toneClassName = {
    default: 'text-brand-yellow bg-brand-yellow/15',
    danger: 'text-red-300 bg-red-500/10',
    warning: 'text-amber-300 bg-amber-500/10',
    info: 'text-slate-300 bg-slate-500/10',
  }[tone];

  return (
    <Card className="border-slate-700 bg-slate-900/70">
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`rounded-lg p-2 ${toneClassName}`}>
          {icon}
        </div>
        <div>
          <div className="text-2xl font-bold text-white">{value}</div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

interface ActionsSummaryCardsProps {
  summary: ActionsSummaryStats;
}

export function ActionsSummaryCards({ summary }: ActionsSummaryCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <SummaryCard label="Actions" value={summary.openActions} icon={<BellRing className="h-5 w-5" />} />
      <SummaryCard
        label="Pending reminders"
        value={summary.pendingReminders}
        icon={<TriangleAlert className="h-5 w-5" />}
        tone="warning"
      />
      <SummaryCard label="Unassigned" value={summary.unassigned} icon={<UserX className="h-5 w-5" />} />
    </div>
  );
}
