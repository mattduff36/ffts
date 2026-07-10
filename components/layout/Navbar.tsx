'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { 
  Activity,
  House,
  Menu, 
  X, 
  Bell,
  Bug,
  HelpCircle,
  Download,
  MonitorSmartphone,
  UserCircle2,
} from 'lucide-react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { NotificationPanel } from '@/components/messages/NotificationPanel';
import { TabletModeToggleActions } from '@/components/layout/TabletModeToggleActions';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import { ActiveNowUsersPanel } from '@/components/layout/ActiveNowUsersPanel';
import { SidebarNav } from './SidebarNav';
import { createClient } from '@/lib/supabase/client';
import { usePermissionSnapshot } from '@/lib/hooks/usePermissionSnapshot';
import { usePendingAbsenceCount, useRamsAssignmentSummary } from '@/lib/hooks/useNavMetrics';
import { useClientServiceOutage } from '@/lib/hooks/useClientServiceOutage';
import { toast } from 'sonner';
import { 
  dashboardNavItem, 
  getFilteredEmployeeNav, 
  getFilteredNavByPermissions,
  managerNavItems, 
  adminNavItems 
} from '@/lib/config/navigation';

/**
 * Get the module-specific active color classes for a nav item
 * Each module gets its own color when the link is active
 */
function getNavItemActiveColors(href: string): { bg: string; text: string } {
  // Dashboard and Help use brand yellow (with dark text)
  if (href === '/dashboard' || href === '/help') {
    return { bg: 'bg-brand-yellow', text: 'text-slate-900' };
  }
  // Timesheets - Blue
  if (href.startsWith('/timesheets')) {
    return { bg: 'bg-timesheet', text: 'text-white' };
  }
  // Van Inspections - Orange
  if (href.startsWith('/van-inspections')) {
    return { bg: 'bg-inspection', text: 'text-white' };
  }
  // Plant Inspections - Darker Orange
  if (href.startsWith('/plant-inspections')) {
    return { bg: 'bg-plant-inspection', text: 'text-white' };
  }
  // HGV Inspections - Dark Orange
  if (href.startsWith('/hgv-inspections')) {
    return { bg: 'bg-hgv-inspection', text: 'text-white' };
  }
  // Projects (formerly RAMS) - Green
  if (href.startsWith('/projects') || href.startsWith('/rams')) {
    return { bg: 'bg-rams', text: 'text-white' };
  }
  // Absence - Purple
  if (href.startsWith('/absence')) {
    return { bg: 'bg-absence', text: 'text-white' };
  }
  // Maintenance - Red
  if (href.startsWith('/maintenance')) {
    return { bg: 'bg-maintenance', text: 'text-white' };
  }
  // Fleet - Rust/brick
  if (href.startsWith('/fleet')) {
    return { bg: 'bg-fleet', text: 'text-white' };
  }
  // Workshop - Brown/rust
  if (href.startsWith('/workshop')) {
    return { bg: 'bg-workshop', text: 'text-white' };
  }
  // Reports - Brand yellow (management tool)
  if (href.startsWith('/reports')) {
    return { bg: 'bg-brand-yellow', text: 'text-slate-900' };
  }
  // Inventory - Indigo
  if (href.startsWith('/inventory')) {
    return { bg: 'bg-inventory', text: 'text-white' };
  }
  if (href.startsWith('/reminders')) {
    return { bg: 'bg-reminders', text: 'text-white' };
  }
  // Default - Brand yellow
  return { bg: 'bg-brand-yellow', text: 'text-slate-900' };
}

/**
 * Get module brand color for inactive icon state.
 */
