'use client';

import { useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  type SavePlantUnavailabilityInput,
} from '@/lib/client/scheduling';
import type { SchedulePlantResource, SchedulePlantUnavailability } from '@/types/scheduling';
import { schedulingControlStyles } from './scheduling-control-styles';

interface PlantUnavailabilityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plant: SchedulePlantResource[];
  blocks: SchedulePlantUnavailability[];
  defaultDate: string;
  initialInput?: SavePlantUnavailabilityInput | null;
  onSave: (input: SavePlantUnavailabilityInput) => void;
  onDelete: (block: SchedulePlantUnavailability) => void;
}

export function PlantUnavailabilityDialog({
  open,
  onOpenChange,
  plant,
  blocks,
  defaultDate,
  initialInput = null,
  onSave,
  onDelete,
}: PlantUnavailabilityDialogProps) {
  const [showForm, setShowForm] = useState(Boolean(initialInput));
  const [plantId, setPlantId] = useState(initialInput?.plant_id || '');
  const [startDate, setStartDate] = useState(initialInput?.start_date || defaultDate);
  const [endDate, setEndDate] = useState(initialInput?.end_date || defaultDate);
  const [reason, setReason] = useState(initialInput?.reason || '');
  const [notes, setNotes] = useState(initialInput?.notes || '');
  const [saving, setSaving] = useState(false);
  const [deleteBlock, setDeleteBlock] = useState<SchedulePlantUnavailability | null>(null);

  function handleSave() {
    onSave({
      plant_id: plantId,
      start_date: startDate,
      end_date: endDate,
      reason,
      notes: notes || null,
    });
    setSaving(false);
    setShowForm(false);
    setPlantId('');
    setReason('');
    setNotes('');
  }

  function handleDelete(block: SchedulePlantUnavailability) {
    onDelete(block);
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-2xl overflow-y-auto border-border">
        <DialogHeader>
          <DialogTitle>Plant unavailability</DialogTitle>
          <DialogDescription>
            Record breakdowns, maintenance, hire-outs, and other dated availability blocks.
          </DialogDescription>
        </DialogHeader>

        {!showForm ? (
          <div className="space-y-3">
            <Button
              type="button"
              onClick={() => setShowForm(true)}
              className={schedulingControlStyles.primary}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add block
            </Button>
            {blocks.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                No plant unavailability overlaps this week.
              </p>
            ) : (
              blocks.map((block) => {
                const resource = plant.find((item) => item.id === block.plant_id);
                return (
                  <div key={block.id} className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
                    <div>
                      <p className="font-medium text-foreground">
                        {resource?.plant_id || 'Plant'}{resource?.nickname ? ` — ${resource.nickname}` : ''}
                      </p>
                      <p className="text-sm text-muted-foreground">{block.reason}</p>
                      <p className="text-xs text-muted-foreground">{block.start_date} to {block.end_date}</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={schedulingControlStyles.danger}
                      onClick={() => setDeleteBlock(block)}
                      aria-label={`Remove ${block.reason}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Plant</Label>
              <Select value={plantId} onValueChange={setPlantId}>
                <SelectTrigger><SelectValue placeholder="Select plant" /></SelectTrigger>
                <SelectContent>
                  {plant.map((resource) => (
                    <SelectItem key={resource.id} value={resource.id}>
                      {resource.plant_id}{resource.nickname ? ` — ${resource.nickname}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="plant-unavailable-start">Start date</Label>
                <Input id="plant-unavailable-start" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="plant-unavailable-end">End date</Label>
                <Input id="plant-unavailable-end" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="plant-unavailable-reason">Reason</Label>
              <Input id="plant-unavailable-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Maintenance, breakdown, hired out…" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="plant-unavailable-notes">Notes</Label>
              <Textarea id="plant-unavailable-notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
            </div>
          </div>
        )}

        <DialogFooter>
          {showForm ? (
            <>
              <Button variant="outline" className={schedulingControlStyles.outline} onClick={() => setShowForm(false)}>Back</Button>
              <Button
                onClick={handleSave}
                disabled={saving || !plantId || !reason.trim()}
                className={schedulingControlStyles.primary}
              >
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save block
              </Button>
            </>
          ) : (
            <Button variant="outline" className={schedulingControlStyles.outline} onClick={() => onOpenChange(false)}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <AlertDialog open={deleteBlock !== null} onOpenChange={(value) => !value && setDeleteBlock(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove this availability block?</AlertDialogTitle>
          <AlertDialogDescription>
            Future assignments will no longer warn that this plant is unavailable for these dates.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className={schedulingControlStyles.outline}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={schedulingControlStyles.danger}
            onClick={() => {
              if (!deleteBlock) return;
              handleDelete(deleteBlock);
              setDeleteBlock(null);
            }}
          >
            Remove block
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
