export interface DebugConsoleAccessParams {
  email: string | null | undefined;
  isActualSuperAdmin?: boolean | null | undefined;
  isViewingAs?: boolean | null | undefined;
}

export function canAccessDebugConsole(params: DebugConsoleAccessParams): boolean {
  if (params.isViewingAs) {
    return false;
  }

  return Boolean(params.isActualSuperAdmin);
}
