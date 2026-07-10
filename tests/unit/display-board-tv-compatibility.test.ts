import { describe, expect, it } from 'vitest';
import {
  DISPLAY_BOARD_ENTRY_PATH,
  isLegacyDisplayBoardBrowser,
  shouldUseLegacyDisplayBoardRoute,
} from '@/lib/display-board/compatibility';

describe('display board TV compatibility routing', () => {
  it('detects legacy Samsung Tizen 2.4 display browsers', () => {
    expect(isLegacyDisplayBoardBrowser('Mozilla/5.0 (SMART-TV; Linux; Tizen 2.4.0) AppleWebKit/538.1')).toBe(true);
  });

  it('detects legacy Smart TV WebKit browsers without a Tizen version marker', () => {
    expect(isLegacyDisplayBoardBrowser('Mozilla/5.0 (SMART-TV; Linux) AppleWebKit/537.3')).toBe(true);
  });

  it('does not send modern Samsung TVs to the fallback route', () => {
    expect(isLegacyDisplayBoardBrowser('Mozilla/5.0 (SMART-TV; Linux; Tizen 6.5) AppleWebKit/537.36')).toBe(false);
  });

  it('only redirects the public display board entry route', () => {
    const legacyUserAgent = 'Mozilla/5.0 (SMART-TV; Linux; Tizen 2.4.0) AppleWebKit/538.1';

    expect(shouldUseLegacyDisplayBoardRoute(DISPLAY_BOARD_ENTRY_PATH, legacyUserAgent)).toBe(true);
    expect(shouldUseLegacyDisplayBoardRoute('/displayboard-workshop-tv', legacyUserAgent)).toBe(false);
  });
});
