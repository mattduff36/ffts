'use client';

import { useSyncExternalStore } from 'react';
import {
  getDatabaseHealthState,
  subscribeToDatabaseHealth,
} from '@/lib/database/client-health';

export function useDatabaseHealthOutage() {
  return useSyncExternalStore(
    subscribeToDatabaseHealth,
    getDatabaseHealthState,
    getDatabaseHealthState
  );
}
