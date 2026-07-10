'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReminderOverviewTabConfig } from '@/lib/config/reminder-workflows';
import {
  buildReminderActionsQueryParams,
  isReminderActionActive,
  type ReminderActionFilterState,
} from '@/lib/utils/reminder-action-filters';
import type { ReminderActionIgnoreDuration, ReminderActionWithAsset } from '@/types/reminders';
import { toast } from 'sonner';
import { ActionsAssignDialog } from './ActionsAssignDialog';
import { ActionsTable } from './ActionsTable';

const DEFAULT_FILTERS: ReminderActionFilterState = {
  search: '',
  assignment: 'all',
};

interface ActionsOverviewPanelProps {
  tab: ReminderOverviewTabConfig;
  refreshToken: number;
  onActionsChanged?: () => void;
}

export function ActionsOverviewPanel({
  tab,
  refreshToken,
  onActionsChanged,
}: ActionsOverviewPanelProps) {
  const [actions, setActions] = useState<ReminderActionWithAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<ReminderActionFilterState>(DEFAULT_FILTERS);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [selectedAction, setSelectedAction] = useState<ReminderActionWithAsset | null>(null);

  const loadActions = useCallback(async () => {
    setLoading(true);
    try {
      const searchParams = buildReminderActionsQueryParams({
        workflowKey: tab.workflowKey,
        assetType: tab.assetType,
        ensureFresh: true,
      });

      const response = await fetch(`/api/actions?${searchParams.toString()}`, {
        cache: 'no-store',
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load actions');
      }

      setActions(((payload.actions || []) as ReminderActionWithAsset[]).filter(isReminderActionActive));
    } catch (error) {
      console.error(error);
      setActions([]);
    } finally {
      setLoading(false);
    }
  }, [tab.assetType, tab.workflowKey]);

  useEffect(() => {
    void loadActions();
  }, [loadActions, refreshToken]);

  function handleAssign(action: ReminderActionWithAsset) {
    setSelectedAction(action);
    setAssignDialogOpen(true);
  }

  async function handleIgnore(action: ReminderActionWithAsset, duration: ReminderActionIgnoreDuration) {
    if (duration === 'forever') {
      const confirmed = window.confirm(
        'Ignore this reminder forever? It will only be visible again if restored from Settings.',
      );
      if (!confirmed) return;
    }

    try {
      const response = await fetch(`/api/actions/${action.id}/ignore`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ duration }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to ignore reminder');
      }

      toast.success('Reminder ignored');
      await loadActions();
      onActionsChanged?.();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Failed to ignore reminder');
    }
  }

  return (
    <>
      <ActionsTable
        actions={actions}
        assetType={tab.assetType}
        loading={loading}
        filters={filters}
        onFiltersChange={setFilters}
        onAssign={handleAssign}
        onIgnore={handleIgnore}
      />

      <ActionsAssignDialog
        open={assignDialogOpen}
        action={selectedAction}
        onOpenChange={setAssignDialogOpen}
        onAssigned={async () => {
          await loadActions();
          onActionsChanged?.();
        }}
      />
    </>
  );
}
