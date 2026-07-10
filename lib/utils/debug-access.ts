export interface DebugConsoleAccessParams {
  email: string | null | undefined;
  isActualSuperAdmin?: boolean | null | undefined;
  isViewingAs?: boolean | null | undefined;
}

export function isAdditionalDebugAccessUser(email: string | null | undefined): boolean {
  const configuredEmail =
    process.env.NEXT_PUBLIC_DEBUG_ACCESS_EMAIL?.trim().toLowerCase() || 'admin@mpdee.co.uk';
  return (email || '').trim().toLowerCase() === configuredEmail;
}

export function canAccessDebugConsole(params: DebugConsoleAccessParams): boolean {
  if (params.isViewingAs) {
    return false;
  }

  return Boolean(params.isActualSuperAdmin) || isAdditionalDebugAccessUser(params.email);
}
