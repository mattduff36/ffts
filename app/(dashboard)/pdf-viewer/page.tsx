'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { PageLoader } from '@/components/ui/page-loader';
import { PDFCanvasRenderer } from '@/components/pdf/PDFCanvasRenderer';
import { isSafeInternalRedirectTarget } from '@/lib/routes/public-routes';

function PDFViewerContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [hasReachedBottom, setHasReachedBottom] = useState(false);
  
  const url = searchParams.get('url');
  const requestedReturnUrl = searchParams.get('return');
  const returnUrl = isSafeInternalRedirectTarget(requestedReturnUrl) ? requestedReturnUrl : '/rams';
  const showSign = searchParams.get('sign') === '1';

  useEffect(() => {
    if (!showSign || hasReachedBottom) return;

    let scrollListenerAdded = false;

    const onScroll = () => {
      const scrollBottom = window.innerHeight + window.scrollY;
      const threshold = document.documentElement.scrollHeight - 100;
      if (scrollBottom >= threshold) {
        setHasReachedBottom(true);
      }
    };

    // Poll until the PDF has actually rendered and the page is scrollable.
    // Before that, scrollHeight ≈ innerHeight so the check would pass instantly.
    let lastHeight = 0;
    let stableCount = 0;

    const interval = setInterval(() => {
      const docHeight = document.documentElement.scrollHeight;
      const viewportHeight = window.innerHeight;

      if (docHeight > viewportHeight + 200) {
        clearInterval(interval);
        scrollListenerAdded = true;
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
      } else {
        if (docHeight === lastHeight && docHeight > 0) {
          stableCount++;
          if (stableCount >= 6) {
            clearInterval(interval);
            setHasReachedBottom(true);
          }
        } else {
          stableCount = 0;
          lastHeight = docHeight;
        }
      }
    }, 300);

    return () => {
      clearInterval(interval);
      if (scrollListenerAdded) {
        window.removeEventListener('scroll', onScroll);
      }
    };
  }, [showSign, hasReachedBottom]);

  useEffect(() => {
    if (!url) {
      setError('No PDF URL provided');
      return;
    }

    try {
      // `useSearchParams().get()` already returns a decoded value.
      // Decoding again can alter signed query values and break access.
      const normalizedUrl = url.trim();
      const parsed = new URL(normalizedUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Unsupported PDF URL protocol');
      }
      setPdfUrl(normalizedUrl);
    } catch {
      setError('Invalid PDF URL');
    }
  }, [url]);

  if (error || !pdfUrl) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <div className="max-w-md w-full bg-slate-800 rounded-lg p-8 text-center space-y-4">
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-red-900/20 mx-auto">
            <AlertCircle className="h-8 w-8 text-red-400" />
          </div>
          <h2 className="text-xl font-bold text-white">Unable to load PDF</h2>
          <p className="text-muted-foreground">{error || 'An unknown error occurred'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full" style={{ overscrollBehavior: 'contain' }}>
      <div className={`px-2 sm:px-4 ${showSign ? 'pb-32' : 'pb-8'}`}>
        <PDFCanvasRenderer url={pdfUrl} />
      </div>

      {showSign && (
        <button
          disabled={!hasReachedBottom}
          onClick={() => {
            const sep = returnUrl.includes('?') ? '&' : '?';
            router.push(`${returnUrl}${sep}openSign=1`);
          }}
          className={`fixed bottom-0 inset-x-0 z-50 flex min-h-24 flex-wrap items-center justify-center gap-2 px-4 py-4 text-center text-base font-medium text-white transition-colors duration-200 ${
            hasReachedBottom
              ? 'bg-green-600 hover:bg-green-700 active:bg-green-800'
              : 'bg-gray-500 cursor-not-allowed opacity-70'
          }`}
        >
          <CheckCircle2 className="h-5 w-5" />
          {hasReachedBottom
            ? 'I have read and understood - Sign Document'
            : 'Scroll to bottom to sign'}
        </button>
      )}
    </div>
  );
}

export default function PDFViewerPage() {
  return (
    <Suspense fallback={<PageLoader message="Loading PDF viewer..." />}>
      <PDFViewerContent />
    </Suspense>
  );
}
