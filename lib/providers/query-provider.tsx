'use client';

import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { useSoftRefresh } from '@/lib/hooks/useSoftRefresh';
import { isSoftRefreshPaused } from '@/lib/client/soft-refresh';
import { handleAuthFailureStatus } from '@/lib/app-auth/recovery-bridge';
import { markDatabaseBackedSuccess, nudgeDatabaseHealthCheck } from '@/lib/database/client-health';
import { getErrorStatus, isAuthErrorStatus, isServerErrorStatus } from '@/lib/utils/http-error';

const ReactQueryDevtools = dynamic(
  () => import('@tanstack/react-query-devtools').then((mod) => ({ default: mod.ReactQueryDevtools })),
  { ssr: false }
);

function ActiveQueryRefresh({ client }: { client: QueryClient }) {
  useSoftRefresh(async () => {
    if (client.isMutating() > 0) return;
    await client.refetchQueries({ type: 'active', predicate: (query) => query.state.fetchStatus === 'idle' }, { cancelRefetch: false });
  });
  return null;
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () => {
      const handledQueryErrorCounts = new Map<string, number>();

      const queryCache = new QueryCache({
        onSuccess: () => {
          markDatabaseBackedSuccess();
        },
        onError: (error, query) => {
          const statusCode = getErrorStatus(error);
          if (isServerErrorStatus(statusCode)) {
            nudgeDatabaseHealthCheck();
          }

          if (!isAuthErrorStatus(statusCode)) {
            return;
          }

          const handledErrorCount = handledQueryErrorCounts.get(query.queryHash);
          const currentErrorCount = query.state.errorUpdateCount;
          if (handledErrorCount === currentErrorCount) {
            return;
          }

          handledQueryErrorCounts.set(query.queryHash, currentErrorCount);
          void handleAuthFailureStatus(statusCode).then((recovered) => {
            if (recovered) {
              void client.refetchQueries({
                queryKey: query.queryKey,
                exact: true,
                type: 'active',
              });
            }
          });
        },
      });

      const mutationCache = new MutationCache({
        onSuccess: () => {
          markDatabaseBackedSuccess();
        },
        onError: (error) => {
          const statusCode = getErrorStatus(error);
          if (isServerErrorStatus(statusCode)) {
            nudgeDatabaseHealthCheck();
          }

          if (!isAuthErrorStatus(statusCode)) {
            return;
          }

          void handleAuthFailureStatus(statusCode);
        },
      });

      const client = new QueryClient({
        queryCache,
        mutationCache,
        defaultOptions: {
          queries: {
            // With SSR, we usually want to set some default staleTime
            // above 0 to avoid refetching immediately on the client
            staleTime: 60 * 1000, // 1 minute
            gcTime: 5 * 60 * 1000, // 5 minutes (formerly cacheTime)
            refetchOnWindowFocus: () => isSoftRefreshPaused() ? false : 'always',
            refetchOnReconnect: () => isSoftRefreshPaused() ? false : 'always',
            retry: 1,
          },
          mutations: {
            retry: false,
          },
        },
      });

      return client;
    }
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ActiveQueryRefresh client={queryClient} />
      {children}
      {process.env.NODE_ENV === 'development' ? <ReactQueryDevtools initialIsOpen={false} /> : null}
    </QueryClientProvider>
  );
}

