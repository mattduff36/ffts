'use client';

import { useEffect, useState, useRef } from 'react';
import { RefreshCw } from 'lucide-react';

function isInsideMobileScrollLock(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('[data-mobile-scroll-lock="true"]'));
}

export function PullToRefresh() {
  const [isPWA, setIsPWA] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartY = useRef<number | null>(null);
  const touchCurrentY = useRef<number | null>(null);
  const isPulling = useRef(false);
  const pullDistanceRef = useRef(0);
  const isRefreshingRef = useRef(false);
  const threshold = 80; // Distance in pixels to trigger refresh

  // Sync refs with state
  useEffect(() => {
    pullDistanceRef.current = pullDistance;
  }, [pullDistance]);

  useEffect(() => {
    isRefreshingRef.current = isRefreshing;
  }, [isRefreshing]);

  useEffect(() => {
    // Check if running as PWA (standalone mode)
    const checkPWAMode = () => {
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
      const isIOSStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
      setIsPWA(isStandalone || isIOSStandalone);
    };

    checkPWAMode();
  }, []);

  useEffect(() => {
    // Only enable pull-to-refresh in PWA mode
    if (!isPWA) return;

    const handleTouchStart = (e: TouchEvent) => {
      if (isInsideMobileScrollLock(e.target)) {
        touchStartY.current = null;
        isPulling.current = false;
        return;
      }

      // Only trigger if at the top of the page
      if (window.scrollY === 0) {
        touchStartY.current = e.touches[0].clientY;
        isPulling.current = true;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (isInsideMobileScrollLock(e.target)) return;
      if (!isPulling.current || touchStartY.current === null) return;

      touchCurrentY.current = e.touches[0].clientY;
      const distance = touchCurrentY.current - touchStartY.current;

      // Only allow pulling down (positive distance)
      if (distance > 0 && window.scrollY === 0) {
        // Prevent default scroll behavior
        e.preventDefault();
        setPullDistance(distance);
      } else {
        // Reset if scrolling up or page has scrolled
        isPulling.current = false;
        setPullDistance(0);
      }
    };

    const handleTouchEnd = () => {
      const currentDistance = pullDistanceRef.current;
      const refreshing = isRefreshingRef.current;
      
      if (currentDistance >= threshold && !refreshing) {
        setIsRefreshing(true);
        // Trigger refresh after a short delay to show the animation
        setTimeout(() => {
          window.location.reload();
        }, 300);
      } else {
        // Reset if threshold not reached
        setPullDistance(0);
      }
      isPulling.current = false;
      touchStartY.current = null;
      touchCurrentY.current = null;
    };

    // Add touch event listeners
    document.addEventListener('touchstart', handleTouchStart, { passive: false });
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isPWA]);

  // Don't render if not in PWA mode
  if (!isPWA) return null;

  // Calculate rotation and opacity based on pull distance
  const rotation = Math.min(pullDistance / threshold * 360, 360);
  const opacity = Math.min(pullDistance / threshold, 1);
  const translateY = Math.min(pullDistance * 0.5, threshold * 0.5);

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[100] pointer-events-none transition-opacity duration-200 ease-out"
      style={{
        transform: `translateY(${translateY}px)`,
        opacity: pullDistance > 0 ? opacity : 0,
      }}
    >
      <div className="flex items-center justify-center pt-2 pb-2">
        <div className="bg-slate-900/90 backdrop-blur-xl rounded-full p-3 border border-border/50 shadow-lg">
          <RefreshCw
            className={`h-6 w-6 text-brand-yellow transition-transform duration-200 ${
              isRefreshing ? 'animate-spin' : ''
            }`}
            style={{
              transform: isRefreshing ? 'rotate(0deg)' : `rotate(${rotation}deg)`,
            }}
          />
        </div>
      </div>
    </div>
  );
}

