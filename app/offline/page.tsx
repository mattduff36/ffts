import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { templateConfig } from '@/lib/config/template-config';

export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-950 px-4 py-12 text-white">
      <section className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 text-center shadow-xl">
        <h1 className="text-2xl font-bold">You&apos;re offline</h1>
        <p className="mt-3 text-sm text-slate-300">
          {templateConfig.branding.shortAppName} needs a network connection for live operations
          data. Reconnect, then return to the dashboard.
        </p>
        <Button asChild className="mt-6 bg-brand-yellow font-semibold text-slate-950 hover:bg-brand-yellow/90">
          <Link href="/dashboard">Try Dashboard</Link>
        </Button>
      </section>
    </main>
  );
}
