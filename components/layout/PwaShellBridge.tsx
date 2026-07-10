'use client';

import { useEffect } from 'react';

interface IOSNavigator extends Navigator {
  standalone?: boolean;
}

function isIOSStandalonePwa() {
  if (typeof window === 'undefined') return false;

  return (window.navigator as IOSNavigator).standalone === true;
}

function isStandalonePwa() {
  if (typeof window === 'undefined') return false;

  const hasStandaloneDisplayMode =
    typeof window.matchMedia === 'function' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches);

  return hasStandaloneDisplayMode || isIOSStandalonePwa();
}

function syncStandaloneAttribute() {
  document.documentElement.toggleAttribute('data-standalone-pwa', isStandalonePwa());
}

export function PwaShellBridge() {
  useEffect(() => {
    syncStandaloneAttribute();

    if (typeof window.matchMedia !== 'function') {
      return () => document.documentElement.removeAttribute('data-standalone-pwa');
    }

    const standaloneMedia = window.matchMedia('(display-mode: standalone)');
    standaloneMedia.addEventListener('change', syncStandaloneAttribute);

    return () => {
      standaloneMedia.removeEventListener('change', syncStandaloneAttribute);
      document.documentElement.removeAttribute('data-standalone-pwa');
    };
  }, []);

  return null;
}
