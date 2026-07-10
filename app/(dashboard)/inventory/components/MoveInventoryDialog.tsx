'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  INVENTORY_CHECKLIST_DEFINITIONS,
  INVENTORY_SERVICE_CHECKLIST_VERSION,
  getInventoryChecklistDefinition,
} from '@/lib/checklists/inventory-service-checklist';
import { InventoryCheckModal, type InventoryChecklistSubmitPayload } from './InventoryCheckModal';
import type { InventoryCheckStatus, InventoryItem, InventoryLocation, InventoryMovePayload } from '../types';
import { getCheckStatusLabel } from '../utils';
import { InventoryLocationSelect } from './InventoryLocationSelect';

interface MoveInventoryDialogProps {
  open: boolean;
  items: InventoryItem[];
  locations: InventoryLocation[];
  onClose: () => void;
  onSubmit: (payload: InventoryMovePayload) => Promise<void>;
}

interface CheckBlockedMoveItem {
  id: string;
  item_number: string;
  name: string;
  check_status: InventoryCheckStatus;
}

interface ApiResponseError extends Error {
  payload?: unknown;
}

interface InventoryCheckRequiredPayload {
  code: 'INVENTORY_CHECK_REQUIRED';
  error: string;
  blocked_items: CheckBlockedMoveItem[];
}

function getInventoryCheckRequiredPayload(error: unknown): InventoryCheckRequiredPayload | null {
  const payload = (error as ApiResponseError | undefined)?.payload;
  if (!payload || typeof payload !== 'object') return null;
  const candidate = payload as Partial<InventoryCheckRequiredPayload>;
  if (candidate.code !== 'INVENTORY_CHECK_REQUIRED' || !Array.isArray(candidate.blocked_items)) return null;
  return candidate as InventoryCheckRequiredPayload;
}

export function MoveInventoryDialog({
  open,
  items,
  locations,
  onClose,
  onSubmit,
}: MoveInventoryDialogProps) {
  const [locationId, setLocationId] = useState('');
  const [note, setNote] = useState('');
  const [moveScope, setMoveScope] = useState<'single' | 'group'>('single');
  const [saving, setSaving] = useState(false);
  const [blockedItems, setBlockedItems] = useState<CheckBlockedMoveItem[]>([]);
  const [checkingItem, setCheckingItem] = useState<CheckBlockedMoveItem | null>(null);
  const [savingCheck, setSavingCheck] = useState(false);
  const isBulkMove = items.length > 1;
  const group = !isBulkMove ? items[0]?.group : null;
  const checklistDefinition =
    getInventoryChecklistDefinition(INVENTORY_SERVICE_CHECKLIST_VERSION) || INVENTORY_CHECKLIST_DEFINITIONS[0];

  useEffect(() => {
    setLocationId('');
    setNote('');
    setMoveScope('single');
    setBlockedItems([]);
    setCheckingItem(null);
  }, [open]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSubmit({
        location_id: locationId,
        note,
        scope: group && moveScope === 'group' ? 'group' : isBulkMove ? 'bulk' : 'single',
        group_id: group && moveScope === 'group' ? group.id : null,
      });
      onClose();
    } catch (error) {
      const blockedPayload = getInventoryCheckRequiredPayload(error);
      if (blockedPayload) {
        setBlockedItems(blockedPayload.blocked_items);
        toast.error(blockedPayload.error);
        return;
      }
      toast.error(error instanceof Error ? error.message : 'Failed to move inventory items');
    } finally {
      setSaving(false);
    }
  }

  async function handleRecordBlockedItemCheck(checkPayload: InventoryChecklistSubmitPayload) {
    if (!checkingItem) return;

    setSavingCheck(true);
    try {
      const response = await fetch(`/api/inventory/${checkingItem.id}/checks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(checkPayload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to record inventory check');

      const checkedItemName = checkingItem.name;
      setBlockedItems((current) => current.filter((item) => item.id !== checkingItem.id));
      setCheckingItem(null);
      toast.success(`Inventory check recorded for ${checkedItemName}`, {
        description: 'Retry the move once all blocked items are checked.',
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to record inventory check');
    } finally {
      setSavingCheck(false);
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen && !saving && !savingCheck) onClose(); }}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-lg overflow-y-auto bg-slate-900 text-white border-slate-700">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isBulkMove ? `Move ${items.length} Items` : 'Move Inventory Item'}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Select the new location bucket. The move will be written to the item movement history.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {!isBulkMove && items[0] ? (
              <div className="rounded-md border border-slate-700 bg-slate-800/60 p-3 text-sm">
                <div className="font-medium text-white">{items[0].name}</div>
                <div className="text-muted-foreground">{items[0].item_number}</div>
              </div>
            ) : null}

            {group ? (
              <div className="rounded-md border border-purple-500/25 bg-purple-500/10 p-3 text-sm">
                <div className="font-medium text-purple-100">This item belongs to the group “{group.name}”.</div>
                <RadioGroup
                  value={moveScope}
                  onValueChange={(value) => setMoveScope(value as 'single' | 'group')}
                  className="mt-3 space-y-2"
                >
                  <label className="flex items-center gap-2 text-slate-200">
                    <RadioGroupItem value="single" />
                    Move only this item
                  </label>
                  <label className="flex items-center gap-2 text-slate-200">
                    <RadioGroupItem value="group" />
                    Move the entire group
                  </label>
                </RadioGroup>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label>Destination Location *</Label>
              <InventoryLocationSelect
                value={locationId}
                onValueChange={(value) => {
                  setLocationId(value);
                  setBlockedItems([]);
                }}
                locations={locations}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="move_note">Move Note</Label>
              <Textarea
                id="move_note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                className="bg-slate-800 border-slate-600"
                rows={3}
                placeholder="Optional reason or handover note"
              />
            </div>

            {blockedItems.length > 0 ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                <div className="font-medium">
                  {blockedItems.length === 1
                    ? 'This item needs a check before it can move.'
                    : 'These items need checks before they can move.'}
                </div>
                <div className="mt-1 text-xs text-amber-100/80">
                  Use Check Now here, then retry the move once the blocked list is clear.
                </div>
                <div className="mt-3 space-y-2">
                  {blockedItems.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-3 rounded border border-amber-500/20 bg-slate-950/30 p-2">
                      <div>
                        <div className="font-medium text-white">{item.name}</div>
                        <div className="text-xs text-amber-100/80">
                          {item.item_number} · {getCheckStatusLabel(item.check_status)}
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setCheckingItem(item)}
                        className="shrink-0 border-amber-400/40 text-amber-100 hover:bg-amber-500/10"
                      >
                        Check Now
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-inventory text-white hover:bg-inventory-dark"
              disabled={saving || !locationId || items.length === 0}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Move
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    {checkingItem ? (
      <InventoryCheckModal
        open={Boolean(checkingItem)}
        onOpenChange={(nextOpen) => { if (!nextOpen && !savingCheck) setCheckingItem(null); }}
        itemName={checkingItem.name}
        itemNumber={checkingItem.item_number}
        checklistDefinition={checklistDefinition}
        initialCheckedAt={new Date().toISOString().slice(0, 10)}
        saving={savingCheck}
        onSubmit={handleRecordBlockedItemCheck}
      />
    ) : null}
    </>
  );
}
