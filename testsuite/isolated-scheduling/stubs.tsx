const access = { canAccess: true, state: { required: false, unlocked: true } };
export const usePermissionCheck = () => ({ hasPermission: true, loading: false });
export const useSensitiveModuleAccess = () => access;
export const SensitiveModuleGate = () => null;
export const SensitiveModuleSessionManager = () => null;
