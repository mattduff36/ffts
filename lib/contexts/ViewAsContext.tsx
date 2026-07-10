'use client';

import React, { createContext, useContext, useState } from 'react';
import { getViewAsRoleId, setViewAsRoleId as setCookie } from '@/lib/utils/view-as-cookie';

interface ViewAsContextType {
  /** UUID of the role being viewed-as, or empty string for actual role */
  viewAsRoleId: string;
  setViewAsRoleId: (roleId: string) => void;
  /** True when the super admin is actively viewing as another role */
  isViewingAs: boolean;
  /** True when the underlying user is a real super admin */
  isSuperAdmin: boolean;
}

const ViewAsContext = createContext<ViewAsContextType | undefined>(undefined);

export function ViewAsProvider({ 
  children,
  userEmail 
}: { 
  children: React.ReactNode;
  userEmail: string | null;
}) {
  const isSuperAdmin = userEmail === 'admin@mpdee.co.uk';
  const [viewAsRoleId, setViewAsRoleIdState] = useState<string>(() => {
    if (typeof window === 'undefined' || !isSuperAdmin) {
      return '';
    }
    return getViewAsRoleId();
  });

  const isViewingAs = viewAsRoleId !== '';

  function setViewAsRoleId(roleId: string) {
    setViewAsRoleIdState(roleId);
    setCookie(roleId);
  }

  // If not superadmin, always clear
  const effectiveRoleId = isSuperAdmin ? viewAsRoleId : '';

  return (
    <ViewAsContext.Provider value={{
      viewAsRoleId: effectiveRoleId,
      setViewAsRoleId,
      isViewingAs: isSuperAdmin && isViewingAs,
      isSuperAdmin
    }}>
      {children}
    </ViewAsContext.Provider>
  );
}

export function useViewAs() {
  const context = useContext(ViewAsContext);
  if (context === undefined) {
    throw new Error('useViewAs must be used within a ViewAsProvider');
  }
  return context;
}
