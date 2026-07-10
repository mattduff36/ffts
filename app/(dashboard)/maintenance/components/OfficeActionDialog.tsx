'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Bell, Calendar, RefreshCw, Loader2, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { toast } from 'sonner';

interface OfficeActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleId: string;
  assetType?: 'van' | 'hgv' | 'plant';
  vehicleReg: string;
  vehicleNickname?: string | null;
  alertType: string;
  dueInfo: string; // e.g., "Overdue by 5 days"
  currentDueDate?: string | null;
  onSuccess?: () => void;
}

// Map alert type to category name
const ALERT_TO_CATEGORY: Record<string, string> = {
  'Tax': 'Tax Due Date',
  'MOT': 'MOT Due Date',
  'Service': 'Service Due',
  'Cambelt': 'Cambelt Replacement',
  'First Aid Kit': 'First Aid Kit Expiry',
  'LOLER': 'LOLER Due',
  '6 Weekly Inspection': '6 Weekly Inspection Due',
  'Fire Extinguisher': 'Fire Extinguisher Due',
  'Taco Calibration': 'Taco Calibration Due',
  'Service (Hours)': 'Service Due (Hours)',
};

// Map alert type to field name for date-based API updates
const ALERT_TO_FIELD: Record<string, string> = {
  'Tax': 'tax_due_date',
  'MOT': 'mot_due_date',
  'First Aid Kit': 'first_aid_kit_expiry',
  'LOLER': 'loler_due_date',
  '6 Weekly Inspection': 'six_weekly_inspection_due_date',
  'Fire Extinguisher': 'fire_extinguisher_due_date',
  'Taco Calibration': 'taco_calibration_due_date',
};

