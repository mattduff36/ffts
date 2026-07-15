'use client';

import { CalendarCheck } from 'lucide-react';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { PageLoader } from '@/components/ui/page-loader';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { SchedulingEmployeeView } from '../components/SchedulingEmployeeView';

export default function MySchedulePage() {
  const { hasPermission, loading } = usePermissionCheck('scheduling');
  if (loading) return <PageLoader message="Loading your schedule..." />;
  if (!hasPermission) return null;

  return (
    <AppPageShell width="wide">
      <AppPageHeader
        title="My Schedule"
        description="Your assigned jobs and plant for the selected week."
        icon={<CalendarCheck className="h-5 w-5" />}
      />
      <SchedulingEmployeeView />
    </AppPageShell>
  );
}
