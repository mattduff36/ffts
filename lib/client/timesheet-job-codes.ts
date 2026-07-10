'use client';

import { useEffect, useState } from 'react';

export interface TimesheetJobCodeOption {
  value: string;
  label: string;
  customerName: string | null;
  quoteTitle: string | null;
  source: 'live_quote' | 'legacy_quote' | 'project_number' | 'timesheet';
}

interface TimesheetJobCodeResponse {
  job_codes?: TimesheetJobCodeOption[];
  error?: string;
}

let cachedJobCodeOptions: TimesheetJobCodeOption[] | null = null;
let pendingJobCodeOptions: Promise<TimesheetJobCodeOption[]> | null = null;

async function fetchTimesheetJobCodeOptions(): Promise<TimesheetJobCodeOption[]> {
  const response = await fetch('/api/timesheets/job-codes', {
    cache: 'no-store',
  });
  const payload = (await response.json()) as TimesheetJobCodeResponse;

  if (!response.ok) {
    throw new Error(payload.error || 'Unable to load job codes');
  }

  return payload.job_codes || [];
}

function loadTimesheetJobCodeOptions(): Promise<TimesheetJobCodeOption[]> {
  // Always refresh once per mounted consumer so data repairs in Supabase are picked up without a hard browser restart.
  pendingJobCodeOptions ||= fetchTimesheetJobCodeOptions()
    .then((options) => {
      cachedJobCodeOptions = options;
      return options;
    })
    .finally(() => {
      pendingJobCodeOptions = null;
    });

  return pendingJobCodeOptions;
}

export function useTimesheetJobCodeOptions() {
  const [options, setOptions] = useState<TimesheetJobCodeOption[]>(cachedJobCodeOptions || []);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    loadTimesheetJobCodeOptions()
      .then((nextOptions) => {
        if (!isMounted) return;
        setOptions(nextOptions);
        setError(null);
      })
      .catch((fetchError) => {
        if (!isMounted) return;
        setError(fetchError instanceof Error ? fetchError.message : 'Unable to load job codes');
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return { options, isLoading, error };
}
