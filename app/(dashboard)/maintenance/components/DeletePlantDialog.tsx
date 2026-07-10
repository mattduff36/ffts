'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2, Archive } from 'lucide-react';
import { toast } from 'sonner';
import { logger } from '@/lib/utils/logger';
import { createClient } from '@/lib/supabase/client';

interface DeletePlantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plant: {
    id: string;
    plant_id: string;
    nickname?: string | null;
    van_categories?: { name: string } | null;
  } | null;
  onSuccess?: () => void;
}

type DeleteReason = 'Sold' | 'Scrapped' | 'Other';

export function DeletePlantDialog({
  open,
  onOpenChange,
  plant,
  onSuccess
}: DeletePlantDialogProps) {
  const queryClient = useQueryClient();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState<DeleteReason>('Sold');
  const [error, setError] = useState('');

  async function handleDelete() {
    if (!plant || !reason) {
      setError('Please select a reason');
      return;
    }

    setError('');

    try {
      setLoading(true);

      // Check for open workshop tasks first
      const { data: openTasks, error: tasksError } = await supabase
        .from('actions')
        .select('id, status')
        .eq('plant_id', plant.id)
        .neq('status', 'completed')
        .limit(1);

      if (tasksError) {
        throw new Error(`Failed to check for open tasks: ${tasksError.message}`);
      }

      if (openTasks && openTasks.length > 0) {
        setError('Cannot retire plant with open workshop tasks. Please complete or delete all open tasks first.');
        toast.error('Cannot retire plant with open workshop tasks', {
          description: 'Please complete or delete all open tasks before retiring this plant machinery.',
          duration: 5000,
        });
        setLoading(false);
        return;
      }

      // Update plant status to retired with reason and timestamp
      const now = new Date().toISOString();
      const { error: updateError } = await supabase
        .from('plant')
        .update({ 
          status: 'retired',
          retired_at: now,
          retire_reason: reason,
          updated_at: now,
        })
        .eq('id', plant.id);

      if (updateError) {
        throw new Error(`Failed to retire plant: ${updateError.message}`);
      }

      toast.success('Plant retired successfully', {
        description: `${plant.plant_id} has been moved to Retired Plant. Historic data is preserved.`,
      });

      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['maintenance'] });
      queryClient.invalidateQueries({ queryKey: ['plant'] });

      onSuccess?.();
      onOpenChange(false);
      
      // Reset reason for next time
      setReason('Sold');
    } catch (error: unknown) {
      logger.error('Error retiring plant', error, 'DeletePlantDialog');
      const msg = error instanceof Error ? error.message : 'An unexpected error occurred';
      setError(msg);
      toast.error('Failed to retire plant', {
        description: msg || 'Please try again.',
      });
    } finally {
      setLoading(false);
    }
  }

  if (!plant) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-md overflow-y-auto border-border text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-blue-500">
            <Archive className="h-5 w-5" />
            Retire Plant
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            This will move the plant machinery to the &quot;Retired Plant&quot; tab. All maintenance history and workshop records will be preserved.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <div className="bg-red-900/20 border border-red-800 rounded-lg p-3">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Plant Info */}
          <div className="bg-slate-800 rounded-lg p-4 space-y-2">
            <p className="text-sm">
              <span className="text-muted-foreground">Plant ID:</span>{' '}
              <span className="text-white font-medium">{plant.plant_id}</span>
            </p>
            {plant.nickname && (
              <p className="text-sm">
                <span className="text-muted-foreground">Description:</span>{' '}
                <span className="text-white">{plant.nickname}</span>
              </p>
            )}
            {plant.van_categories && (
              <p className="text-sm">
                <span className="text-muted-foreground">Category:</span>{' '}
                <span className="text-white">{plant.van_categories.name}</span>
              </p>
            )}
          </div>

          {/* Reason Selection */}
          <div className="space-y-3">
            <Label className="text-white">
              Reason for retirement <span className="text-red-400">*</span>
            </Label>
            <RadioGroup value={reason} onValueChange={(value) => setReason(value as DeleteReason)}>
              <div className="flex items-center space-x-2 bg-slate-800 rounded-lg p-3 border border-slate-700 hover:border-slate-600 transition-colors">
                <RadioGroupItem value="Sold" id="sold" />
                <Label htmlFor="sold" className="text-white cursor-pointer flex-1">
                  Sold
                </Label>
              </div>
              <div className="flex items-center space-x-2 bg-slate-800 rounded-lg p-3 border border-slate-700 hover:border-slate-600 transition-colors">
                <RadioGroupItem value="Scrapped" id="scrapped" />
                <Label htmlFor="scrapped" className="text-white cursor-pointer flex-1">
                  Scrapped
                </Label>
              </div>
              <div className="flex items-center space-x-2 bg-slate-800 rounded-lg p-3 border border-slate-700 hover:border-slate-600 transition-colors">
                <RadioGroupItem value="Other" id="other" />
                <Label htmlFor="other" className="text-white cursor-pointer flex-1">
                  Other
                </Label>
              </div>
            </RadioGroup>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              setError('');
              setReason('Sold'); // Reset to default
            }}
            className="border-slate-600 text-white hover:bg-slate-800"
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleDelete}
            disabled={loading}
            className="bg-maintenance hover:bg-maintenance-dark"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Retiring...
              </>
            ) : (
              <>
                <Archive className="h-4 w-4 mr-2" />
                Retire Plant
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
