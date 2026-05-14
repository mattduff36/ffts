export interface DebugConsoleAccessParams {
  email: string | null | undefined;
  isActualSuperAdmin?: boolean | null | undefined;
  isViewingAs?: boolean | null | undefined;
}

const ADDITIONAL_DEBUG_ACCESS_EMAIL =
  process.env.NEXT_PUBLIC_DEBUG_ACCESS_EMAIL?.trim().toLowerCase() || 'debug.user@example.com';

export function isAdditionalDebugAccessUser(email: string | null | undefined): boolean {
  return (email || '').trim().toLowerCase() === ADDITIONAL_DEBUG_ACCESS_EMAIL;
}

export function canAccessDebugConsole(params: DebugConsoleAccessParams): boolean {
  if (params.isViewingAs) {
    return false;
  }

  return Boolean(params.isActualSuperAdmin) || isAdditionalDebugAccessUser(params.email);
}
