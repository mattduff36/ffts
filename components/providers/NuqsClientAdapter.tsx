'use client';

import dynamic from 'next/dynamic';
import { PageLoader } from '@/components/ui/page-loader';
import { templateConfig } from '@/lib/config/template-config';

const NuqsAdapterInner = dynamic(
  () => import('@/components/providers/NuqsAdapterInner').then((mod) => mod.NuqsAdapterInner),
  {
    ssr: false,
    loading: () => <PageLoader message={`Loading ${templateConfig.branding.appName}...`} />,
  }
);

export function NuqsClientAdapter({
  children,
}: {
  children: React.ReactNode;
}) {
  return <NuqsAdapterInner>{children}</NuqsAdapterInner>;
}
