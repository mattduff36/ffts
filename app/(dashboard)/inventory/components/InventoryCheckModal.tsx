'use client';

import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { AlertCircle, CheckCircle2, MinusCircle, XCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, dialogContentViewportClassName } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { useDirtyDialogGuard } from '@/lib/hooks/useDirtyDialogGuard';
import { cn } from '@/lib/utils/cn';
import {
  INVENTORY_CHECKLIST_STATUS_LABELS,
  type InventoryChecklistDefinition,
  type InventoryChecklistItemResult,
  type InventoryChecklistStatus,
} from '@/lib/checklists/inventory-service-checklist';

export interface InventoryChecklistSubmitPayload {
  checked_at: string;
  note: string | null;
  checklist_version: string;
  checklist_items: InventoryChecklistItemResult[];
}

interface InventoryCheckModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemName: string;
  itemNumber: string;
  checklistDefinition: InventoryChecklistDefinition;
  initialCheckedAt: string;
  saving: boolean;
  onSubmit: (payload: InventoryChecklistSubmitPayload) => Promise<void>;
}

const STATUS_OPTIONS: Array<{ status: InventoryChecklistStatus; tone: 'success' | 'danger' | 'neutral' }> = [
  { status: 'ok', tone: 'success' },
  { status: 'attention', tone: 'danger' },
  { status: 'na', tone: 'neutral' },
];

function buildInventoryCheckDirtySnapshot({
  checkedAt,
  statuses,
  comments,
  generalComments,
}: {
  checkedAt: string;
  statuses: Record<number, InventoryChecklistStatus>;
  comments: Record<number, string>;
  generalComments: string;
}) {
  return JSON.stringify({ checkedAt, statuses, comments, generalComments });
}

function getChoiceButtonClasses(tone: 'success' | 'danger' | 'neutral', selected: boolean): string {
  const base = 'min-h-11 rounded-lg border px-3 py-2 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inventory/60';

  if (tone === 'success') {
    return cn(
      base,
      selected
        ? 'border-green-600 bg-green-600 text-white shadow-sm'
        : 'border-green-500/40 bg-green-500/10 text-green-300 hover:bg-green-500/20',
    );
  }

  if (tone === 'danger') {
    return cn(
      base,
      selected
        ? 'border-red-600 bg-red-600 text-white shadow-sm'
        : 'border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20',
    );
  }

  return cn(
    base,
    selected
      ? 'border-slate-500 bg-slate-600 text-white shadow-sm'
      : 'border-slate-500/40 bg-slate-500/10 text-slate-300 hover:bg-slate-500/20',
  );
}

function StatusIcon({ status, selected }: { status: InventoryChecklistStatus; selected: boolean }) {
  const iconClassName = selected ? 'h-4 w-4 text-white' : 'h-4 w-4';
  if (status === 'ok') return <CheckCircle2 className={iconClassName} />;
  if (status === 'attention') return <XCircle className={iconClassName} />;
  return <MinusCircle className={iconClassName} />;
}

