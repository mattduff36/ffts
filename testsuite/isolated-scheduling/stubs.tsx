import { useSyncExternalStore, type ReactNode } from 'react';
import { ALL_MODULES } from '@/types/roles';
import { userId } from './fixture';

export const useAuth = () => ({
  profile: { id: userId, full_name: 'Sample Manager' },
  user: { id: userId }, loading: false, isManager: true, isAdmin: false,
  isSuperAdmin: false, isActualSuperAdmin: false, isViewingAs: false,
  effectiveRole: { name: 'manager', team_id: null },
});
export const usePermissionCheck = (module: string) => ({
  hasPermission: new URLSearchParams(location.search).get('deny') !== module, loading: false,
});
export const usePermissionSnapshot = () => ({ enabledModuleSet: new Set(ALL_MODULES) });
export const usePendingAbsenceCount = () => ({ count: 0 });
export const useTabletMode = () => ({ tabletModeEnabled: false });
export function usePathname() {
  return useSyncExternalStore(
    callback => { window.addEventListener('popstate', callback); return () => window.removeEventListener('popstate', callback); },
    () => location.pathname === '/' ? '/scheduling' : location.pathname,
  );
}
const router = { push: () => { throw new Error('Unexpected route navigation in isolated scheduling.'); }, replace: () => { throw new Error('Unexpected route replacement.'); } };
export const useRouter = () => router;
export const useSearchParams = () => new URLSearchParams(location.search);
export const NuqsClientAdapter = ({ children }: { children: ReactNode }) => children;
