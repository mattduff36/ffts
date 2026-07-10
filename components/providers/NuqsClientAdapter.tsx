'use client';

import dynamic from 'next/dynamic';

const NuqsAdapterInner = dynamic(
  () => import('@/components/providers/NuqsAdapterInner').then((mod) => mod.NuqsAdapterInner),
  {
    ssr: false,
    loading: () => null,
  }
);

export function NuqsClientAdapter({
  children,
}: {
  children: React.ReactNode;
}) {
  return <NuqsAdapterInner>{children}</NuqsAdapterInner>;
}
