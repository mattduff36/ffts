'use client';

import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Info, Calendar, Filter, Archive } from 'lucide-react';

type AbsenceAboutHelperVariant = 'manage' | 'archive-report';

interface AbsenceAboutHelperProps {
  variant: AbsenceAboutHelperVariant;
}

export function AbsenceAboutHelper({ variant }: AbsenceAboutHelperProps) {
  return (
    <Card className="bg-green-50 dark:bg-green-900/20 border-blue-200 dark:border-blue-800">
      <CardContent className="pt-6">
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-800 dark:text-blue-200">
            {variant === 'manage' ? (
              <>
                <p className="font-semibold mb-2">About Absence Management</p>
                <p>
                  Use <span className="font-medium">Records</span> to review and manage entries, and{' '}
                  <span className="font-medium">Calendar</span> for a timeline view across employees.
                </p>
                <div className="mt-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <Calendar className="h-4 w-4 mt-0.5 text-blue-600 dark:text-blue-300" />
                    <p>
                      <span className="font-medium">Reasons / Allowances:</span> configure leave types and annual
                      allowances from the top tabs.
                    </p>
                  </div>
                  <div className="flex items-start gap-2">
                    <Archive className="h-4 w-4 mt-0.5 text-blue-600 dark:text-blue-300" />
                    <p>
                      <span className="font-medium">Include archived:</span> adds closed financial-year records to
                      results. Archived data is read-only.
                    </p>
                  </div>
                </div>
                <p className="mt-4 text-xs text-blue-600 dark:text-blue-400">
                  <strong>Tip:</strong> Open the{' '}
                  <Link href="/absence/archive-report" className="font-medium underline underline-offset-2">
                    archive report
                  </Link>{' '}
                  for focused historical analysis.
                </p>
              </>
            ) : (
              <>
                <p className="font-semibold mb-2">About Absence Archive Report</p>
                <p>
                  This page shows read-only historical absences from closed financial years. Use it for audits and
                  trend reviews without affecting active workflows.
                </p>
                <div className="mt-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <Filter className="h-4 w-4 mt-0.5 text-blue-600 dark:text-blue-300" />
                    <p>
                      <span className="font-medium">Filters:</span> narrow data by financial year, employee, reason,
                      status, and date range.
                    </p>
                  </div>
                  <div className="flex items-start gap-2">
                    <Archive className="h-4 w-4 mt-0.5 text-blue-600 dark:text-blue-300" />
                    <p>
                      <span className="font-medium">Read-only:</span> archived records cannot be edited or approved in
                      this view.
                    </p>
                  </div>
                </div>
                <p className="mt-4 text-xs text-blue-600 dark:text-blue-400">
                  <strong>Tip:</strong> Go back to{' '}
                  <Link href="/absence/manage?tab=overview" className="font-medium underline underline-offset-2">
                    manage records
                  </Link>{' '}
                  for current-day operational actions.
                </p>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
