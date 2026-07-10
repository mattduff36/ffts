export const DISPLAY_BOARD_ENTRY_PATH = '/displayboard-workshop';
export const DISPLAY_BOARD_LEGACY_TV_PATH = '/displayboard-workshop-tv';

const LEGACY_TIZEN_VERSION_PATTERN = /\btizen\s*(?:2\.[0-9]|3\.0)\b/i;
const SMART_TV_PATTERN = /\b(?:smart-tv|smarttv|hbbtv)\b/i;
const LEGACY_WEBKIT_PATTERN = /applewebkit\/(?:537\.3|538\.1)\b/i;

export function isLegacyDisplayBoardBrowser(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;

  return LEGACY_TIZEN_VERSION_PATTERN.test(userAgent)
    || (SMART_TV_PATTERN.test(userAgent) && LEGACY_WEBKIT_PATTERN.test(userAgent));
}

export function shouldUseLegacyDisplayBoardRoute(pathname: string, userAgent: string | null | undefined): boolean {
  return pathname === DISPLAY_BOARD_ENTRY_PATH && isLegacyDisplayBoardBrowser(userAgent);
}