function getNavItemIconColor(href: string): string {
  if (href === '/dashboard' || href === '/help') return 'text-brand-yellow';
  if (href.startsWith('/timesheets')) return 'text-timesheet';
  if (href.startsWith('/van-inspections')) return 'text-inspection';
  if (href.startsWith('/plant-inspections')) return 'text-plant-inspection';
  if (href.startsWith('/hgv-inspections')) return 'text-hgv-inspection';
  if (href.startsWith('/projects') || href.startsWith('/rams')) return 'text-rams';
  if (href.startsWith('/absence')) return 'text-absence';
  if (href.startsWith('/maintenance')) return 'text-maintenance';
  if (href.startsWith('/fleet')) return 'text-fleet';
  if (href.startsWith('/workshop')) return 'text-workshop';
  if (href.startsWith('/reports')) return 'text-brand-yellow';
  if (href.startsWith('/inventory')) return 'text-inventory';
  if (href.startsWith('/reminders')) return 'text-reminders';
  return 'text-brand-yellow';
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function checkStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false;

  const isStandaloneDisplayMode =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(display-mode: standalone)').matches
      : false;
  const isIOSStandalone = (window.navigator as { standalone?: boolean }).standalone === true;

  return isStandaloneDisplayMode || isIOSStandalone;
}

const MOBILE_MENU_ANIMATION_MS = 300;

