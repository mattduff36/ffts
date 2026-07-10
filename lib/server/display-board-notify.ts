import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  DISPLAY_BOARD_DEVICE_COMMAND_EVENT,
  type DisplayBoardDeviceCommandPayload,
  getDisplayBoardDeviceChannelName,
} from '@/lib/display-board/device-notify';

const NOTIFY_TIMEOUT_MS = 5000;

export async function notifyDisplayBoardDevice(
  boardKey: string,
  deviceId: string,
  command: DisplayBoardDeviceCommandPayload
): Promise<void> {
  try {
    const supabase = createAdminClient();
    const channelName = getDisplayBoardDeviceChannelName(boardKey, deviceId);

    await new Promise<void>((resolve) => {
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      const timeout = setTimeout(finish, NOTIFY_TIMEOUT_MS);
      const channel = supabase.channel(channelName);

      channel.subscribe(async (status) => {
        if (status !== 'SUBSCRIBED' || settled) return;

        try {
          await channel.send({
            type: 'broadcast',
            event: DISPLAY_BOARD_DEVICE_COMMAND_EVENT,
            payload: command,
          });
        } finally {
          clearTimeout(timeout);
          void supabase.removeChannel(channel);
          finish();
        }
      });
    });
  } catch {
    // Best-effort push; fallback polling still applies.
  }
}
