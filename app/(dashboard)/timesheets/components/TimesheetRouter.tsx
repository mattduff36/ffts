'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { PanelLoader } from '@/components/ui/panel-loader';
import { useTimesheetType } from '../hooks/useTimesheetType';
import { TimesheetRegistry, isTimesheetTypeImplemented, getTimesheetTypeLabel, type TimesheetType } from '../types/registry';
import { PlantTimesheetV2 } from '../types/plant/PlantTimesheetV2Aligned';
import { PlantTimesheet } from '../types/plant/PlantTimesheet';
import { resolveTimesheetRenderVariant } from './timesheet-routing';

/**
 * TimesheetRouter Component
 * 
 * Phase 5: Dynamic Routing
 * Routes users to the correct timesheet component based on their role.
 * Falls back to Standard timesheet if type not implemented (Q11: Answer B).
 */

interface TimesheetRouterProps {
  weekEnding: string;
  existingId: string | null;
  userId: string;
  onSelectedEmployeeChange?: (employeeId: string) => void;
  existingTimesheetType?: string | null;
  existingTemplateVersion?: number | null;
  selectedTimesheetType?: TimesheetType | null;
}

export function TimesheetRouter({
  weekEnding,
  existingId,
  userId,
  onSelectedEmployeeChange,
  existingTimesheetType = null,
  existingTemplateVersion = null,
  selectedTimesheetType = null,
}: TimesheetRouterProps) {
  const { timesheetType, mode, loading, error } = useTimesheetType(userId);
  const resolvedType = !existingId && selectedTimesheetType ? selectedTimesheetType : timesheetType;

  // Loading state
  if (loading) {
    return <PanelLoader message="Loading timesheet..." accent="timesheet" className="min-h-[400px]" />;
  }

  // Error state (should rarely happen - hook falls back to default)
  if (error) {
    console.warn('Timesheet routing warning:', error);
  }

  if (!existingId && mode === 'choice' && !selectedTimesheetType) {
    return <PanelLoader message="Waiting for timesheet type selection..." accent="timesheet" className="min-h-[240px]" />;
  }

  // New plant timesheets must always use v2.
  // Existing records are handled by template-version routing below.
  if (!existingId && resolvedType === 'plant') {
    return (
      <PlantTimesheetV2
        weekEnding={weekEnding}
        existingId={existingId}
        userId={userId}
        onSelectedEmployeeChange={onSelectedEmployeeChange}
      />
    );
  }

  const routing = resolveTimesheetRenderVariant({
    existingId,
    existingTimesheetType,
    existingTemplateVersion,
    resolvedType,
  });

  if (routing.variant === 'plant-v2') {
    return (
      <PlantTimesheetV2
        weekEnding={weekEnding}
        existingId={existingId}
        userId={userId}
        onSelectedEmployeeChange={onSelectedEmployeeChange}
      />
    );
  }

  if (routing.variant === 'plant-legacy') {
    return (
      <PlantTimesheet
        weekEnding={weekEnding}
        existingId={existingId}
        userId={userId}
        onSelectedEmployeeChange={onSelectedEmployeeChange}
      />
    );
  }

  // Get the timesheet component from registry
  const TimesheetComponent = routing.type ? TimesheetRegistry[routing.type] : null;

  // Timesheet type not implemented (Q11: fallback to standard type with warning)
  if (!TimesheetComponent || !isTimesheetTypeImplemented(routing.type || '')) {
    const attemptedType = routing.type || 'unknown';
    const attemptedLabel = getTimesheetTypeLabel(attemptedType);
    
    // Fall back to standard timesheet type (internal key: civils)
    const CivilsTimesheet = TimesheetRegistry['civils'];
    
    return (
      <div className="space-y-4 w-full max-w-[1400px] mx-auto">
        {/* Warning Banner */}
        <Alert className="bg-amber-500/10 border-amber-500/50">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          <AlertDescription className="text-amber-600 dark:text-amber-400">
            <p className="font-semibold mb-2">Timesheet Type Not Available</p>
            <p className="text-sm mb-3">
              Your role is configured to use <span className="font-semibold">{attemptedLabel}</span>, 
              but this timesheet type is not yet available. You&apos;ve been given the Standard Timesheet instead.
            </p>
            <p className="text-sm">
              Please contact your administrator if you believe this is incorrect.
            </p>
          </AlertDescription>
        </Alert>

        {/* Show standard timesheet as fallback */}
        {CivilsTimesheet ? (
          <CivilsTimesheet
            weekEnding={weekEnding}
            existingId={existingId}
            userId={userId}
            onSelectedEmployeeChange={onSelectedEmployeeChange}
          />
        ) : (
          <Card className="">
            <CardHeader>
              <CardTitle className="text-red-500">System Error</CardTitle>
              <CardDescription>
                No timesheet components are available. Please contact your administrator.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/timesheets">
                <Button variant="outline">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Timesheets
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // Success: Render the correct timesheet component
  return (
    <TimesheetComponent
      weekEnding={weekEnding}
      existingId={existingId}
      userId={userId}
      onSelectedEmployeeChange={onSelectedEmployeeChange}
    />
  );
}
