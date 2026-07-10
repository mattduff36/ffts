import type { MobileTextSizeStep } from '@/lib/config/mobile-text-size-preference';

export const WORKSHOP_DISPLAY_BOARD_KEY = 'workshop';
export const DISPLAY_BOARD_DEVICE_COMMAND_EVENT = 'device_command';

export interface DisplayBoardDeviceCommandPayload {
  kind: 'refresh' | 'revoke' | 'text_size';
  text_size_step?: MobileTextSizeStep;
}

export function getDisplayBoardDeviceChannelName(boardKey: string, deviceId: string): string {
  return `display-board:${boardKey}:${deviceId}`;
}