export function Navbar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, profile, signOut, isAdmin, isManager, isActualSuperAdmin, isViewingAs } = useAuth();
  const clientServiceOutage = useClientServiceOutage();
  const { tabletModeEnabled, toggleTabletMode } = useTabletMode();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileMenuRendered, setMobileMenuRendered] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false); // Sidebar starts collapsed
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isMounted, setIsMounted] = useState(false); // Track client hydration
  const [isCompact, setIsCompact] = useState(false);
  const [desktopMenuOpen, setDesktopMenuOpen] = useState(false);
  const [activeNowDialogOpen, setActiveNowDialogOpen] = useState(false);
  const [desktopMenuPosition, setDesktopMenuPosition] = useState({ left: 0, top: 0, maxHeight: 320 });
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandaloneApp, setIsStandaloneApp] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);
  const isCompactRef = useRef(false);
  const expandedWidthRef = useRef(0);
  const desktopMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const desktopMenuRef = useRef<HTMLDivElement>(null);
  const activeNotificationUserIdRef = useRef<string | null>(null);
  const [supabase, setSupabase] = useState<ReturnType<typeof createClient> | null>(null);

  // useAuth now provides effective role flags (respecting View As cookie)
  const effectiveIsManager = isManager;
  const effectiveIsAdmin = isAdmin;

  const { enabledModuleSet: userPermissions } = usePermissionSnapshot();
  const { data: ramsSummary } = useRamsAssignmentSummary(profile?.id);
  const { count: pendingAbsenceCount } = usePendingAbsenceCount(
    Boolean(profile?.id) && (effectiveIsManager || effectiveIsAdmin),
    profile?.id
  );
  const hasRAMSAssignments = ramsSummary?.hasAssignments || false;

  // Set mounted state after hydration to prevent hydration mismatches
  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    setSupabase(createClient());
  }, []);

  useEffect(() => {
    if (!tabletModeEnabled) return;
    setMobileMenuOpen(false);
    setSidebarOpen(false);
    setNotificationPanelOpen(false);
    setDesktopMenuOpen(false);
    setActiveNowDialogOpen(false);
  }, [tabletModeEnabled]);

  useEffect(() => {
    if (mobileMenuOpen) {
      setMobileMenuRendered(true);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setMobileMenuRendered(false);
    }, MOBILE_MENU_ANIMATION_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    activeNotificationUserIdRef.current = user?.id || null;
    setUnreadCount(0);
  }, [user?.id]);

  useEffect(() => {
    setIsStandaloneApp(checkStandaloneMode());

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredInstallPrompt(event as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setDeferredInstallPrompt(null);
      setIsStandaloneApp(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const updateDesktopMenuPosition = () => {
    const triggerRect = desktopMenuTriggerRef.current?.getBoundingClientRect();
    if (!triggerRect) return;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const menuWidth = 224; // matches w-56
    const margin = 12;
    const preferredLeft = Math.round(triggerRect.right - menuWidth);
    const maxLeft = Math.max(margin, viewportWidth - menuWidth - margin);
    const clampedLeft = Math.min(Math.max(margin, preferredLeft), maxLeft);
    const spaceBelow = viewportHeight - triggerRect.bottom - margin;
    const spaceAbove = triggerRect.top - margin;
    const openUpwards = spaceBelow < 200 && spaceAbove > spaceBelow;
    const availableHeight = Math.max(0, Math.floor((openUpwards ? spaceAbove : spaceBelow) - 8));
    const top = openUpwards
      ? Math.max(margin, Math.round(triggerRect.top - availableHeight - 8))
      : Math.max(margin, Math.round(triggerRect.bottom + 8));

    setDesktopMenuPosition({
      left: clampedLeft,
      top,
      maxHeight: availableHeight,
    });
  };

  useEffect(() => {
    if (!desktopMenuOpen) return;

    updateDesktopMenuPosition();

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (desktopMenuTriggerRef.current?.contains(target) || desktopMenuRef.current?.contains(target)) {
        return;
      }
      setDesktopMenuOpen(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setDesktopMenuOpen(false);
      }
    }

    function syncPosition() {
      updateDesktopMenuPosition();
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('resize', syncPosition);
    window.addEventListener('scroll', syncPosition, true);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('resize', syncPosition);
      window.removeEventListener('scroll', syncPosition, true);
    };
  }, [desktopMenuOpen]);

  useEffect(() => {
    setDesktopMenuOpen(false);
  }, [pathname]);

  // Auto-compact: switch to icon-only when labels would overflow the nav container
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;

    const check = () => {
      if (!isCompactRef.current) {
        if (el.scrollWidth > el.clientWidth + 2) {
          expandedWidthRef.current = el.scrollWidth;
          isCompactRef.current = true;
          setIsCompact(true);
        }
      } else {
        if (el.clientWidth >= expandedWidthRef.current + 16) {
          isCompactRef.current = false;
          setIsCompact(false);
        }
      }
    };

    const observer = new ResizeObserver(check);
    observer.observe(el);
    check();

    return () => observer.disconnect();
  }, []);

  const fetchNotificationCount = useCallback(async () => {
    if (!user?.id) {
      setUnreadCount(0);
      return;
    }

    if (clientServiceOutage) {
      setUnreadCount(0);
      return;
    }

    try {
      const response = await fetch('/api/messages/notifications/count');

      // Handle 401 gracefully - user may have just logged out
      if (response.status === 401) {
        setUnreadCount(0);
        return;
      }

      // Handle other HTTP errors
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      if (data.success) {
        setUnreadCount(data.unread_count || 0);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorDetails = {
        message: errorMessage,
        type: error instanceof TypeError ? 'Network' : 'Application',
        endpoint: '/api/messages/notifications/count',
        userId: user?.id || 'unknown',
        timestamp: new Date().toISOString()
      };

      const isExpectedError = error instanceof Error && (
        error.message.includes('401') ||
        error.message.includes('Failed to fetch') ||
        error.message.includes('Network request failed')
      );

      if (!isExpectedError) {
        console.warn('Error fetching notifications:', errorMessage, errorDetails);
      }

      setUnreadCount(0);
    }
  }, [clientServiceOutage, user?.id]);

  // Refresh notification count on meaningful client events only.
  useEffect(() => {
    if (!user?.id || clientServiceOutage) {
      setUnreadCount(0);
      return;
    }

    void fetchNotificationCount();

    const handleNotificationDismissed = () => {
      void fetchNotificationCount();
    };
    const handleWindowFocus = () => {
      void fetchNotificationCount();
    };

    window.addEventListener('notification-dismissed', handleNotificationDismissed);
    window.addEventListener('focus', handleWindowFocus);

    return () => {
      window.removeEventListener('notification-dismissed', handleNotificationDismissed);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [clientServiceOutage, user?.id, fetchNotificationCount]);

  // Realtime updates for this user's notification rows.
  useEffect(() => {
    if (!user?.id || !supabase || clientServiceOutage) return;

    const subscribedUserId = user.id;
    const filter = `user_id=eq.${subscribedUserId}`;
    const channel = supabase
      .channel(`navbar_notifications_${subscribedUserId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'message_recipients',
        filter,
      }, () => {
        if (activeNotificationUserIdRef.current !== subscribedUserId) {
          return;
        }
        void fetchNotificationCount();
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'message_recipients',
        filter,
      }, () => {
        if (activeNotificationUserIdRef.current !== subscribedUserId) {
          return;
        }
        void fetchNotificationCount();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [clientServiceOutage, user?.id, supabase, fetchNotificationCount]);

  const handleSignOut = async () => {
    try {
      // Close mobile menu if open
      setMobileMenuOpen(false);

      const { error } = await signOut();
      if (error) {
        throw new Error(error.message);
      }
    } catch (error) {
      console.error('Error during sign out:', error);
      toast.error('Could not sign out. Please try again.');
    }
  };

  const handleInstallApp = async () => {
    setMobileMenuOpen(false);

    if (isStandaloneApp) return;

    if (deferredInstallPrompt) {
      await deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      setDeferredInstallPrompt(null);
      return;
    }

    window.alert('Open your browser menu and tap "Install app" (or "Add to Home screen") to install FOREST FARM.');
  };

  // Helper function to check if a nav link is active
  const isLinkActive = (href: string): boolean => {
    if (!pathname) return false;
    
    // Parse the href to separate path and query
    const [linkPath, linkQuery] = href.split('?');
    
    // Check if pathname matches (handles nested routes consistently)
    // Match exact path OR nested paths (e.g., /fleet matches /fleet/vans/123)
    const pathMatches = pathname === linkPath || pathname.startsWith(linkPath + '/');
    
    if (!pathMatches) return false;
    
    // If no query params in href, path match is sufficient
    if (!linkQuery) {
      return true;
    }

    // Hydration safety: search params can differ during SSR vs client hydration.
    // Until mounted, only use path matching to keep server/client HTML identical.
    if (!isMounted) {
      return true;
    }
    
    // If href has query params, verify they all match current URL
    const linkParams = new URLSearchParams(linkQuery);
    
    // Check all link query params exist in current URL with same values
    for (const [key, value] of linkParams.entries()) {
      if (searchParams?.get(key) !== value) {
        return false;
      }
    }
    
    return true;
  };

  // Dashboard is always visible
  const dashboardNav = [dashboardNavItem];
  
  // Employee navigation - filtered by permissions (using shared config)
  const employeeNav = getFilteredEmployeeNav(
    userPermissions,
    effectiveIsManager,
    effectiveIsAdmin,
    hasRAMSAssignments
  );

  // Manager/admin links for mobile menu only (using shared config)
  const managerLinks = getFilteredNavByPermissions(
    managerNavItems,
    userPermissions,
    effectiveIsAdmin
  );
  const mobileManagerLinks = managerLinks.filter((item) => item.href !== '/absence/manage');
  const adminLinks = getFilteredNavByPermissions(
    adminNavItems,
    userPermissions,
    effectiveIsAdmin
  );
  const hasMobileManagementLinks = mobileManagerLinks.length > 0 || adminLinks.length > 0;
  const hasMobileDeveloperLinks = isActualSuperAdmin && !isViewingAs;
  const showInstallAppLink = !isStandaloneApp;
  const unreadBadgeLabel = unreadCount > 99 ? '99+' : unreadCount;

  return (
    <>
      {/* Sidebar for Manager/Admin (desktop) */}
      {!tabletModeEnabled && <SidebarNav open={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />}

      {!tabletModeEnabled && (
        <button
          type="button"
          aria-label="Close navigation menu"
          className={`fixed inset-0 z-[40] bg-black/50 backdrop-blur-xl transition-opacity duration-300 md:hidden ${
            mobileMenuOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {!tabletModeEnabled && (
        <button
          type="button"
          aria-label="Close navigation menu"
          className={`fixed inset-0 z-[40] hidden bg-black/50 transition-opacity duration-300 md:block ${
            desktopMenuOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
          onClick={() => setDesktopMenuOpen(false)}
        />
      )}

      <nav 
        className="bg-slate-900/50 backdrop-blur-xl border-b border-border/50 top-0 z-50 app-top-navbar"
      >
        {/* brand yellow accent strip */}
        <div className="h-1 bg-gradient-to-r from-brand-yellow via-brand-yellow to-brand-yellow-hover"></div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {tabletModeEnabled ? (
            <div className="flex items-center h-16">
              <Link
                href="/dashboard"
                className="flex items-center gap-2 group"
              >
                <House className="h-4 w-4 text-brand-yellow transition-colors group-hover:text-white" aria-hidden="true" />
                <div className="text-xl font-bold text-white group-hover:text-brand-yellow transition-colors">
                  FOREST FARM
                </div>
              </Link>
              <div className="ml-auto flex items-center gap-2">
                <div className="hidden md:flex items-center">
                  <TabletModeToggleActions />
                </div>
              </div>
            </div>
          ) : (
          <div className="flex items-center h-16">
            {/* Mobile-only text logo */}
            <Link 
              href="/dashboard" 
              className="md:hidden flex items-center gap-2 mr-4 group"
              onClick={() => setMobileMenuOpen(false)}
            >
              <House className="h-4 w-4 text-brand-yellow transition-colors group-hover:text-white" aria-hidden="true" />
              <div className="text-xl font-bold text-white group-hover:text-brand-yellow transition-colors">
                FOREST FARM
              </div>
            </Link>

            {/* Desktop text logo */}
            <Link
              href="/dashboard"
              className="hidden md:flex flex-shrink-0 items-center gap-2 mr-4 group"
            >
              <House className="h-4 w-4 text-brand-yellow transition-colors group-hover:text-white" aria-hidden="true" />
              <div className="text-xl font-bold text-white group-hover:text-brand-yellow transition-colors">
                FOREST FARM
              </div>
            </Link>

            {/* Desktop Navigation - Centered, auto-compacts to icon-only when space is tight */}
            <div ref={navRef} className="hidden md:flex flex-1 items-center justify-center space-x-1 overflow-hidden">
              {[...dashboardNav, ...employeeNav.filter(item => item.href !== '/help')].map((item) => {
                const Icon = item.icon;
                const isActive = isLinkActive(item.href);
                const activeColors = getNavItemActiveColors(item.href);
                const iconColorClass = getNavItemIconColor(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={item.label}
                    className={`group inline-flex items-center py-2 font-medium rounded-md transition-all duration-[225ms] ${
                      isActive
                        ? `${activeColors.bg} ${activeColors.text} text-sm px-3`
                        : isCompact
                          ? 'text-muted-foreground hover:bg-slate-800/50 hover:text-white px-3 text-sm'
                          : 'text-muted-foreground hover:bg-slate-800/50 hover:text-white text-[8px] hover:text-sm px-2 hover:px-3'
                    }`}
                  >
                    <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? '' : iconColorClass}`} />
                    <span className={
                      isCompact
                        ? `overflow-hidden whitespace-nowrap transition-all duration-[225ms] ${
                            isActive
                              ? 'ml-2 max-w-[120px] opacity-100'
                              : 'max-w-0 opacity-0 group-hover:ml-2 group-hover:max-w-[120px] group-hover:opacity-100'
                          }`
                        : 'ml-1.5 whitespace-nowrap'
                    }>
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </div>

            {/* Right side */}
            <div className="flex items-center space-x-2 ml-auto">
              {/* Desktop burger menu (non-tablet mode only) */}
              <div className="hidden md:flex items-center">
                <Button
                  ref={desktopMenuTriggerRef}
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-white hover:bg-slate-800/50 relative"
                  title="Menu"
                  aria-haspopup="menu"
                  aria-expanded={desktopMenuOpen}
                  onClick={() => {
                    const nextOpen = !desktopMenuOpen;
                    if (nextOpen) {
                      updateDesktopMenuPosition();
                      void fetchNotificationCount();
                    }
                    setDesktopMenuOpen(nextOpen);
                  }}
                >
                  <Menu className="w-4 h-4" />
                  {unreadCount > 0 && (
                    <span
                      data-testid="desktop-burger-notification-badge"
                      className="absolute -top-1 -right-1 h-5 min-w-5 px-1 bg-red-600 text-white text-[11px] font-bold rounded-full flex items-center justify-center"
                    >
                      {unreadBadgeLabel}
                    </span>
                  )}
                </Button>
                {desktopMenuOpen && (
                  <div
                    ref={desktopMenuRef}
                    role="menu"
                    className="fixed z-[80] w-64 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-md border border-border/50 bg-slate-900/95 p-2 shadow-2xl backdrop-blur-xl"
                    style={{
                      left: `${desktopMenuPosition.left}px`,
                      top: `${desktopMenuPosition.top}px`,
                      maxHeight: `${desktopMenuPosition.maxHeight}px`,
                    }}
                  >
                    <Link
                      href="/profile"
                      className={`flex items-center px-3 py-2 text-lg font-medium rounded-md ${
                        isLinkActive('/profile')
                          ? 'bg-brand-yellow text-slate-900'
                          : 'text-muted-foreground hover:bg-slate-800/50 hover:text-white'
                      }`}
                      onClick={() => setDesktopMenuOpen(false)}
                    >
                      <UserCircle2
                        className={`w-6 h-6 mr-3 ${isLinkActive('/profile') ? 'text-slate-900' : 'text-brand-yellow'}`}
                      />
                      Profile
                    </Link>

                    <button
                      type="button"
                      className="flex w-full items-center px-3 py-2 text-lg font-medium rounded-md text-muted-foreground hover:bg-slate-800/50 hover:text-white"
                      onClick={() => {
                        setDesktopMenuOpen(false);
                        setNotificationPanelOpen(true);
                        void fetchNotificationCount();
                      }}
                    >
                      <Bell className="w-6 h-6 mr-3 text-brand-yellow" />
                      Notifications
                      {unreadCount > 0 && (
                        <span
                          data-testid="desktop-menu-notification-link-badge"
                          className="ml-auto min-w-[1.25rem] h-5 px-1 rounded-full bg-red-500 text-white text-[11px] leading-none flex items-center justify-center font-semibold"
                        >
                          {unreadBadgeLabel}
                        </span>
                      )}
                    </button>

                    <Link
                      href="/help"
                      className={`flex items-center px-3 py-2 text-lg font-medium rounded-md ${
                        isLinkActive('/help')
                          ? 'bg-brand-yellow text-slate-900'
                          : 'text-muted-foreground hover:bg-slate-800/50 hover:text-white'
                      }`}
                      onClick={() => setDesktopMenuOpen(false)}
                    >
                      <HelpCircle
                        className={`w-6 h-6 mr-3 ${isLinkActive('/help') ? 'text-slate-900' : 'text-brand-yellow'}`}
                      />
                      Help
                    </Link>

                    <button
                      type="button"
                      className="flex w-full items-center px-3 py-2 text-lg font-medium rounded-md text-muted-foreground hover:bg-slate-800/50 hover:text-white"
                      onClick={() => {
                        setDesktopMenuOpen(false);
                        toggleTabletMode();
                      }}
                    >
                      <MonitorSmartphone className="w-6 h-6 mr-3 text-brand-yellow" />
                      {tabletModeEnabled ? 'Disable Tablet Mode' : 'Enable Tablet Mode'}
                    </button>

                    <div className="mt-3 pt-3 border-t border-border/50">
                      <Button
                        variant="destructive"
                        className="w-full justify-center bg-red-600 text-lg text-white hover:bg-red-500"
                        onClick={() => {
                          setDesktopMenuOpen(false);
                          void handleSignOut();
                        }}
                      >
                        Sign Out
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Mobile menu button */}
              <button
                type="button"
                aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
                aria-expanded={mobileMenuOpen}
                onClick={() => {
                  const nextOpen = !mobileMenuOpen;
                  if (nextOpen) {
                    void fetchNotificationCount();
                  }
                  setMobileMenuOpen(nextOpen);
                }}
                className="md:hidden relative p-2 rounded-md text-muted-foreground hover:bg-slate-800/50 hover:text-white"
              >
                {mobileMenuOpen ? (
                  <X className="w-6 h-6" />
                ) : (
                  <Menu className="w-6 h-6" />
                )}
                {!mobileMenuOpen && unreadCount > 0 && (
                  <span
                    data-testid="mobile-burger-notification-badge"
                    className="absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] leading-none flex items-center justify-center font-semibold"
                  >
                    {unreadBadgeLabel}
                  </span>
                )}
              </button>
            </div>
          </div>
          )}
        </div>

        {/* Mobile menu */}
        {!tabletModeEnabled && mobileMenuRendered && (
          <div
            aria-hidden={!mobileMenuOpen}
            className={`md:hidden overflow-hidden border-t border-border/50 bg-slate-900/95 ${
              mobileMenuOpen ? 'animate-mobile-menu-slide-down' : 'pointer-events-none animate-mobile-menu-slide-up'
            }`}
          >
            <div className="px-2 pt-2 pb-3">
              <div className={`grid gap-3 ${hasMobileManagementLinks ? 'grid-cols-2' : 'grid-cols-1'}`}>
                <div className="space-y-1">
                  {[...dashboardNav, ...employeeNav.filter((item) => item.href !== '/help' && item.href !== '/profile')].map((item) => {
                    const Icon = item.icon;
                    const isActive = isLinkActive(item.href);
                    const activeColors = getNavItemActiveColors(item.href);
                    const iconColorClass = getNavItemIconColor(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileMenuOpen(false)}
                        className={`flex items-center px-3 py-2 text-lg font-medium rounded-md ${
                          isActive
                            ? `${activeColors.bg} ${activeColors.text}`
                            : 'text-muted-foreground hover:bg-slate-800/50 hover:text-white'
                        }`}
                      >
                        <Icon className={`w-6 h-6 mr-3 ${isActive ? '' : iconColorClass}`} />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>

                {hasMobileManagementLinks ? (
                  <div className="space-y-1">
                    {[...mobileManagerLinks, ...adminLinks].map((item) => {
                      const Icon = item.icon;
                      const isActive = isLinkActive(item.href);
                      const activeColors = getNavItemActiveColors(item.href);
                      const iconColorClass = getNavItemIconColor(item.href);
                      const badgeCount = item.href === '/absence/manage' ? pendingAbsenceCount : 0;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setMobileMenuOpen(false)}
                          className={`flex items-center px-3 py-2 text-lg font-medium rounded-md ${
                            isActive
                              ? `${activeColors.bg} ${activeColors.text}`
                              : 'text-muted-foreground hover:bg-slate-800/50 hover:text-white'
                          }`}
                        >
                          <Icon className={`w-6 h-6 mr-3 ${isActive ? '' : iconColorClass}`} />
                          <span>{item.label}</span>
                          {badgeCount > 0 && (
                            <span className="ml-auto min-w-[1.25rem] h-5 px-1 rounded-full bg-red-500 text-white text-[11px] leading-none flex items-center justify-center font-semibold">
                              {badgeCount > 99 ? '99+' : badgeCount}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="pt-4 pb-3 border-t border-border/50">
              <div className={`px-2 grid gap-3 ${hasMobileDeveloperLinks ? 'grid-cols-2' : 'grid-cols-1'}`}>
                <div className="space-y-1">
                  <Link
                    href="/profile"
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center px-3 py-2 text-lg font-medium rounded-md ${
                      isLinkActive('/profile')
                        ? 'bg-brand-yellow text-slate-900'
                        : 'text-muted-foreground hover:bg-slate-800/50 hover:text-white'
                    }`}
                  >
                    <UserCircle2
                      className={`w-6 h-6 mr-3 ${isLinkActive('/profile') ? 'text-slate-900' : 'text-brand-yellow'}`}
                    />
                    Profile
                  </Link>

                  <button
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      setNotificationPanelOpen(true);
                      void fetchNotificationCount();
                    }}
                    className="flex w-full items-center px-3 py-2 text-lg font-medium rounded-md text-muted-foreground hover:bg-slate-800/50 hover:text-white"
                  >
                    <Bell className="w-6 h-6 mr-3 text-brand-yellow" />
                    Notifications
                    {unreadCount > 0 && (
                      <span
                        data-testid="mobile-menu-notification-link-badge"
                        className="ml-auto min-w-[1.25rem] h-5 px-1 rounded-full bg-red-500 text-white text-[11px] leading-none flex items-center justify-center font-semibold"
                      >
                        {unreadBadgeLabel}
                      </span>
                    )}
                  </button>

                  <Link
                    href="/help"
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center px-3 py-2 text-lg font-medium rounded-md ${
                      isLinkActive('/help')
                        ? 'bg-brand-yellow text-slate-900'
                        : 'text-muted-foreground hover:bg-slate-800/50 hover:text-white'
                    }`}
                  >
                    <HelpCircle
                      className={`w-6 h-6 mr-3 ${isLinkActive('/help') ? 'text-slate-900' : 'text-brand-yellow'}`}
                    />
                    Help
                  </Link>

                  {showInstallAppLink ? (
                    <button
                      type="button"
                      onClick={() => {
                        void handleInstallApp();
                      }}
                      className="flex w-full items-center px-3 py-2 text-lg font-medium rounded-md text-muted-foreground hover:bg-slate-800/50 hover:text-white"
                    >
                      <Download className="w-6 h-6 mr-3 text-brand-yellow" />
                      Install App
                    </button>
                  ) : null}
                </div>

                {hasMobileDeveloperLinks ? (
                  <div className="space-y-1">
                    <button
                      type="button"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        setActiveNowDialogOpen(true);
                      }}
                      className="flex w-full items-center px-3 py-2 text-lg font-medium rounded-md text-red-500 hover:bg-slate-800/50 hover:text-red-400"
                    >
                      <Activity className="w-6 h-6 mr-3" />
                      Active Now
                    </button>

                    <Link
                      href="/debug"
                      onClick={() => setMobileMenuOpen(false)}
                      className={`flex items-center px-3 py-2 text-lg font-medium rounded-md ${
                        pathname === '/debug'
                          ? 'bg-red-600 text-white'
                          : 'text-red-500 hover:bg-slate-800/50 hover:text-red-400'
                      }`}
                    >
                      <Bug className="w-6 h-6 mr-3" />
                      Debug Console
                    </Link>
                  </div>
                ) : null}
              </div>

              <div className="mt-3 pt-3 border-t border-border/50 px-2">
                <Button
                  variant="destructive"
                  className="w-full justify-center bg-red-600 text-lg text-white hover:bg-red-500"
                  onClick={handleSignOut}
                >
                  Sign Out
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Notification Panel */}
        {!tabletModeEnabled && (
          <NotificationPanel
            open={notificationPanelOpen}
            onClose={() => {
              setNotificationPanelOpen(false);
              // Refresh unread count after closing
              void fetchNotificationCount();
            }}
          />
        )}

        {!tabletModeEnabled && (
          <Dialog open={activeNowDialogOpen} onOpenChange={setActiveNowDialogOpen}>
            <DialogContent className="border-slate-700 bg-slate-900 text-white max-w-xl max-h-[85vh] overflow-hidden flex flex-col p-0">
              <DialogHeader className="px-5 pt-5">
                <DialogTitle>Active Now</DialogTitle>
                <DialogDescription className="text-slate-400">
                  Superadmin visibility for currently active and recently active users.
                </DialogDescription>
              </DialogHeader>
              <div className="overflow-y-auto px-3 pb-4">
                <ActiveNowUsersPanel open={activeNowDialogOpen} />
              </div>
            </DialogContent>
          </Dialog>
        )}
      </nav>
    </>
  );
}
