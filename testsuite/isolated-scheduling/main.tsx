import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NuqsAdapter } from 'nuqs/adapters/react';
import { Toaster } from 'sonner';
import SchedulingPage from '@/app/(dashboard)/scheduling/page';
import { SidebarNav } from '@/components/layout/SidebarNav';
import { useState } from 'react';
import { installReviewFixtures } from './fixture';
import '@/app/globals.css';

if (new URLSearchParams(location.search).has('fixtures')) installReviewFixtures();
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function Preview() {
  const [open, setOpen] = useState(false);
  return <>
    <SidebarNav open={open} onToggle={() => setOpen(value => !value)} />
    <main className="bg-background px-4 pb-8 pt-[100px] text-foreground sm:px-6 md:pl-20 lg:px-8 lg:pl-24">
      <SchedulingPage />
    </main>
    <Toaster />
  </>;
}

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <NuqsAdapter>
      <Preview />
    </NuqsAdapter>
  </QueryClientProvider>
);
