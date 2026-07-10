import { describe, expect, it } from 'vitest';
import {
  DISPLAY_BOARD_TEXT_SIZE_DEFAULT_STEP,
  normalizeDisplayBoardSettings,
  normalizeDisplayBoardTextSizeStep,
  type DisplayBoardConfig,
} from '@/lib/server/display-board';

const currentConfig: DisplayBoardConfig = {
  board_key: 'workshop',
  name: 'Workshop Display Board',
  fallback_poll_interval_seconds: 60,
  realtime_debounce_ms: 750,
  is_enabled: true,
};

describe('display board settings validation', () => {
  it('accepts valid polling and debounce values', () => {
    expect(normalizeDisplayBoardSettings({
      fallback_poll_interval_seconds: 90,
      realtime_debounce_ms: 1200,
      is_enabled: false,
    }, currentConfig)).toEqual({
      fallback_poll_interval_seconds: 90,
      realtime_debounce_ms: 1200,
      is_enabled: false,
    });
  });

  it('clamps polling and debounce values to safe bounds', () => {
    expect(normalizeDisplayBoardSettings({
      fallback_poll_interval_seconds: 5,
      realtime_debounce_ms: 10000,
    }, currentConfig)).toEqual({
      fallback_poll_interval_seconds: 15,
      realtime_debounce_ms: 5000,
      is_enabled: true,
    });
  });

  it('uses current values for invalid numeric input', () => {
    expect(normalizeDisplayBoardSettings({
      fallback_poll_interval_seconds: 'not-a-number',
      realtime_debounce_ms: null,
    }, currentConfig)).toEqual({
      fallback_poll_interval_seconds: 60,
      realtime_debounce_ms: 750,
      is_enabled: true,
    });
  });

  it('normalizes display board text size steps to the shared five-stage scale', () => {
    expect(normalizeDisplayBoardTextSizeStep(1)).toBe(1);
    expect(normalizeDisplayBoardTextSizeStep('3')).toBe(3);
    expect(normalizeDisplayBoardTextSizeStep(5)).toBe(5);
  });

  it('defaults invalid display board text size values to the middle step', () => {
    expect(normalizeDisplayBoardTextSizeStep('not-a-step')).toBe(DISPLAY_BOARD_TEXT_SIZE_DEFAULT_STEP);
    expect(normalizeDisplayBoardTextSizeStep(0)).toBe(DISPLAY_BOARD_TEXT_SIZE_DEFAULT_STEP);
    expect(normalizeDisplayBoardTextSizeStep(6)).toBe(DISPLAY_BOARD_TEXT_SIZE_DEFAULT_STEP);
  });
});