export function InventoryCheckModal({
  open,
  onOpenChange,
  itemName,
  itemNumber,
  checklistDefinition,
  initialCheckedAt,
  saving,
  onSubmit,
}: InventoryCheckModalProps) {
  const checklistItems = checklistDefinition.items;
  const [checkedAt, setCheckedAt] = useState(initialCheckedAt);
  const [statuses, setStatuses] = useState<Record<number, InventoryChecklistStatus>>({});
  const [comments, setComments] = useState<Record<number, string>>({});
  const [generalComments, setGeneralComments] = useState('');
  const [error, setError] = useState<string | null>(null);

  const completedCount = Object.keys(statuses).length;
  const failedCount = useMemo(
    () => Object.values(statuses).filter((status) => status === 'attention').length,
    [statuses],
  );
  const progressPercent = Math.round((completedCount / checklistItems.length) * 100);
  const currentDirtySnapshot = buildInventoryCheckDirtySnapshot({
    checkedAt,
    statuses,
    comments,
    generalComments,
  });
  const cleanDirtySnapshot = buildInventoryCheckDirtySnapshot({
    checkedAt: initialCheckedAt,
    statuses: {},
    comments: {},
    generalComments: '',
  });
  const isFormDirty = open && currentDirtySnapshot !== cleanDirtySnapshot;

  function resetInventoryCheckForm() {
    setCheckedAt(initialCheckedAt);
    setStatuses({});
    setComments({});
    setGeneralComments('');
    setError(null);
  }

  const {
    contentRef,
    handleOpenChange,
    handleInteractOutside,
    handleEscapeKeyDown,
    discard,
  } = useDirtyDialogGuard({
    isDirty: isFormDirty,
    disabled: saving,
    onOpenChange: (nextOpen) => {
      if (!nextOpen) resetInventoryCheckForm();
      onOpenChange(nextOpen);
    },
  });

  function handleStatusChange(itemNumberValue: number, status: InventoryChecklistStatus) {
    setStatuses((current) => ({ ...current, [itemNumberValue]: status }));
    setError(null);
  }

  function handleCommentChange(itemNumberValue: number, value: string) {
    setComments((current) => ({ ...current, [itemNumberValue]: value }));
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!checkedAt) {
      setError('Choose a check date before recording this checklist.');
      return;
    }

    const missingItem = checklistItems.find((item) => !statuses[item.item_number]);
    if (missingItem) {
      setError(`Choose Pass, Fail, or N/A for item ${missingItem.item_number}: ${missingItem.label}.`);
      return;
    }

    const failedWithoutComment = checklistItems.find(
      (item) => statuses[item.item_number] === 'attention' && !comments[item.item_number]?.trim(),
    );
    if (failedWithoutComment) {
      setError(`Add a comment for failed item ${failedWithoutComment.item_number}: ${failedWithoutComment.label}.`);
      return;
    }

    const submittedChecklistItems = checklistItems.map((item) => ({
      ...item,
      status: statuses[item.item_number],
      comment: comments[item.item_number]?.trim() || null,
    }));

    await onSubmit({
      checked_at: checkedAt,
      note: generalComments.trim() || null,
      checklist_version: checklistDefinition.version,
      checklist_items: submittedChecklistItems,
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        ref={contentRef}
        className={dialogContentViewportClassName({ size: '6xl', scroll: 'content', className: 'border border-border bg-slate-950 p-0 text-white' })}
        onInteractOutside={handleInteractOutside}
        onEscapeKeyDown={handleEscapeKeyDown}
      >
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader className="border-b border-border px-6 py-5 md:px-8 md:py-6">
            <DialogTitle className="text-xl text-white">{checklistDefinition.modalTitle}</DialogTitle>
            <DialogDescription>
              {checklistDefinition.modalDescription}
              <span className="mt-1 block">
                Item: {itemName} ({itemNumber}).
              </span>
            </DialogDescription>
            <div className="pt-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{completedCount}/{checklistItems.length} items complete</span>
                <span>{failedCount} failed</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
                <div className="h-full bg-inventory transition-all duration-300" style={{ width: `${progressPercent}%` }} />
              </div>
            </div>
          </DialogHeader>

          <ScrollArea className="min-h-0 flex-1 px-6 py-6 md:px-8 md:py-8">
            <div className="space-y-6">
              {error ? (
                <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}

              <div className="grid gap-2 md:max-w-xs">
                <Label htmlFor="inventory_check_date">Check Date</Label>
                <Input
                  id="inventory_check_date"
                  type="date"
                  value={checkedAt}
                  onChange={(event) => setCheckedAt(event.target.value)}
                  className="border-slate-600 bg-slate-900 text-white"
                />
              </div>

              <div className="grid gap-3 xl:grid-cols-2 xl:gap-4">
                {checklistItems.map((item) => {
                  const selectedStatus = statuses[item.item_number];
                  const showComment = selectedStatus === 'attention' || Boolean(comments[item.item_number]);

                  return (
                    <div key={item.item_number} className="rounded-xl border border-border/70 bg-slate-900/60 p-4 xl:p-5">
                      <div className="space-y-4">
                        <div className="flex gap-3">
                          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-slate-600 bg-slate-800 text-sm font-bold text-slate-300">
                            {item.item_number}
                          </div>
                          <div>
                            <div className="font-medium text-white">{item.label}</div>
                            {selectedStatus ? (
                              <div className="mt-1 text-xs text-muted-foreground">
                                Selected: {INVENTORY_CHECKLIST_STATUS_LABELS[selectedStatus]}
                              </div>
                            ) : null}
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                          {STATUS_OPTIONS.map(({ status, tone }) => {
                            const selected = selectedStatus === status;
                            return (
                              <button
                                key={status}
                                type="button"
                                aria-pressed={selected}
                                onClick={() => handleStatusChange(item.item_number, status)}
                                className={getChoiceButtonClasses(tone, selected)}
                              >
                                <span className="flex items-center justify-center gap-2">
                                  <StatusIcon status={status} selected={selected} />
                                  {INVENTORY_CHECKLIST_STATUS_LABELS[status]}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {showComment ? (
                        <div className="mt-4 space-y-2">
                          <Label htmlFor={`inventory_check_comment_${item.item_number}`}>
                            {selectedStatus === 'attention' ? 'Comments (Required)' : 'Notes'}
                          </Label>
                          <Textarea
                            id={`inventory_check_comment_${item.item_number}`}
                            value={comments[item.item_number] || ''}
                            onChange={(event) => handleCommentChange(item.item_number, event.target.value)}
                            placeholder={selectedStatus === 'attention' ? 'Add details for this failed check...' : 'Optional notes...'}
                            className={cn(
                              'min-h-20 border-slate-600 bg-slate-950 text-white',
                              selectedStatus === 'attention' && !comments[item.item_number]?.trim() ? 'border-red-500' : null,
                            )}
                          />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </ScrollArea>

          <DialogFooter className="flex-col gap-4 border-t border-border px-6 py-4 sm:flex-col sm:items-stretch sm:justify-start md:px-8 md:py-5">
            <div className="grid gap-2">
              <Label htmlFor="inventory_check_general_comments">Comments</Label>
              <Textarea
                id="inventory_check_general_comments"
                value={generalComments}
                onChange={(event) => {
                  setGeneralComments(event.target.value);
                  setError(null);
                }}
                placeholder="Add any necessary details for this check..."
                className="min-h-24 border-slate-600 bg-slate-950 text-white"
                disabled={saving}
              />
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={discard} disabled={saving}>
                {isFormDirty ? 'Discard Changes' : 'Cancel'}
              </Button>
              <Button type="submit" className="bg-inventory text-white hover:bg-inventory-dark" disabled={saving}>
                {saving ? 'Submitting...' : 'Submit Check'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