export function OfficeActionDialog({
  open,
  onOpenChange,
  vehicleId,
  assetType = 'van',
  vehicleReg,
  vehicleNickname,
  alertType,
  dueInfo,
  currentDueDate,
  onSuccess,
}: OfficeActionDialogProps) {
  const [activeTab, setActiveTab] = useState<'reminder' | 'update' | 'refresh'>('reminder');
  const [loading, setLoading] = useState(false);
  
  // Form states
  const [newDueDate, setNewDueDate] = useState(currentDueDate || '');
  const [updateComment, setUpdateComment] = useState('');
  
  const categoryName = ALERT_TO_CATEGORY[alertType] || alertType;
  const fieldName = ALERT_TO_FIELD[alertType];
  const vehicleDisplay = vehicleNickname ? `${vehicleReg} (${vehicleNickname})` : vehicleReg;
  const isDateBased = Boolean(fieldName); // Tax, MOT, First Aid are date-based
  
  const handleSendReminder = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/maintenance/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleId,
          categoryName,
          dueInfo,
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to send reminder');
      }
      
      const parts = [];
      if (data.message) {
        parts.push(`${data.message.recipients_count} in-app notification(s)`);
      }
      if (data.emails) {
        parts.push(`${data.emails.sent} email(s) sent`);
        if (data.emails.failed > 0) {
          parts.push(`${data.emails.failed} email(s) failed`);
        }
      }
      
      toast.success('Reminder sent', {
        description: parts.join(', ') || 'Reminder sent successfully',
      });
      
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      console.error('Error sending reminder:', error);
      toast.error('Failed to send reminder', {
        description: error instanceof Error ? error.message : 'Please try again',
      });
    } finally {
      setLoading(false);
    }
  };
  
  const handleUpdateDueDate = async () => {
    if (!isDateBased) {
      toast.error('This category does not support date updates');
      return;
    }
    
    if (!newDueDate) {
      toast.error('Please enter a new due date');
      return;
    }
    
    if (!updateComment || updateComment.trim().length < 10) {
      toast.error('Please enter a comment (minimum 10 characters)');
      return;
    }
    
    setLoading(true);
    try {
      const response = await fetch(`/api/maintenance/by-vehicle/${vehicleId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          [fieldName]: newDueDate,
          comment: updateComment.trim(),
          assetType,
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update due date');
      }
      
      toast.success('Due date updated', {
        description: `${categoryName} updated to ${new Date(newDueDate).toLocaleDateString()}`,
      });
      
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      console.error('Error updating due date:', error);
      toast.error('Failed to update due date', {
        description: error instanceof Error ? error.message : 'Please try again',
      });
    } finally {
      setLoading(false);
    }
  };
  
  const handleRefreshDVLA = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/maintenance/sync-dvla', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetId: vehicleId,
          assetType,
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to sync with DVLA');
      }
      
      if (data.results && data.results[0]) {
        const result = data.results[0];
        if (result.error) {
          toast.warning('Partial sync', {
            description: result.error,
          });
        } else {
          const fieldsUpdated = result.fields_updated || [];
          toast.success('DVLA sync complete', {
            description: fieldsUpdated.length > 0 
              ? `Updated: ${fieldsUpdated.join(', ')}`
              : 'No changes detected',
          });
        }
      } else {
        toast.success('DVLA sync complete');
      }
      
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      console.error('Error syncing with DVLA:', error);
      toast.error('Failed to sync with DVLA', {
        description: error instanceof Error ? error.message : 'Please try again',
      });
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] overflow-y-auto bg-white dark:bg-slate-900 border-border text-foreground max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-foreground text-xl flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Office Action Required
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {vehicleDisplay} - {categoryName}: {dueInfo}
          </DialogDescription>
        </DialogHeader>
        
        {/* Tab Buttons */}
        <div className="flex gap-2 border-b border-border pb-4">
          <Button
            variant={activeTab === 'reminder' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveTab('reminder')}
            className={activeTab === 'reminder' 
              ? 'bg-maintenance hover:bg-maintenance-dark text-white' 
              : 'border-border'}
          >
            <Bell className="h-4 w-4 mr-1" />
            Send Reminder
          </Button>
          {isDateBased && (
            <Button
              variant={activeTab === 'update' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveTab('update')}
              className={activeTab === 'update' 
                ? 'bg-green-600 hover:bg-green-700 text-white' 
                : 'border-border'}
            >
              <Calendar className="h-4 w-4 mr-1" />
              Update Date
            </Button>
          )}
          {(alertType === 'Tax' || alertType === 'MOT') && (
            <Button
              variant={activeTab === 'refresh' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveTab('refresh')}
              className={activeTab === 'refresh' 
                ? 'bg-purple-600 hover:bg-purple-700 text-white' 
                : 'border-border'}
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              Refresh DVLA
            </Button>
          )}
        </div>
        
        {/* Tab Content */}
        <div className="py-4 min-h-[200px]">
          {activeTab === 'reminder' && (
            <div className="space-y-4">
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  This will send a reminder to users configured to receive notifications for {categoryName}. 
                  If no recipients are configured, it will notify all managers.
                </AlertDescription>
              </Alert>
              
              <div className="bg-slate-100 dark:bg-slate-800 rounded-lg p-4">
                <p className="text-sm text-muted-foreground mb-2">Reminder will include:</p>
                <ul className="text-sm space-y-1">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                    <span>Van: {vehicleDisplay}</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                    <span>Category: {categoryName}</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                    <span>Status: {dueInfo}</span>
                  </li>
                </ul>
              </div>
              
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={loading}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSendReminder}
                  disabled={loading}
                  className="bg-maintenance hover:bg-maintenance-dark text-white"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Bell className="h-4 w-4 mr-2" />
                      Send Reminder
                    </>
                  )}
                </Button>
              </DialogFooter>
            </div>
          )}
          
          {activeTab === 'update' && isDateBased && (
            <div className="space-y-4">
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  Update the due date after completing the required action (e.g., renewing tax). 
                  This requires a comment explaining what was done.
                </AlertDescription>
              </Alert>
              
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="newDueDate">New Due Date</Label>
                  <Input
                    id="newDueDate"
                    type="date"
                    value={newDueDate}
                    onChange={(e) => setNewDueDate(e.target.value)}
                    className="bg-white dark:bg-slate-800 border-border dark:text-slate-100 text-slate-900"
                  />
                  {currentDueDate && (
                    <p className="text-xs text-muted-foreground">
                      Current: {new Date(currentDueDate).toLocaleDateString()}
                    </p>
                  )}
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="updateComment">
                    Comment (required, min 10 characters)
                  </Label>
                  <Textarea
                    id="updateComment"
                    value={updateComment}
                    onChange={(e) => setUpdateComment(e.target.value)}
                    placeholder="e.g., Tax renewed online via GOV.UK, confirmation received"
                    rows={3}
                    className="bg-white dark:bg-slate-800 border-border dark:text-slate-100 text-slate-900"
                  />
                  <p className="text-xs text-muted-foreground">
                    {updateComment.length}/10 characters minimum
                  </p>
                </div>
              </div>
              
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={loading}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleUpdateDueDate}
                  disabled={loading || !newDueDate || updateComment.trim().length < 10}
                  className="bg-green-600 hover:bg-green-700 text-white"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    <>
                      <Calendar className="h-4 w-4 mr-2" />
                      Update Due Date
                    </>
                  )}
                </Button>
              </DialogFooter>
            </div>
          )}
          
          {activeTab === 'refresh' && (
            <div className="space-y-4">
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  Sync this vehicle&apos;s data with DVLA to get the latest Tax and MOT dates. 
                  This is useful after renewing tax online, as DVLA updates their systems automatically.
                </AlertDescription>
              </Alert>
              
              <div className="bg-slate-100 dark:bg-slate-800 rounded-lg p-4">
                <p className="text-sm text-muted-foreground mb-2">This will refresh:</p>
                <ul className="text-sm space-y-1">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                    <span>Tax Due Date (from DVLA VES API)</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                    <span>MOT Due Date (from MOT History API)</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                    <span>Van Details (make, colour, etc.)</span>
                  </li>
                </ul>
              </div>
              
              <p className="text-sm text-amber-600 dark:text-amber-400">
                Note: DVLA data may take 24-48 hours to update after online renewal.
              </p>
              
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={loading}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleRefreshDVLA}
                  disabled={loading}
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Syncing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Refresh from DVLA
                    </>
                  )}
                </Button>
              </DialogFooter>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
