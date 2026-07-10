'use client';

import { useState, useEffect, useCallback } from 'react';
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
import { formatMileage } from '@/lib/utils/maintenanceCalculations';
import { 
  FileText, 
  CheckCircle, 
  XCircle, 
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Gauge,
  MapPin
} from 'lucide-react';

interface MotHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleReg: string;
  vehicleId: string;
  existingMotDueDate?: string | null;
}

export function MotHistoryDialog({ open, onOpenChange, vehicleReg, vehicleId, existingMotDueDate }: MotHistoryDialogProps) {
  const [expandedTestId, setExpandedTestId] = useState<string | null>(null);
  interface MotData {
  tests?: Array<{ result?: string; expiryDate?: string | null; [key: string]: unknown }>;
  defects?: Array<{ type?: string; [key: string]: unknown }>;
  currentStatus?: { status?: string; expiryDate?: string | null; daysRemaining?: number; lastTestDate?: string | null };
  firstUsedDate?: string | null;
  [key: string]: unknown;
}
const [motData, setMotData] = useState<MotData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vehicleNotFound, setVehicleNotFound] = useState(false);
  
  const fetchMotHistoryFromDB = useCallback(async () => {
    setLoading(true);
    setError(null);
    setVehicleNotFound(false);
    
    try {
      const response = await fetch(`/api/maintenance/mot-history/${vehicleId}`);
      const result = await response.json();
      
      if (!response.ok) {
        setVehicleNotFound(result.vehicleNotFound || false);
        throw new Error(result.message || result.error || 'Failed to fetch MOT history');
      }
      
      if (result.success && result.data) {
        setMotData(result.data);
      } else {
        setVehicleNotFound(result.vehicleNotFound || false);
        setError(result.message || 'No MOT history available');
      }
    } catch (err: unknown) {
      console.error('Error fetching MOT history:', err);
      setError(err instanceof Error ? err.message : 'Failed to load MOT history');
    } finally {
      setLoading(false);
    }
  }, [vehicleId]);

  // Fetch MOT history from database when dialog opens (no API call)
  useEffect(() => {
    if (open && vehicleId) {
      fetchMotHistoryFromDB();
    }
  }, [open, vehicleId, fetchMotHistoryFromDB]);
  
  const getDefectColor = (type: string) => {
    switch (type) {
      case 'DANGEROUS': return 'text-red-400 bg-red-500/10 border-red-500/30';
      case 'MAJOR': return 'text-orange-400 bg-orange-500/10 border-orange-500/30';
      case 'MINOR': return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30';
      case 'ADVISORY': return 'text-blue-400 bg-blue-500/10 border-blue-500/30';
      case 'FAIL': return 'text-red-600 bg-red-600/10 border-red-600/30';
      default: return 'text-slate-400 bg-slate-500/10 border-slate-500/30';
    }
  };
  
  const getDefectIcon = (type: string) => {
    switch (type) {
      case 'DANGEROUS': return '🔴';
      case 'MAJOR': return '🟠';
      case 'MINOR': return '🟡';
      case 'ADVISORY': return '🔵';
      case 'FAIL': return '⚫';
      default: return '⚪';
    }
  };
  
  const countDefectsByType = (defects: { type?: string }[]) => {
    const counts: Record<string, number> = {};
    defects.forEach(defect => {
      const key = defect.type ?? 'unknown';
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  };
  
  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return 'Not Set';
    return new Date(dateString).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border text-white w-full max-w-full md:max-w-[80vw] h-full md:h-auto max-h-dvh md:max-h-[90dvh] overflow-y-auto p-4 md:p-6">
        <DialogHeader>
          <div className="flex items-start justify-between gap-4 pr-6 md:pr-8">
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-xl md:text-2xl flex items-center gap-2">
                <FileText className="h-5 w-5 md:h-6 md:w-6" />
                <span className="truncate">MOT History - {vehicleReg}</span>
              </DialogTitle>
              <DialogDescription className="text-slate-400 text-sm">
                Complete MOT test history from GOV.UK database
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {loading ? (
          <PanelLoader message="Loading MOT history from GOV.UK..." accent="maintenance" className="py-12" />
        ) : error ? (
          <div className="text-center py-12 text-muted-foreground">
            {vehicleNotFound ? (
              <>
                <AlertTriangle className="h-12 w-12 mx-auto mb-3 text-amber-400 opacity-70" />
                <p className="text-lg font-medium text-white mb-2">Van Not Found</p>
                <p className="text-sm mb-4">{error}</p>
                <div className="bg-amber-900/20 border border-amber-700 rounded-lg p-4 max-w-md mx-auto">
                  <p className="text-sm text-amber-300">
                    The registration <span className="font-semibold text-white">{vehicleReg}</span> was not found in the DVLA database.
                  </p>
                  <p className="text-xs text-amber-400 mt-2">
                    This may be a test van, an invalid registration, or a van not yet registered with DVLA.
                  </p>
                </div>
              </>
            ) : error.includes('No MOT data found') || error.includes('No MOT history') ? (
              <>
                <FileText className="h-12 w-12 mx-auto mb-3 text-blue-400 opacity-50" />
                <p className="text-lg font-medium text-white mb-2">No MOT History Yet</p>
                <p className="text-sm mb-4">{error}</p>
                {existingMotDueDate && !vehicleNotFound && (
                  <div className="bg-blue-900/20 border border-blue-700 rounded-lg p-4 max-w-md mx-auto">
                    <p className="text-sm text-blue-300">
                      This van is likely less than 3 years old and hasn&apos;t required an MOT yet.
                    </p>
                    <p className="text-sm text-white font-medium mt-2">
                      First MOT due: <span className="text-blue-400">{new Date(existingMotDueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                    </p>
                  </div>
                )}
              </>
            ) : (
              <>
                <AlertTriangle className="h-12 w-12 mx-auto mb-3 text-yellow-400 opacity-50" />
                <p className="text-lg font-medium text-white mb-2">Unable to Load MOT History</p>
                <p className="text-sm">{error}</p>
                <Button 
                  onClick={fetchMotHistoryFromDB}
                  variant="outline"
                  className="mt-4 border-slate-600 text-white hover:bg-slate-800"
                >
                  Try Again
                </Button>
              </>
            )}
          </div>
        ) : !motData ? (
          <div className="text-center py-12 text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p>No MOT history available</p>
            <p className="text-sm mt-1">This van may be too new or exempt from MOT testing</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Current MOT Status Card */}
            {motData.currentStatus?.status === 'No MOT History' || motData.currentStatus?.status === 'Not Yet Due' || (motData.tests?.length ?? 0) === 0 ? (
              // Special card for vans with no MOT history (too new)
              <div className="bg-gradient-to-r from-slate-800/50 to-slate-700/30 border border-border/50 rounded-lg p-4 md:p-6">
                <div className="text-center py-4">
                  <AlertTriangle className="h-12 w-12 md:h-16 md:w-16 mx-auto mb-4 text-blue-400 opacity-60" />
                  <h3 className="text-lg md:text-xl font-semibold text-white mb-2">No MOT History</h3>
                  <p className="text-slate-400 mb-4">
                    This van is too new to have any MOT tests recorded.
                  </p>
                  <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 max-w-md mx-auto">
                    <p className="text-sm text-muted-foreground mb-2">
                      <strong className="text-white">First MOT Due:</strong>
                    </p>
                    {existingMotDueDate ? (
                      <>
                        <p className="text-2xl font-bold text-blue-400 mb-3">
                          {formatDate(existingMotDueDate)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {motData.firstUsedDate ? 
                            'New vans are exempt from MOT testing for the first 3 years' :
                            'MOT due date from vehicle records'
                          }
                        </p>
                      </>
                    ) : motData.currentStatus?.expiryDate ? (
                      <>
                        <p className="text-2xl font-bold text-blue-400 mb-3">
                          {formatDate(motData.currentStatus?.expiryDate ?? null)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          From GOV.UK MOT database
                        </p>
                      </>
                    ) : motData.firstUsedDate ? (
                      <>
                        <p className="text-2xl font-bold text-blue-400 mb-3">
                          {(() => {
                            // Calculate 3 years from first registration date
                            const firstUsed = new Date(motData.firstUsedDate);
                            const motDue = new Date(firstUsed);
                            motDue.setFullYear(firstUsed.getFullYear() + 3);
                            return formatDate(motDue.toISOString());
                          })()}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Calculated: 3 years from first registration
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-xl text-slate-400 mb-3">
                          Date not available
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Van registration date not found in database
                        </p>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              // Normal card for vans with MOT history
              <div className="bg-gradient-to-r from-blue-900/30 to-blue-800/20 border border-blue-700/50 rounded-lg p-3 md:p-4">
                <h3 className="text-base md:text-lg font-semibold text-blue-300 mb-3 flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 md:h-5 md:w-5" />
                  Current MOT Status
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Expiry Date:</span>
                    <p className="text-white font-semibold text-lg">{formatDate(motData.currentStatus?.expiryDate)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Status:</span>
                    <p className={`font-semibold text-lg ${motData.currentStatus?.status === 'Valid' ? 'text-green-400' : 'text-red-400'}`}>
                      {motData.currentStatus?.status}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Days Remaining:</span>
                    <p className="text-white font-semibold text-lg">{motData.currentStatus?.daysRemaining}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Last Test:</span>
                    <p className="text-white font-semibold text-lg">{formatDate(motData.currentStatus?.lastTestDate)}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Test History */}
            {motData.tests && motData.tests.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wide">Test History</h3>
                
                {motData.tests.map((test: { result?: string; expiryDate?: string | null; motTestNumber?: string; completedDate?: string; odometerValue?: number | string | null; odometerUnit?: string | null; testStationName?: string | null; testStationPcode?: string | null; defects?: { type?: string; text?: string; locationLateral?: string }[]; [key: string]: unknown }, idx: number) => {
                const defects = Array.isArray(test.defects) ? test.defects as { type?: string; text?: string; locationLateral?: string }[] : [];
                const defectCounts = countDefectsByType(defects);
                const isExpanded = expandedTestId === test.motTestNumber;
                const testResultUpper = String(test.testResult ?? '').toUpperCase();
                const isPassed = testResultUpper === 'PASSED' || testResultUpper === 'PASS' || testResultUpper === 'PRS';
                
                return (
                  <div 
                    key={test.motTestNumber ?? idx}
                    className={`border rounded-lg p-3 md:p-4 ${
                      isPassed 
                        ? 'bg-gradient-to-r from-green-900/20 to-green-800/10 border-green-700/30' 
                        : 'bg-gradient-to-r from-red-900/20 to-red-800/10 border-red-700/30'
                    }`}
                  >
                    {/* Test Header */}
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-2 md:gap-3 mb-3">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        {isPassed ? (
                          <CheckCircle className="h-6 w-6 text-green-400 flex-shrink-0" />
                        ) : (
                          <XCircle className="h-6 w-6 text-red-400 flex-shrink-0" />
                        )}
                        <div className="min-w-0">
                          <h4 className="text-lg font-semibold text-white flex items-center gap-2">
                            {String(test.testResult ?? '')}
                            <span className="text-sm text-slate-400 font-normal">
                              {formatDate(test.completedDate)}
                            </span>
                          </h4>
                          {test.expiryDate && (
                            <p className="text-sm text-muted-foreground">
                              Expiry: <span className="text-white font-medium">{formatDate(test.expiryDate)}</span>
                            </p>
                          )}
                        </div>
                      </div>
                      
                      {/* Defect Summary Badges - Top Right on Desktop */}
                      {defects.length > 0 && (
                        <div className="flex items-center gap-2 flex-wrap md:justify-end">
                          {Object.entries(defectCounts).map(([type, count]) => (
                            <Badge key={type} className={`${getDefectColor(type)} border text-xs`}>
                              {count} {type}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Test Details Grid */}
                    <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-6 text-sm mb-3">
                      <div className="flex items-center gap-2">
                        <Gauge className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground">Mileage:</span>
                        <span className="text-white font-medium">
                          {test.odometerValue === null || test.odometerValue === undefined
                            ? 'Not Set'
                            : `${formatMileage(typeof test.odometerValue === 'number' ? test.odometerValue : Number(test.odometerValue) || 0)} ${test.odometerUnit || ''}`.trim()}
                        </span>
                      </div>
                      {(test.testStationName || test.testStationPcode) && (
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-muted-foreground" />
                          <span className="text-muted-foreground">Station:</span>
                          <span className="text-white font-medium">
                            {[test.testStationName, test.testStationPcode].filter(Boolean).join(', ')}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">Test Number:</span>
                        <span className="text-white font-medium">{test.motTestNumber}</span>
                      </div>
                    </div>

                    {/* Expandable Defects */}
                    {defects.length > 0 && (
                      <div className="space-y-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setExpandedTestId(isExpanded ? null : (test.motTestNumber ?? null))}
                          className="w-full text-blue-400 hover:text-blue-300 hover:bg-slate-800"
                        >
                          {isExpanded ? (
                            <>
                              <ChevronUp className="h-4 w-4 mr-2" />
                              Hide Defects
                            </>
                          ) : (
                            <>
                              <ChevronDown className="h-4 w-4 mr-2" />
                              View {defects.length} Defect{defects.length !== 1 ? 's' : ''}
                            </>
                          )}
                        </Button>

                        {isExpanded && (
                          <div className="mt-3 space-y-2 border-t border-slate-700 pt-3">
                            {defects.map((defect: { type?: string; [key: string]: unknown }, idx: number) => (
                              <div 
                                key={idx}
                                className={`p-3 rounded border ${getDefectColor(defect.type ?? '')}`}
                              >
                                <div className="flex items-start gap-2">
                                  <span className="text-lg">{getDefectIcon(defect.type ?? '')}</span>
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                      <Badge className={`${getDefectColor(defect.type ?? '')} border text-xs`}>
                                        {defect.type ?? 'Unknown'}
                                      </Badge>
                                      {defect.locationLateral != null && defect.locationLateral !== '' ? (
                                        <span className="text-xs text-muted-foreground">
                                          {String(defect.locationLateral)}
                                        </span>
                                      ) : null}
                                    </div>
                                    <p className="text-sm text-white">{defect.text != null ? String(defect.text) : ''}</p>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {defects.length === 0 && (
                      <div className="flex items-center gap-2 text-sm text-green-400">
                        <CheckCircle className="h-4 w-4" />
                        No defects or advisories recorded
                      </div>
                    )}
                  </div>
                );
              })}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

