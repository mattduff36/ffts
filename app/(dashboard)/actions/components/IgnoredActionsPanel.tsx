'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RotateCcw, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadMorePagination } from '@/components/ui/load-more-pagination';
import { PanelLoader } from '@/components/ui/panel-loader';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { FLEET_INSPECTION_OVERDUE_WORKFLOW_KEY } from '@/lib/config/reminder-workflows';
import { useLoadMorePagination } from '@/lib/hooks/useLoadMorePagination';
import { cn } from '@/lib/utils/cn';
import type { ReminderActionWithAsset } from '@/types/reminders';
import { toast } from 'sonner';

interface IgnoredActionsPanelProps {
  onRestored?: () => void;
}

function formatIgnoredUntil(action: ReminderActionWithAsset): string {
  if (action.ignored_forever) return 'Forever';
  if (!action.ignored_until) return 'Unknown';

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(action.ignored_until));
}

function getIgnoredBadgeVariant(action: ReminderActionWithAsset) {
  return action.ignored_forever ? 'warning' : 'secondary';
}

export function IgnoredActionsPanel({ onRestored }: IgnoredActionsPanelProps) {
  const router = useRouter();
  const [actions, setActions] = useState<ReminderActionWithAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const {
    visibleItems: visibleActions,
    showMore,
  } = useLoadMorePagination(actions, { resetKey: `ignored:${actions.length}` });

  const loadIgnoredActions = useCallback(async () => {
    setLoading(true);
    try {
      const searchParams = new URLSearchParams({
        workflow: FLEET_INSPECTION_OVERDUE_WORKFLOW_KEY,
        status: 'open',
        ignored: 'active',
      });

      const response = await fetch(`/api/actions?${searchParams.toString()}`, {
        cache: 'no-store',
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load ignored actions');
      }

      setActions((payload.actions || []) as ReminderActionWithAsset[]);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Failed to load ignored actions');
      setActions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadIgnoredActions();
  }, [loadIgnoredActions]);

  async function restoreAction(action: ReminderActionWithAsset) {
    setRestoringId(action.id);
    try {
      const response = await fetch(`/api/actions/${action.id}/ignore`, {
        method: 'DELETE',
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to restore reminder');
      }

      toast.success('Reminder restored');
      await loadIgnoredActions();
      onRestored?.();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Failed to restore reminder');
    } finally {
      setRestoringId(null);
    }
  }

  function openAssetHistory(action: ReminderActionWithAsset) {
    if (action.asset_route) {
      router.push(action.asset_route);
    }
  }

  return (
    <Card className="border-slate-700 bg-slate-900/70">
      <CardHeader>
        <CardTitle>Ignored reminders</CardTitle>
        <CardDescription>
          Restore ignored reminders so they can appear again on the Actions overview.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <PanelLoader message="Loading ignored reminders..." className="py-12" />
        ) : actions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center">
            <TriangleAlert className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              No reminders are currently ignored.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-lg border border-slate-700">
              <Table>
              <TableHeader>
                <TableRow className="border-slate-700 hover:bg-transparent">
                  <TableHead>Asset</TableHead>
                  <TableHead>Ignored until</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleActions.map((action) => (
                  <TableRow
                    key={action.id}
                    className={cn(
                      'border-slate-700',
                      action.asset_route && 'cursor-pointer hover:bg-slate-800/50',
                    )}
                    onClick={() => openAssetHistory(action)}
                  >
                    <TableCell>
                      <p className="font-medium text-foreground">{action.asset_label || action.title}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={getIgnoredBadgeVariant(action)}>
                        {formatIgnoredUntil(action)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void restoreAction(action)}
                        disabled={restoringId === action.id}
                        className="border-slate-600 text-white hover:bg-slate-800"
                      >
                        {restoringId === action.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RotateCcw className="h-4 w-4" />
                        )}
                        Restore
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              </Table>
            </div>
            <LoadMorePagination
              visibleCount={visibleActions.length}
              totalCount={actions.length}
              itemLabel="ignored reminders"
              onShowMore={showMore}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
