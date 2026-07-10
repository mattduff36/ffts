'use client';

import { useEffect, useState } from 'react';

interface PwaDebugState {
  pathname: string;
  navigatorStandalone: string;
  displayModeStandalone: boolean;
  displayModeFullscreen: boolean;
  manifestHref: string | null;
  manifestCount: number;
  appleCapableMeta: string | null;
  mobileCapableMeta: string | null;
  appleTitleMeta: string | null;
  statusBarMeta: string | null;
}

function readMeta(name: string): string | null {
  return document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? null;
}

function readDebugState(): PwaDebugState {
  const manifests = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="manifest"]'));
  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };

  return {
    pathname: window.location.pathname,
    navigatorStandalone: String(navigatorWithStandalone.standalone ?? 'unsupported'),
    displayModeStandalone: window.matchMedia('(display-mode: standalone)').matches,
    displayModeFullscreen: window.matchMedia('(display-mode: fullscreen)').matches,
    manifestHref: manifests[0]?.href ?? null,
    manifestCount: manifests.length,
    appleCapableMeta: readMeta('apple-mobile-web-app-capable'),
    mobileCapableMeta: readMeta('mobile-web-app-capable'),
    appleTitleMeta: readMeta('apple-mobile-web-app-title'),
    statusBarMeta: readMeta('apple-mobile-web-app-status-bar-style'),
  };
}

export function PwaDebugClient() {
  const [state, setState] = useState<PwaDebugState | null>(null);

  useEffect(() => {
    const update = () => setState(readDebugState());
    update();

    const standaloneMedia = window.matchMedia('(display-mode: standalone)');
    const fullscreenMedia = window.matchMedia('(display-mode: fullscreen)');
    standaloneMedia.addEventListener('change', update);
    fullscreenMedia.addEventListener('change', update);

    return () => {
      standaloneMedia.removeEventListener('change', update);
      fullscreenMedia.removeEventListener('change', update);
    };
  }, []);

  return (
    <main className="min-h-dvh bg-slate-950 p-6 text-white">
      <div className="mx-auto max-w-2xl space-y-5">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-brand-yellow">PWA Debug</p>
          <h1 className="mt-2 text-2xl font-semibold">Installed App Runtime State</h1>
        </div>
        <pre className="overflow-auto rounded-xl border border-slate-700 bg-slate-900 p-4 text-sm leading-6">
          {JSON.stringify(state, null, 2)}
        </pre>
      </div>
    </main>
  );
}
