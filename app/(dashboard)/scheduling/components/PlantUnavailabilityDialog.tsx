'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
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
  deletePlantUnavailability,
  savePlantUnavailability,
} from '@/lib/client/scheduling';
import type { SchedulePlantResource, SchedulePlantUnavailability } from '@/types/scheduling';

interface PlantUnavailabilityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plant: SchedulePlantResource[];
  blocks: SchedulePlantUnavailability[];
  defaultDate: string;
  onSaved: () => void;
}

export function PlantUnavailabilityDialog({
  open,
  onOpenChange,
  plant,
  blocks,
  defaultDate,
  onSaved,
}: PlantUnavailabilityDialogProps) {
  const [showForm, setShowForm] = useState(false);
  const [plantId, setPlantId] = useState('');
  const [startDate, setStartDate] = useState(defaultDate);
  const [endDate, setEndDate] = useState(defaultDate);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteBlock, setDeleteBlock] = useState<SchedulePlantUnavailability | null>(null);

  useEffect(() => {
    if (!open) return;
    setShowForm(false);
    setStartDate(defaultDate);
    setEndDate(defaultDate);
  }, [defaultDate, open]);

  async function handleSave() {
    setSaving(true);
    try {
      await savePlantUnavailability({
        plant_id: plantId,
        start_date: startDate,
        end_date: endDate,
        reason,
        notes: notes || null,
      });
      toast.success('Plant availability updated');
      setShowForm(false);
      setPlantId('');
      setReason('');
      setNotes('');
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save unavailability');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deletePlantUnavailability(id);
      toast.success('Unavailability removed');
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to remove unavailability');
    }
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
              className="bg-primary text-primary-foreground hover:bg-primary/90"
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
                      className="text-red-300 hover:text-red-200"
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
              <Button variant="outline" onClick={() => setShowForm(false)}>Back</Button>
              <Button
                onClick={() => void handleSave()}
                disabled={saving || !plantId || !reason.trim()}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save block
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
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
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-red-600 text-white hover:bg-red-500"
            onClick={() => {
              if (!deleteBlock) return;
              void handleDelete(deleteBlock.id).finally(() => setDeleteBlock(null));
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
