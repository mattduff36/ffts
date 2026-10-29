'use client';

import { Card, CardContent } from '@/components/ui/card';
import type { ManageDocumentsCounts } from '@/types/rams';

type FilterKey = 'all' | 'needs_signature' | 'read_only' | 'recently_uploaded';

interface ProjectsManageStatsProps {
  counts: ManageDocumentsCounts;
  activeFilter: FilterKey;
  onFilterChange: (filter: FilterKey) => void;
}

const STAT_CARDS: { key: FilterKey; label: string; color: string }[] = [
  { key: 'all', label: 'All Documents', color: 'bg-slate-500' },
  { key: 'needs_signature', label: 'Needs Signature', color: 'bg-amber-500' },
  { key: 'read_only', label: 'Read Only', color: 'bg-green-500' },
  { key: 'recently_uploaded', label: 'Last 7 Days', color: 'bg-green-500' },
];

export function ProjectsManageStats({
  counts,
  activeFilter,
  onFilterChange,
}: ProjectsManageStatsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {STAT_CARDS.map(({ key, label, color }) => (
        <Card
          key={key}
          className={`cursor-pointer transition-all duration-200 bg-white dark:bg-slate-900 border-border hover:shadow-md ${
            activeFilter === key ? 'ring-2 ring-rams bg-white/10' : ''
          }`}
          onClick={() => onFilterChange(key)}
        >
          <CardContent className="pt-4 pb-4 px-4">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground truncate">{label}</p>
                <p className="text-2xl font-bold text-foreground">
                  {counts[key] ?? 0}
                </p>
              </div>
              <div className={`h-3 w-3 rounded-full shrink-0 ${color}`} />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export type { FilterKey };
