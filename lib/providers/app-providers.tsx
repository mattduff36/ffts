'use client';

import { Analytics } from '@vercel/analytics/react';
import dynamic from 'next/dynamic';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider } from '@/lib/providers/auth-provider';
import { QueryProvider } from '@/lib/providers/query-provider';
import { templateConfig } from '@/lib/config/template-config';

const ErrorLoggerInit = dynamic(
  () => import('@/components/ErrorLoggerInit').then((mod) => mod.ErrorLoggerInit),
  { ssr: false }
);

const DeploymentVersionChecker = dynamic(
  () => import('@/components/DeploymentVersionChecker').then((mod) => mod.DeploymentVersionChecker),
  { ssr: false }
);

interface AppProvidersProps {
  children: React.ReactNode;
  shouldLoadAnalytics: boolean;
}

function hasPublicSupabaseConfig(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

function MissingSupabaseConfigScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12 text-slate-100">
      <section className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-brand-yellow">
          Template setup required
        </p>
        <h1 className="mt-4 text-3xl font-bold">{templateConfig.branding.appName} is not connected yet</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          Add the Supabase project URL and anon key before the app can load authentication,
          data, and demo workflows. This is expected for a fresh template checkout.
        </p>
        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-sm text-slate-200">
          <p>npm run template:setup</p>
          <p>npm run template:validate</p>
          <p>npm run dev</p>
        </div>
        <p className="mt-4 text-xs text-slate-400">
          Required values: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.
          Restart the dev server after updating `.env.local`.
        </p>
      </section>
    </main>
  );
}

export function AppProviders({ children, shouldLoadAnalytics }: AppProvidersProps) {
  if (!hasPublicSupabaseConfig()) {
    return <MissingSupabaseConfigScreen />;
  }

  return (
    <>
      <ErrorLoggerInit />
      <DeploymentVersionChecker />
      <QueryProvider>
        <AuthProvider>
          {children}
          <Toaster />
          {shouldLoadAnalytics ? <Analytics /> : null}
        </AuthProvider>
      </QueryProvider>
    </>
  );
}
