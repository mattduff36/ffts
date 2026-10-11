'use client';

import { Suspense } from 'react';
import { CalendarCheck } from 'lucide-react';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { PageLoader } from '@/components/ui/page-loader';
import { useAuth } from '@/lib/hooks/useAuth';
import { SchedulingEmployeeView } from '../components/SchedulingEmployeeView';

export default function MySchedulePage() {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader message="Loading your schedule..." />;
  if (!user) return null;

  return (
    <AppPageShell width="wide">
      <AppPageHeader
        title="My Schedule"
        description="Your daily jobs, crew and the details you need on site."
        descriptionClassName="text-[max(1rem,16px)]"
        icon={<CalendarCheck className="h-5 w-5" />}
      />
      <Suspense fallback={<PageLoader message="Loading your schedule..." />}>
        <SchedulingEmployeeView />
      </Suspense>
    </AppPageShell>
  );
}
