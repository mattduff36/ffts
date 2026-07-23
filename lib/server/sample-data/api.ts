import 'server-only';

import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { MANAGED_FIXTURE_KEYS } from './types';

export const sampleDataRequestSchema = z.discriminatedUnion('fixtureKey', [
  z.object({
    fixtureKey: z.enum(MANAGED_FIXTURE_KEYS),
    action: z.enum([
      'create-base',
      'create-queue',
      'create-complete',
      'create',
      'remove',
    ]),
  }),
  z.object({
    fixtureKey: z.literal('all-managed'),
    action: z.literal('clear-all'),
  }),
]);

export const sampleDataMutationSchema = z.intersection(
  sampleDataRequestSchema,
  z.object({
    confirmation: z.string().max(100),
    fingerprint: z.string().min(20).max(2_000),
  })
);

export function originMatchesRequest(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;

  try {
    const originUrl = new URL(origin);
    const host = request.headers.get('host');
    const allowedOrigins = new Set(
      [
        request.nextUrl.origin,
        host ? `${request.nextUrl.protocol}//${host}` : null,
      ].filter((value): value is string => Boolean(value))
    );
    if (allowedOrigins.has(originUrl.origin)) return true;

    const isLoopback = ['localhost', '127.0.0.1'].includes(originUrl.hostname);
    if (!isLoopback) return false;
    return Array.from(allowedOrigins).some((candidate) => {
      const candidateUrl = new URL(candidate);
      return (
        ['localhost', '127.0.0.1'].includes(candidateUrl.hostname)
        && candidateUrl.port === originUrl.port
      );
    });
  } catch {
    return false;
  }
}
