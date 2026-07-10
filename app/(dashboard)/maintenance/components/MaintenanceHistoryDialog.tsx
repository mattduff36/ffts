'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PanelLoader } from '@/components/ui/panel-loader';
import { History as HistoryIcon, User, Edit, ChevronDown, ChevronUp, Clock, FileText } from 'lucide-react';
import { useMaintenanceHistory } from '@/lib/hooks/useMaintenance';
import { formatDateTime } from '@/lib/utils/date';
import { formatMaintenanceDate } from '@/lib/utils/maintenanceCalculations';
import { MotHistoryDialog } from './MotHistoryDialog';

interface MaintenanceHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleId: string | null;
  assetType?: 'van' | 'hgv' | 'plant';
  vehicleReg?: string;
  onEditClick?: () => void;
}

export function MaintenanceHistoryDialog({
  open,
  onOpenChange,
  vehicleId,
  assetType = 'van',
  vehicleReg,
  onEditClick
}: MaintenanceHistoryDialogProps) {
  const { data: historyData, isLoading } = useMaintenanceHistory(vehicleId);
  const isHgvAsset = assetType === 'hgv';
  const [showFullHistory, setShowFullHistory] = useState(false);
  const [visibleHistoryCount, setVisibleHistoryCount] = useState(10);
  const [motHistoryOpen, setMotHistoryOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  
  const history = historyData?.history || [];
  const workshopTasks = historyData?.workshopTasks || [];
  const vesData = historyData?.vesData || null;
  const defectBadgeClass = assetType === 'hgv'
    ? 'text-hgv-inspection border-hgv-inspection'
    : assetType === 'plant'
      ? 'text-plant-inspection border-plant-inspection'
      : 'text-inspection border-inspection';
  
  // Combine maintenance history and workshop tasks, sorted by date
  type CombinedItem = 
    | { type: 'maintenance'; data: typeof history[0]; created_at: string }
    | { type: 'workshop'; data: typeof workshopTasks[0]; created_at: string };
  
  const combinedItems: CombinedItem[] = [
    ...history.map(h => ({ type: 'maintenance' as const, data: h, created_at: h.created_at })),
    ...workshopTasks.map(w => ({ type: 'workshop' as const, data: w, created_at: w.created_at }))
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  
  // Auto-sync on modal open if last sync was >24h ago
  useEffect(() => {
    if (open && vehicleId && vesData) {
      // Check if sync is needed (>24 hours since last sync)
      const checkIfSyncNeeded = (data: Record<string, unknown>): boolean => {
        const lastDvlaSync = data.last_dvla_sync ? new Date(data.last_dvla_sync as string).getTime() : 0;
        const lastMotSync = data.last_mot_api_sync ? new Date(data.last_mot_api_sync as string).getTime() : 0;
        const now = Date.now();
        const twentyFourHours = 24 * 60 * 60 * 1000;
        
        // Sync if either TAX or MOT hasn't been synced in 24h
        const dvlaStale = (now - lastDvlaSync) > twentyFourHours;
        const motStale = (now - lastMotSync) > twentyFourHours;
        
        return dvlaStale || motStale;
      };

      // Perform auto-sync in background
      const performAutoSync = async () => {
        if (isSyncing) return;
        
        setIsSyncing(true);
        try {
          const response = await fetch('/api/maintenance/sync-dvla', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assetIds: [vehicleId], assetType }),
          });
          
          const result = await response.json();
          
          if (result.success) {
            // Silently refresh data without full page reload
            window.location.reload();
          }
        } catch (error) {
          console.error('Auto-sync error:', error);
          // Fail silently - don't interrupt user experience
        } finally {
          setIsSyncing(false);
        }
      };

      const shouldSync = checkIfSyncNeeded(vesData);
      if (shouldSync) {
        performAutoSync();
      }
    }
  }, [open, vehicleId, vesData, isSyncing, assetType]);
  
  // Group combined items by date (show all changes made together)
  const groupedHistory: Record<string, typeof combinedItems> = {};
  combinedItems.forEach(item => {
    const dateKey = new Date(item.created_at).toISOString().split('T')[0];
    if (!groupedHistory[dateKey]) {
      groupedHistory[dateKey] = [];
    }
    groupedHistory[dateKey].push(item);
  });
  
  const formatFieldName = (fieldName: string): string => {
    const fieldMap: Record<string, string> = {
      'tax_due_date': 'Tax Due Date',
      'mot_due_date': 'MOT Due Date',
      'first_aid_kit_expiry': 'First Aid Kit Expiry',
      'six_weekly_inspection_due_date': '6 Weekly Inspection Due',
      'fire_extinguisher_due_date': 'Fire Extinguisher Due',
      'taco_calibration_due_date': 'Taco Calibration Due',
      'next_service_mileage': isHgvAsset ? 'Next Service (KM)' : 'Next Service',
      'last_service_mileage': isHgvAsset ? 'Last Service (KM)' : 'Last Service',
      'cambelt_due_mileage': isHgvAsset ? 'Cambelt Due (KM)' : 'Cambelt Due',
      'cambelt_done': 'Cambelt Done',
      'notes': 'Notes',
      'all_fields': 'All Fields',
      'no_changes': 'Comment Only',
    };
    return fieldMap[fieldName] || fieldName;
  };
  
  const formatValue = (value: string | null, type: string): string => {
    if (!value || value === 'null') return 'Not Set';
    
    if (type === 'date') {
      return formatMaintenanceDate(value);
    }
    if (type === 'mileage') {
      return parseInt(value).toLocaleString() + (isHgvAsset ? ' km' : ' miles');
    }
    if (type === 'boolean') {
      return value === 'true' ? 'Yes' : 'No';
    }
    return value;
  };
  
  // Get latest 3 entries for summary
  const latestEntries = combinedItems.slice(0, 3);
  
  // Calculate how many items will be shown on initial expansion
  const totalRemaining = combinedItems.length - 3;
  const initialExpandCount = Math.min(visibleHistoryCount, totalRemaining);
  
  // Calculate remaining items (accounting for the 3 already shown in Recent Updates)
  const remainingCount = Math.max(0, combinedItems.length - (visibleHistoryCount + 3));
  const hasMoreHistory = remainingCount > 0;
  
  // Unified card renderer for both workshop tasks and maintenance history
  const renderHistoryCard = (item: CombinedItem, showTimestamp: boolean = true) => {
    if (item.type === 'workshop') {
      const task = item.data;
      return (
        <div 
          key={task.id}
          className="bg-gradient-to-r from-[#8B4513]/20 to-[#8B4513]/10 border border-[#8B4513]/30 rounded-lg p-4 hover:border-[#8B4513]/50 transition-colors"
        >
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-[#D2691E]" />
              <span className="font-medium text-white">
                {task.profiles?.full_name || 'Unknown User'}
              </span>
            </div>
            {showTimestamp && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {getDisplayTimestamp(item.created_at)}
              </div>
            )}
          </div>
          
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge
                variant="outline"
                className={`bg-transparent text-xs font-semibold ${
                  task.action_type === 'inspection_defect' ? defectBadgeClass : 'text-workshop border-workshop'
                }`}
              >
                {task.action_type === 'inspection_defect' ? 'Daily Check Defect Fix' : 'Workshop Task'}
              </Badge>
              {task.action_type === 'workshop_vehicle_task' && task.workshop_task_categories && (
                <Badge variant="outline" className="text-xs">
                  {task.workshop_task_categories.name}
                </Badge>
              )}
              <Badge variant="outline" className={`text-xs ${
                task.status === 'completed' ? 'bg-green-500/20 border-green-500/40 text-green-400' :
                task.status === 'logged' ? 'bg-blue-500/20 border-blue-500/40 text-blue-400' :
                'bg-amber-500/20 border-amber-500/40 text-amber-400'
              }`}>
                {task.status === 'completed' ? 'Completed' :
                 task.status === 'logged' ? 'In Progress' : 'Pending'}
              </Badge>
            </div>
            
            {task.status === 'completed' && task.actioned_at && (
              <div className="text-xs text-green-400">
                ✓ Completed: {getDisplayTimestamp(task.actioned_at)}
              </div>
            )}
            {task.status === 'logged' && task.logged_at && (
              <div className="text-xs text-blue-400">
                ⚙ Started: {getDisplayTimestamp(task.logged_at)}
              </div>
            )}
          </div>
          
          {(task.workshop_comments || task.description || task.logged_comment || task.actioned_comment) && (
            <div className="bg-slate-900/50 rounded p-3 border border-slate-700 mt-2 space-y-2">
              {task.workshop_comments && (
                <div>
                  <p className="text-xs text-muted-foreground font-medium mb-1">Task Details:</p>
                  <p className="text-slate-200 text-sm">{task.workshop_comments}</p>
                </div>
              )}
              {task.description && !task.workshop_comments && (
                <div>
                  <p className="text-xs text-muted-foreground font-medium mb-1">Description:</p>
                  <p className="text-slate-200 text-sm">{task.description}</p>
                </div>
              )}
              {task.logged_comment && (
                <div className="bg-blue-500/10 border border-blue-500/30 rounded p-2 mt-2">
                  <p className="text-xs text-blue-400 font-medium mb-1">Progress Note:</p>
                  <p className="text-blue-300 text-sm">{task.logged_comment}</p>
                </div>
              )}
              {task.actioned_comment && (
                <div className="bg-green-500/10 border border-green-500/30 rounded p-2 mt-2">
                  <p className="text-xs text-green-400 font-medium mb-1">Completed Note:</p>
                  <p className="text-green-300 text-sm">{task.actioned_comment}</p>
                </div>
              )}
            </div>
          )}
        </div>
      );
    } else {
      const entry = item.data;
      return (
        <div 
          key={entry.id}
          className="bg-gradient-to-r from-slate-800/50 to-slate-800/30 border border-border/50 rounded-lg p-4 hover:border-slate-600 transition-colors"
        >
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-blue-400" />
              <span className="font-medium text-white">
                {entry.updated_by_name || 'Unknown User'}
              </span>
            </div>
            {showTimestamp && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {getDisplayTimestamp(item.created_at)}
              </div>
            )}
          </div>
          
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Updated</span>
              <Badge variant="outline" className="text-xs">
                {formatFieldName(entry.field_name)}
              </Badge>
            </div>
            
            {entry.field_name !== 'all_fields' && entry.field_name !== 'no_changes' && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground line-through">
                  {formatValue(entry.old_value, entry.value_type)}
                </span>
                <span className="text-muted-foreground">→</span>
                <span className="text-green-400 font-semibold">
                  {formatValue(entry.new_value, entry.value_type)}
                </span>
              </div>
            )}
          </div>
          
          <div className="bg-slate-900/50 rounded p-3 border border-slate-700 mt-2">
            <p className="text-xs text-muted-foreground mb-1">Comment:</p>
            <p className="text-slate-200 text-sm">{entry.comment}</p>
          </div>
        </div>
      );
    }
  };
  
  const getDisplayTimestamp = (dateStr: string): string => {
    if (!dateStr) return 'Unknown date';
    return formatDateTime(dateStr) || 'Invalid date';
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border text-white max-w-3xl max-h-[90vh] md:max-h-[90vh] h-full md:h-auto w-full md:max-w-3xl overflow-y-auto">
        <DialogHeader>
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-3 md:gap-4 md:pr-8">
            <div className="flex-1">
              <DialogTitle className="text-xl md:text-2xl flex items-center gap-2">
                <HistoryIcon className="h-5 w-5 md:h-6 md:w-6" />
                <span className="truncate">Maintenance History - {vehicleReg || (assetType === 'hgv' ? 'HGV' : assetType === 'plant' ? 'Plant' : 'Van')}</span>
              </DialogTitle>
              <DialogDescription className="text-slate-400 text-sm">
                Complete audit trail of all maintenance changes
              </DialogDescription>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <Button
                onClick={() => setMotHistoryOpen(true)}
                className="bg-maintenance hover:bg-maintenance-dark text-white flex-1 md:flex-initial h-12 md:h-10"
                size="sm"
              >
                <FileText className="h-5 w-5 mr-2" />
                <span className="text-sm">MOT</span>
              </Button>
              {onEditClick && (
                <Button
                  onClick={onEditClick}
                  className="bg-red-600 hover:bg-red-700 text-white flex-1 md:flex-initial h-12 md:h-10"
                  size="sm"
                >
                  <Edit className="h-5 w-5 mr-2" />
                  <span className="text-sm">Edit</span>
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        {isLoading ? (
          <PanelLoader message="Loading maintenance history..." accent="maintenance" className="py-12" />
        ) : (
          <div className="space-y-4">
            {/* VES Vehicle Data Section - Show even if no history */}
            {vesData && (vesData.ves_make || vesData.ves_colour || vesData.ves_fuel_type) && (
              <div className="bg-gradient-to-r from-blue-900/20 to-blue-800/10 border border-blue-700/30 rounded-lg p-4">
                <div className="mb-3">
                  <h3 className="text-sm font-medium text-blue-300 uppercase tracking-wide flex items-center gap-2">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Vehicle Data
                  </h3>
                </div>
                
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                  {/* Make - prefer VES, fallback to MOT */}
                  {(vesData.ves_make || vesData.mot_make) && (
                    <div>
                      <span className="text-muted-foreground">Make:</span>
                      <span className="ml-2 text-white font-medium">{vesData.ves_make || vesData.mot_make}</span>
                    </div>
                  )}
                  
                  {/* Model - from MOT API only */}
                  {vesData.mot_model && (
                    <div>
                      <span className="text-muted-foreground">Model:</span>
                      <span className="ml-2 text-white font-medium">{vesData.mot_model}</span>
                    </div>
                  )}
                  
                  {/* Colour - prefer VES, fallback to MOT */}
                  {(vesData.ves_colour || vesData.mot_primary_colour) && (
                    <div>
                      <span className="text-muted-foreground">Colour:</span>
                      <span className="ml-2 text-white font-medium">{vesData.ves_colour || vesData.mot_primary_colour}</span>
                    </div>
                  )}
                  
                  {/* Year - prefer VES, fallback to MOT */}
                  {(vesData.ves_year_of_manufacture || vesData.mot_year_of_manufacture) && (
                    <div>
                      <span className="text-muted-foreground">Year:</span>
                      <span className="ml-2 text-white font-medium">{vesData.ves_year_of_manufacture || vesData.mot_year_of_manufacture}</span>
                    </div>
                  )}
                  
                  {/* Fuel - prefer VES, fallback to MOT */}
                  {(vesData.ves_fuel_type || vesData.mot_fuel_type) && (
                    <div>
                      <span className="text-muted-foreground">Fuel:</span>
                      <span className="ml-2 text-white font-medium">{vesData.ves_fuel_type || vesData.mot_fuel_type}</span>
                    </div>
                  )}
                  
                  {/* First Registration - from MOT API */}
                  {vesData.mot_first_used_date && (
                    <div>
                      <span className="text-muted-foreground">First Reg:</span>
                      <span className="ml-2 text-white font-medium">{formatMaintenanceDate(vesData.mot_first_used_date)}</span>
                    </div>
                  )}
                  
                  {/* Engine - from VES only */}
                  {vesData.ves_engine_capacity && (
                    <div>
                      <span className="text-muted-foreground">Engine:</span>
                      <span className="ml-2 text-white font-medium">{vesData.ves_engine_capacity}cc</span>
                    </div>
                  )}
                  
                  {/* Tax Status - from VES */}
                  {vesData.ves_tax_status && (
                    <div>
                      <span className="text-muted-foreground">Tax Status:</span>
                      <span className="ml-2 text-white font-medium">{vesData.ves_tax_status}</span>
                    </div>
                  )}
                  
                  {/* Tax Due Date */}
                  {vesData.tax_due_date && (
                    <div>
                      <span className="text-muted-foreground">Tax Due:</span>
                      <span className="ml-2 text-white font-medium">{formatMaintenanceDate(vesData.tax_due_date)}</span>
                    </div>
                  )}
                  
                  {/* MOT Status - from VES */}
                  {vesData.ves_mot_status && (
                    <div>
                      <span className="text-muted-foreground">MOT Status:</span>
                      <span className="ml-2 text-white font-medium">{vesData.ves_mot_status}</span>
                    </div>
                  )}
                  
                  {/* MOT Due Date */}
                  {vesData.mot_due_date && (
                    <div>
                      <span className="text-muted-foreground">MOT Due:</span>
                      <span className="ml-2 text-white font-medium">{formatMaintenanceDate(vesData.mot_due_date)}</span>
                    </div>
                  )}
                  
                  {/* CO2 Emissions - from VES */}
                  {vesData.ves_co2_emissions && (
                    <div>
                      <span className="text-muted-foreground">CO2:</span>
                      <span className="ml-2 text-white font-medium">{vesData.ves_co2_emissions}g/km</span>
                    </div>
                  )}
                  
                  {/* Euro Status - from VES */}
                  {vesData.ves_euro_status && (
                    <div>
                      <span className="text-muted-foreground">Euro Status:</span>
                      <span className="ml-2 text-white font-medium">{vesData.ves_euro_status}</span>
                    </div>
                  )}
                  
                  {/* Wheelplan - from VES */}
                  {vesData.ves_wheelplan && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Wheelplan:</span>
                      <span className="ml-2 text-white font-medium">{vesData.ves_wheelplan}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {/* Show "No history" message if no history, but still show DVLA data above */}
            {combinedItems.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <HistoryIcon className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p>No maintenance history yet</p>
                <p className="text-sm mt-1">Changes will appear here when maintenance records or workshop tasks are recorded</p>
              </div>
            ) : (
              <>
                {/* Recent Updates Summary */}
                <div className="space-y-3">
              <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wide">Recent Updates</h3>
              {latestEntries.map((item) => renderHistoryCard(item))}
            </div>

            {/* Expandable Complete History Section */}
            {combinedItems.length > 3 && (
              <div className="border-t border-slate-700 pt-4">
                <button
                  onClick={() => setShowFullHistory(!showFullHistory)}
                  className="w-full flex items-center justify-between p-3 bg-slate-800/30 hover:bg-slate-800/50 rounded-lg border border-border/50 transition-colors"
                >
                  <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wide">
                    {showFullHistory ? 'Hide Older Updates' : `Show More (${initialExpandCount} ${initialExpandCount === 1 ? 'item' : 'items'})`}
                  </h3>
                  {showFullHistory ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
                
                {showFullHistory && (
                  <div className="space-y-4 mt-4">
                    <div className="space-y-3">
                      {/* Skip first 3 entries (already shown in Recent Updates) */}
                      {combinedItems.slice(3, visibleHistoryCount + 3).map((item) => renderHistoryCard(item))}
                    </div>

                    {/* Show More Button */}
                    {hasMoreHistory && (
                      <Button
                        onClick={() => setVisibleHistoryCount(prev => prev + 10)}
                        variant="outline"
                        className="w-full border-border text-muted-foreground hover:bg-slate-800 hover:text-white"
                      >
                        <ChevronDown className="h-4 w-4 mr-2" />
                        Show More ({remainingCount} {remainingCount === 1 ? 'item' : 'items'} remaining)
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
              </>
            )}
          </div>
        )}
      </DialogContent>
      
      {/* MOT History Modal */}
      <MotHistoryDialog
        open={motHistoryOpen}
        onOpenChange={setMotHistoryOpen}
        vehicleReg={vehicleReg || 'Unknown'}
        vehicleId={vehicleId || ''}
        existingMotDueDate={vesData?.mot_due_date || null}
      />
    </Dialog>
  );
}
