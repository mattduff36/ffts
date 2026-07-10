import { describe, expect, it } from 'vitest';
import {
  DISPLAY_BOARD_DEVICE_COMMAND_EVENT,
  getDisplayBoardDeviceChannelName,
  WORKSHOP_DISPLAY_BOARD_KEY,
} from '@/lib/display-board/device-notify';

describe('display board device notify', () => {
  it('builds a stable per-device realtime channel name', () => {
    const deviceId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    expect(getDisplayBoardDeviceChannelName(WORKSHOP_DISPLAY_BOARD_KEY, deviceId)).toBe(
      `display-board:${WORKSHOP_DISPLAY_BOARD_KEY}:${deviceId}`
    );
  });

  it('uses a fixed broadcast event name', () => {
    expect(DISPLAY_BOARD_DEVICE_COMMAND_EVENT).toBe('device_command');
  });
});
