'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { AlertCircle } from 'lucide-react';
import { PanelLoader } from '@/components/ui/panel-loader';
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist';
import { getPdfLoadMessage, isExpectedPdfLoadError, isExpectedPdfRenderError } from '@/lib/pdf/render-errors';

type PdfjsLib = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (src: { url: string; useSystemFonts?: boolean }) => PDFDocumentLoadingTask;
};

let pdfjsCache: PdfjsLib | null = null;

function ensurePromiseWithResolvers(): void {
  const promiseWithResolvers = (Promise as PromiseConstructor & {
    withResolvers?: <T>() => {
      promise: Promise<T>;
      resolve: (value: T | PromiseLike<T>) => void;
      reject: (reason?: unknown) => void;
    };
  }).withResolvers;

  if (typeof promiseWithResolvers === 'function') {
    return;
  }

  (Promise as PromiseConstructor & {
    withResolvers?: <T>() => {
      promise: Promise<T>;
      resolve: (value: T | PromiseLike<T>) => void;
      reject: (reason?: unknown) => void;
    };
  }).withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

async function getPdfjs(): Promise<PdfjsLib> {
  if (pdfjsCache) return pdfjsCache;
  ensurePromiseWithResolvers();
  // webpackIgnore makes the browser's native ESM loader handle this import
  // instead of Webpack, which avoids the "Object.defineProperty on non-object" bug.
  const moduleUrl = '/pdf.min.mjs';
  const pdfjs = await import(/* webpackIgnore: true */ /* @vite-ignore */ moduleUrl) as PdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  pdfjsCache = pdfjs;
  return pdfjs;
}

interface PDFCanvasRendererProps {
  url: string;
  className?: string;
  renderMode?: 'all' | 'viewport';
}

export function PDFCanvasRenderer({ url, className, renderMode = 'all' }: PDFCanvasRendererProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderIdRef = useRef(0);
  const activeRenderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const settlingViewportRender = useRef<Promise<unknown>>(Promise.resolve());

  const useViewport = renderMode === 'viewport' && typeof IntersectionObserver !== 'undefined';

  useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    let document: PDFDocumentProxy | null = null;
    renderIdRef.current += 1;
    activeRenderTaskRef.current?.cancel();
    activeRenderTaskRef.current = null;
    setPdfDoc(null);
    setPageCount(0);

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const pdfjs = await getPdfjs();
        if (cancelled) return;
        loadingTask = pdfjs.getDocument({ url, useSystemFonts: true });
        const doc = await loadingTask.promise;
        document = doc;
        if (cancelled) {
          void doc.destroy().catch(() => undefined);
          return;
        }
        if (doc.numPages < 1) throw new Error('This PDF contains no pages.');
        setDocumentUrl(url);
        setPdfDoc(doc);
        setPageCount(doc.numPages);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          if (!isExpectedPdfLoadError(err)) {
            console.error('Failed to load PDF document:', err);
          }
          setError(getPdfLoadMessage(err));
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
      renderIdRef.current += 1;
      activeRenderTaskRef.current?.cancel();
      activeRenderTaskRef.current = null;
      if (document) void document.destroy().catch(() => undefined);
      else if (loadingTask) void loadingTask.destroy().catch(() => undefined);
    };
  }, [url]);

  const lastWidthRef = useRef(0);

  const renderPages = useCallback(async () => {
    if (useViewport || !pdfDoc || !containerRef.current) return;

    activeRenderTaskRef.current?.cancel();
    activeRenderTaskRef.current = null;

    const id = ++renderIdRef.current;
    await settlingViewportRender.current.catch(() => undefined);
    if (renderIdRef.current !== id) return;
    const container = containerRef.current;
    const containerWidth = container.clientWidth;
    if (containerWidth === 0) return;

    lastWidthRef.current = containerWidth;
    container.innerHTML = '';

    const dpr = window.devicePixelRatio || 1;

    try {
      for (let num = 1; num <= pdfDoc.numPages; num++) {
        if (renderIdRef.current !== id) return;

        const page = await pdfDoc.getPage(num);
        if (renderIdRef.current !== id) return;
        const unscaledViewport = page.getViewport({ scale: 1 });
        const scale = containerWidth / unscaledViewport.width;
        const viewport = page.getViewport({ scale: scale * dpr });

        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${containerWidth}px`;
        canvas.style.height = `${(viewport.height / dpr).toFixed(0)}px`;
        canvas.className = 'block';

        const ctx = canvas.getContext('2d');
        if (!ctx) continue;

        const renderTask = page.render({ canvasContext: ctx, viewport });
        activeRenderTaskRef.current = renderTask;
        settlingViewportRender.current = renderTask.promise;
        await renderTask.promise;

        if (activeRenderTaskRef.current === renderTask) {
          activeRenderTaskRef.current = null;
        }

        if (renderIdRef.current !== id) return;
        container.appendChild(canvas);
      }
    } catch (error) {
      if (renderIdRef.current !== id || isExpectedPdfRenderError(error)) return;
      console.error('Failed to render PDF page:', error);
      setError('Failed to render PDF');
    } finally {
      if (renderIdRef.current === id) activeRenderTaskRef.current = null;
    }
  }, [pdfDoc, useViewport]);

  useEffect(() => {
    if (loading || !pdfDoc) return;
    void renderPages();
    return () => {
      renderIdRef.current += 1;
      activeRenderTaskRef.current?.cancel();
      activeRenderTaskRef.current = null;
    };
  }, [loading, pdfDoc, renderPages]);

  useEffect(() => {
    if (loading || !pdfDoc) return;

    let resizeTimer: ReturnType<typeof setTimeout>;
    const handleResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!containerRef.current) return;
        const newWidth = containerRef.current.clientWidth;
        // Skip re-render when width hasn't actually changed (mobile
        // browsers fire resize when the URL bar hides/shows on scroll,
        // which only changes height — re-rendering here would destroy
        // all canvases and jump the scroll position to the top).
        if (Math.abs(newWidth - lastWidthRef.current) < 2) return;
        void renderPages();
      }, 200);
    };

    window.addEventListener('resize', handleResize);
    return () => {
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', handleResize);
    };
  }, [loading, pdfDoc, renderPages]);

  if (loading || (!error && documentUrl !== url)) {
    return <PanelLoader message="Loading PDF..." className="py-16" />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-red-400">
        <AlertCircle className="h-8 w-8" />
        <span className="text-sm text-center max-w-xs">{error}</span>
      </div>
    );
  }

  return (
    <div className={className}>
      {pageCount > 0 && (
        <div className="text-center text-xs text-muted-foreground py-2">
          {pageCount} {pageCount === 1 ? 'page' : 'pages'}
        </div>
      )}
      {useViewport && pdfDoc ? (
        <ViewportPDFPages key={url} pdfDoc={pdfDoc} settlingRender={settlingViewportRender} />
      ) : <div ref={containerRef} className="w-full space-y-1" />}
    </div>
  );
}


interface PageDimensions { width: number; height: number }

function ViewportPDFPages({ pdfDoc, settlingRender }: { pdfDoc: PDFDocumentProxy; settlingRender: { current: Promise<unknown> } }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const generationRef = useRef(0);
  const activeTask = useRef<RenderTask | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const container = element;
    let disposed = false;
    let dimensions: PageDimensions[] = [];
    let placeholders: HTMLDivElement[] = [];
    let observer: IntersectionObserver | null = null;
    let resizeTimer: ReturnType<typeof setTimeout>;
    let lastWidth = 0;
    const visible = new Set<number>([0]);
    const canvases = new Map<number, HTMLCanvasElement>();
    const cancelledTasks = new WeakSet<RenderTask>();
    const cancelActiveTask = () => {
      if (!activeTask.current) return;
      cancelledTasks.add(activeTask.current);
      activeTask.current.cancel();
    };

    const releaseCanvas = (index: number) => {
      const canvas = canvases.get(index);
      if (!canvas) return;
      canvas.width = 0;
      canvas.height = 0;
      canvas.remove();
      canvases.delete(index);
    };

    function rebuild(width: number) {
      if (disposed || width <= 0 || dimensions.length === 0) return;
      const anchorIndex = placeholders.findIndex((placeholder) => {
        const rect = placeholder.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < window.innerHeight;
      });
      const anchor = anchorIndex >= 0 ? placeholders[anchorIndex].getBoundingClientRect() : null;
      const anchorOffset = anchor && anchor.height > 0 ? -anchor.top / anchor.height : 0;
      const resizing = lastWidth > 0;
      const generation = ++generationRef.current;
      cancelActiveTask();
      observer?.disconnect();
      for (const index of canvases.keys()) releaseCanvas(index);
      lastWidth = width;
      const failed = new Set<number>();
      let wanted = new Set<number>();
      let runningIndex: number | null = null;
      let pumping = false;
      const current = () => !disposed && generation === generationRef.current;

      if (placeholders.length === 0) {
        placeholders = dimensions.map((_, index) => {
          const placeholder = document.createElement('div');
          placeholder.dataset.pdfPage = String(index + 1);
          placeholder.setAttribute('aria-label', `Page ${index + 1}`);
          placeholder.className = 'relative bg-white';
          container.appendChild(placeholder);
          return placeholder;
        });
      }
      placeholders.forEach((placeholder, index) => {
        placeholder.replaceChildren();
        placeholder.style.width = `${width}px`;
        placeholder.style.height = `${width * dimensions[index].height / dimensions[index].width}px`;
      });
      if (resizing && anchor) {
        const rect = placeholders[anchorIndex].getBoundingClientRect();
        window.scrollBy({ top: rect.top + anchorOffset * rect.height, behavior: 'auto' });
      }

      async function pump() {
        if (pumping || !current()) return;
        pumping = true;
        try {
          // A cancelled task must settle before another generation rasterises.
          await settlingRender.current.catch(() => undefined);
          while (current()) {
            const index = [...wanted].find((page) => !canvases.has(page) && !failed.has(page));
            if (index === undefined) break;
            runningIndex = index;
            let page: Awaited<ReturnType<PDFDocumentProxy['getPage']>> | null = null;
            let task: RenderTask | null = null;
            try {
              page = await pdfDoc.getPage(index + 1);
              if (!current() || !wanted.has(index)) continue;
              const dpr = window.devicePixelRatio || 1;
              const viewport = page.getViewport({ scale: width / dimensions[index].width * dpr });
              const canvas = document.createElement('canvas');
              canvas.width = viewport.width;
              canvas.height = viewport.height;
              canvas.style.width = `${width}px`;
              canvas.style.height = placeholders[index].style.height;
              canvas.className = 'block';
              const context = canvas.getContext('2d');
              if (!context) throw new Error('Canvas rendering is unavailable.');
              placeholders[index].replaceChildren(canvas);
              canvases.set(index, canvas);
              task = page.render({ canvasContext: context, viewport });
              activeTask.current = task;
              settlingRender.current = task.promise;
              await task.promise;
            } catch (failure) {
              if (!current() || !wanted.has(index)) continue;
              releaseCanvas(index);
              if (task && cancelledTasks.has(task) && isExpectedPdfRenderError(failure)) continue;
              failed.add(index);
              const notice = document.createElement('div');
              notice.setAttribute('role', 'alert');
              notice.className = 'p-4 text-red-600';
              notice.textContent = `Failed to render page ${index + 1}. Please reopen the document.`;
              placeholders[index].replaceChildren(notice);
              if (!isExpectedPdfRenderError(failure)) console.error('Failed to render PDF page:', failure);
            } finally {
              if (activeTask.current === task) activeTask.current = null;
              runningIndex = null;
              page?.cleanup();
            }
          }
        } finally {
          pumping = false;
        }
      }

      function updateWindow() {
        // Visible pages first, then only two neighbours on either side.
        wanted = new Set(visible);
        for (const index of visible) {
          for (let neighbour = Math.max(0, index - 2); neighbour <= Math.min(placeholders.length - 1, index + 2); neighbour++) wanted.add(neighbour);
        }
        if (runningIndex !== null && !wanted.has(runningIndex)) cancelActiveTask();
        for (const index of canvases.keys()) if (!wanted.has(index)) releaseCanvas(index);
        void pump();
      }

      observer = new IntersectionObserver((entries) => {
        if (!current()) return;
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset.pdfPage) - 1;
          if (entry.isIntersecting) visible.add(index);
          else visible.delete(index);
        }
        updateWindow();
      }, { rootMargin: '0px' });
      for (const placeholder of placeholders) observer.observe(placeholder);
      updateWindow();
    }

    async function prepare() {
      try {
        const nextDimensions: PageDimensions[] = [];
        for (let index = 1; index <= pdfDoc.numPages; index++) {
          const page = await pdfDoc.getPage(index);
          if (disposed) { page.cleanup(); return; }
          const viewport = page.getViewport({ scale: 1 });
          if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0) throw new Error('Invalid PDF page dimensions.');
          nextDimensions.push({ width: viewport.width, height: viewport.height });
          page.cleanup();
        }
        dimensions = nextDimensions;
        rebuild(container.clientWidth);
      } catch (failure) {
        if (!disposed) setError(getPdfLoadMessage(failure));
      }
    }

    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const width = container.clientWidth;
        if (Math.abs(width - lastWidth) < 2) return;
        rebuild(width);
      }, 200);
    };
    void prepare();
    window.addEventListener('resize', onResize);
    return () => {
      disposed = true;
      generationRef.current += 1;
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
      observer?.disconnect();
      cancelActiveTask();
      for (const index of canvases.keys()) releaseCanvas(index);
      container.replaceChildren();
    };
  }, [pdfDoc, settlingRender]);

  return <>
    {error ? <div role="alert" className="p-4 text-red-400">{error}</div> : null}
    <div ref={containerRef} className="w-full space-y-1" style={{ overflowAnchor: 'none' }} />
  </>;
}
