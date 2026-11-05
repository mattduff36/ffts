import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NuqsAdapter } from 'nuqs/adapters/react';
import { Toaster } from 'sonner';
import { SchedulingManagerBoard } from '@/app/(dashboard)/scheduling/components/SchedulingManagerBoard';
import { AppPageShell } from '@/components/layout/AppPageShell';
import { installReviewFixtures } from './fixture';
import '@/app/globals.css';

if (new URLSearchParams(location.search).has('fixtures')) installReviewFixtures();
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <NuqsAdapter>
      <main className="bg-background px-4 pb-8 pt-[100px] text-foreground sm:px-6 md:pl-20 lg:px-8 lg:pl-24">
        <AppPageShell width="full" className="flex h-[calc(100dvh-132px)] min-h-0 flex-col overflow-hidden space-y-0">
          <SchedulingManagerBoard userId="33333333-3333-4333-8333-333333333333" />
        </AppPageShell>
      </main>
      <Toaster />
    </NuqsAdapter>
  </QueryClientProvider>
);
