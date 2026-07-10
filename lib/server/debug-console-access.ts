import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import {
  getSensitiveModulePinState,
  type CurrentAuthenticatedProfile,
  type SensitiveModulePinState,
} from '@/lib/server/sensitive-pin';
import { canAccessDebugConsole } from '@/lib/utils/debug-access';
import { getEffectiveRole } from '@/lib/utils/view-as';

export interface DebugConsoleAccessResult {
  ok: boolean;
  status: number;
  error: string | null;
  profileId?: string;
  code?: 'SENSITIVE_PIN_REQUIRED' | 'SENSITIVE_PIN_SETUP_REQUIRED';
  sensitive_access?: SensitiveModulePinState;
  currentContext?: CurrentAuthenticatedProfile;
}

export async function canCurrentUserAccessDebugConsole(): Promise<DebugConsoleAccessResult> {
  const current = await getCurrentAuthenticatedProfile({ includeEmail: true });
  if (!current) {
    return {
      ok: false,
      status: 401,
      error: 'Unauthorized',
    };
  }

  const effectiveRole = await getEffectiveRole();
  if (!canAccessDebugConsole({
    email: current.profile.email,
    isActualSuperAdmin: effectiveRole.is_actual_super_admin,
    isViewingAs: effectiveRole.is_viewing_as,
  })) {
    return {
      ok: false,
      status: 403,
      error: 'Forbidden',
    };
  }

  return {
    ok: true,
    status: 200,
    error: null,
    profileId: current.profile.id,
    currentContext: current,
  };
}

export async function requireDebugConsoleAccess(): Promise<DebugConsoleAccessResult> {
  const identityAccess = await canCurrentUserAccessDebugConsole();
  if (!identityAccess.ok) {
    return identityAccess;
  }

  const state = await getSensitiveModulePinState('debug', identityAccess.currentContext);
  if (!state.required || state.unlocked) {
    return {
      ok: true,
      status: 200,
      error: null,
      profileId: identityAccess.profileId,
      sensitive_access: state,
      currentContext: identityAccess.currentContext,
    };
  }

  const code = !state.pin_status.configured || state.pin_status.must_reset
    ? 'SENSITIVE_PIN_SETUP_REQUIRED'
    : 'SENSITIVE_PIN_REQUIRED';

  return {
    ok: false,
    status: 428,
    error: code === 'SENSITIVE_PIN_SETUP_REQUIRED'
      ? 'Set up your sensitive access PIN from your profile before opening this module.'
      : 'Sensitive access PIN required for protected modules.',
    code,
    sensitive_access: state,
    currentContext: identityAccess.currentContext,
  };
}

export function createDebugAccessErrorBody(access: {
  error: string | null;
  code?: string;
  sensitive_access?: unknown;
}) {
  return {
    error: access.error,
    code: access.code,
    sensitive_access: access.sensitive_access,
  };
}
