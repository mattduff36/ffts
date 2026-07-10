'use client';

import { useEffect, useMemo, useRef } from 'react';
import { createClient as createSupabaseClient, RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import {
  DISPLAY_BOARD_DEVICE_COMMAND_EVENT,
  type DisplayBoardDeviceCommandPayload,
  getDisplayBoardDeviceChannelName,
} from '@/lib/display-board/device-notify';

type RealtimeCallback<T extends Record<string, unknown> = Record<string, unknown>> = (payload: RealtimePostgresChangesPayload<T>) => void;

export function useRealtimeSubscription(
  table: string,
  event: 'INSERT' | 'UPDATE' | 'DELETE' | '*',
  callback: RealtimeCallback,
  filter?: string,
  enabled = true
) {
  const supabase = useMemo(
    () => (typeof window !== 'undefined' && enabled ? createClient() : null),
    [enabled]
  );
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled || !supabase) return;

    let channel: RealtimeChannel;

    const subscribe = () => {
      const channelBuilder = supabase.channel(`${table}_changes`);
      
      // Type assertion: Supabase RealtimeChannelBuilder has .on() but types may not expose it for postgres_changes
      interface ChannelBuilderWithOn {
        on: (event: 'postgres_changes', opts: { event: string; schema: string; table: string; filter?: string }, callback: (p: RealtimePostgresChangesPayload<Record<string, unknown>>) => void) => { subscribe: () => RealtimeChannel };
      }
      const channelWithListener = (channelBuilder as ChannelBuilderWithOn).on(
        'postgres_changes',
        {
          event,
          schema: 'public',
          table,
          filter,
        },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          callbackRef.current(payload);
        }
      );
      
      channel = channelWithListener.subscribe();
    };

    subscribe();

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [enabled, table, event, filter, supabase]);
}

export function useTimesheetRealtime(callback: RealtimeCallback) {
  useRealtimeSubscription('timesheets', '*', callback);
}

export function useInspectionRealtime(callback: RealtimeCallback) {
  useRealtimeSubscription('van_inspections', '*', callback);
}

export function usePlantInspectionRealtime(callback: RealtimeCallback) {
  useRealtimeSubscription('plant_inspections', '*', callback);
}

export function useAbsenceRealtime(callback: RealtimeCallback, enabled = true) {
  useRealtimeSubscription('absences', '*', callback, undefined, enabled);
}

export function useWorkshopTaskRealtime(callback: RealtimeCallback, enabled = true) {
  useRealtimeSubscription('actions', '*', callback, undefined, enabled);
}

export function usePublicRealtimeSubscription(
  table: string,
  callback: RealtimeCallback,
  enabled = true
) {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) return;

    const client = createSupabaseClient(supabaseUrl, supabaseAnonKey);
    const channel = client
      .channel(`public_${table}_changes`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table,
        },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          callbackRef.current(payload);
        }
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [enabled, table]);
}

export function useWorkshopDisplayBoardRealtime(callback: RealtimeCallback, enabled = true) {
  usePublicRealtimeSubscription('actions', callback, enabled);
  usePublicRealtimeSubscription('vehicle_maintenance', callback, enabled);
  usePublicRealtimeSubscription('asset_maintenance_category_values', callback, enabled);
  usePublicRealtimeSubscription('display_board_devices', callback, enabled);
}

export function useDisplayBoardDeviceBroadcast(
  boardKey: string,
  deviceId: string | undefined,
  onCommand: (command: DisplayBoardDeviceCommandPayload) => void,
  enabled = true
) {
  const onCommandRef = useRef(onCommand);

  useEffect(() => {
    onCommandRef.current = onCommand;
  }, [onCommand]);

  useEffect(() => {
    if (!enabled || !deviceId || typeof window === 'undefined') return;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) return;

    const client = createSupabaseClient(supabaseUrl, supabaseAnonKey);
    const channel = client
      .channel(getDisplayBoardDeviceChannelName(boardKey, deviceId))
      .on('broadcast', { event: DISPLAY_BOARD_DEVICE_COMMAND_EVENT }, ({ payload }) => {
        if (!payload || typeof payload !== 'object' || !('kind' in payload)) return;
        onCommandRef.current(payload as DisplayBoardDeviceCommandPayload);
      })
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [boardKey, deviceId, enabled]);
}

