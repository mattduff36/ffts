/// <reference types="@testing-library/jest-dom/vitest" />
/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { PDFCanvasRenderer } from '@/components/pdf/PDFCanvasRenderer';

const pdfBoundary = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock('/pdf.min.mjs', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: pdfBoundary.getDocument }));

let width = 600;
let scrollY = 0;
let autoRender = true;
let delayCancellation = false;
let activeRenders = 0;
let maxActiveRenders = 0;
let failRenderPage = 0;
const rendered: number[] = [];
const pendingRenders: { page: number; finish: () => void; finishCancel: () => void; cancel: ReturnType<typeof vi.fn> }[] = [];
const observers: MockIntersectionObserver[] = [];
class MockIntersectionObserver {
  targets: Element[] = [];
  disconnect = vi.fn(() => { this.targets = []; });
  constructor(private callback: IntersectionObserverCallback, readonly options: IntersectionObserverInit) { observers.push(this); }
  observe(target: Element) { this.targets.push(target); }
  unobserve(target: Element) { this.targets = this.targets.filter(x => x !== target); }
  show(pages: number[]) {
    this.callback(this.targets.map(target => ({ target, isIntersecting: pages.includes(Number((target as HTMLElement).dataset.pdfPage)), boundingClientRect: target.getBoundingClientRect() })) as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
  }
}
function fixture(pageCount = 30) {
  const pages = Array.from({ length: pageCount }, (_, index) => ({
    cleanup: vi.fn(),
    getViewport: ({ scale }: { scale: number }) => ({ width: (index % 2 ? 800 : 600) * scale, height: (index % 2 ? 600 : 800) * scale }),
    render: vi.fn(() => {
      rendered.push(index + 1); activeRenders++; maxActiveRenders = Math.max(maxActiveRenders, activeRenders);
      let resolve!: () => void; let reject!: (error: Error) => void;
      const source = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
      const promise = source.finally(() => { activeRenders--; });
      const finishCancel = () => { const failure = new Error('Rendering cancelled'); failure.name = 'RenderingCancelledException'; reject(failure); };
      const cancel = vi.fn(() => { if (!delayCancellation) finishCancel(); });
      pendingRenders.push({ page: index + 1, finish: resolve, finishCancel, cancel });
      if (index + 1 === failRenderPage) reject(new Error('Rasterisation failed'));
      else if (autoRender) resolve();
      return { promise, cancel };
    }),
  }));
  const doc = { numPages: pageCount, getPage: vi.fn(async (page: number) => pages[page - 1]), destroy: vi.fn(async () => {}) };
  const task = { promise: Promise.resolve(doc), destroy: vi.fn(async () => {}) };
  return { doc, task, pages };
}
let documentFixture: ReturnType<typeof fixture>;
function holders(container: HTMLElement) { return [...container.querySelectorAll<HTMLElement>('[data-pdf-page]')]; }
function canvasPages(container: HTMLElement) { return holders(container).filter(x => x.querySelector('canvas')).map(x => Number(x.dataset.pdfPage)); }
async function settledPages(container: HTMLElement, pages: number[]) { await waitFor(() => expect(canvasPages(container).sort((a,b) => a-b)).toEqual(pages)); }
async function show(pages: number[]) { await act(async () => { observers.at(-1)!.show(pages); }); }

beforeEach(() => {
  vi.clearAllMocks(); width = 600; scrollY = 0; autoRender = true; delayCancellation = false; activeRenders = 0; maxActiveRenders = 0; failRenderPage = 0;
  rendered.length = 0; pendingRenders.length = 0; observers.length = 0;
  documentFixture = fixture(); pdfBoundary.getDocument.mockImplementation(() => documentFixture.task);
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    let top = -scrollY;
    if (this.dataset.pdfPage) {
      for (const sibling of [...(this.parentElement?.children || [])]) {
        if (sibling === this) break;
        top += Number.parseFloat((sibling as HTMLElement).style.height || '0') + 4;
      }
    }
    const height = Number.parseFloat(this.style.height || '0');
    return { top, bottom: top + height, left: 0, right: width, width, height, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
  vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scrollY);
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(1000);
  vi.spyOn(window, 'scrollBy').mockImplementation((options: ScrollToOptions | number, y?: number) => { scrollY += typeof options === 'number' ? y || 0 : options.top || 0; });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('progressive PDF canvases', () => {
  it('creates all mixed-size ordered placeholders but rasterises only the initial window', async () => {
    const { container } = render(<PDFCanvasRenderer url="https://fixture.test/long.pdf" renderMode="viewport" />);
    await settledPages(container, [1,2,3]);
    expect(holders(container)).toHaveLength(30);
    expect(holders(container).map(x => x.dataset.pdfPage)).toEqual(Array.from({ length: 30 }, (_, i) => String(i+1)));
    expect(holders(container)[0].style.height).toBe('800px');
    expect(holders(container)[1].style.height).toBe('450px');
    expect(rendered).toEqual([1,2,3]); expect(maxActiveRenders).toBe(1);
    expect(observers[0].options.rootMargin).toBe('0px');
  });

  it('jumps, releases off-window canvas buffers and renders pages again on re-entry', async () => {
    const { container } = render(<PDFCanvasRenderer url="https://fixture.test/long.pdf" renderMode="viewport" />);
    await settledPages(container, [1,2,3]);
    const oldCanvases = [...container.querySelectorAll('canvas')];
    await show([15]); await settledPages(container, [13,14,15,16,17]);
    expect(oldCanvases.every(canvas => canvas.width === 0 && canvas.height === 0 && !canvas.isConnected)).toBe(true);
    await show([15,16]); await settledPages(container, [13,14,15,16,17,18]);
    expect(container.querySelectorAll('canvas')).toHaveLength(2+4);
    await show([1]); await settledPages(container, [1,2,3]);
    expect(rendered.filter(page => page === 1)).toHaveLength(2); expect(maxActiveRenders).toBe(1);
  });

  it('cancels a busy page on a rapid jump and keeps one active render', async () => {
    autoRender = false;
    const { container } = render(<PDFCanvasRenderer url="https://fixture.test/long.pdf" renderMode="viewport" />);
    await waitFor(() => expect(pendingRenders).toHaveLength(1));
    await show([20]);
    await waitFor(() => expect(pendingRenders).toHaveLength(2));
    expect(pendingRenders[0].cancel).toHaveBeenCalled();
    expect(pendingRenders[1].page).toBe(20);
    autoRender = true; await act(async () => { pendingRenders[1].finish(); });
    await settledPages(container, [18,19,20,21,22]); expect(maxActiveRenders).toBe(1);
  });

  it('requeues a cancelled page when jumping back before cancellation settles', async () => {
    autoRender = false; delayCancellation = true;
    const { container } = render(<PDFCanvasRenderer url="https://fixture.test/long.pdf" renderMode="viewport" />);
    await waitFor(() => expect(pendingRenders).toHaveLength(1));
    await show([20]); await show([1]);
    expect(pendingRenders).toHaveLength(1); expect(pendingRenders[0].cancel).toHaveBeenCalled();
    autoRender = true; await act(async () => { pendingRenders[0].finishCancel(); });
    await settledPages(container, [1,2,3]); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(maxActiveRenders).toBe(1);
  });

  it('waits for delayed cancellation across URL replacement before starting the new document render', async () => {
    autoRender = false; delayCancellation = true;
    const view = render(<PDFCanvasRenderer url="https://fixture.test/old.pdf" renderMode="viewport" />);
    await waitFor(() => expect(pendingRenders).toHaveLength(1));
    const old = documentFixture; documentFixture = fixture(2);
    view.rerender(<PDFCanvasRenderer url="https://fixture.test/replacement.pdf" renderMode="viewport" />);
    await waitFor(() => expect(holders(view.container)).toHaveLength(2));
    expect(old.doc.destroy).toHaveBeenCalled(); expect(pendingRenders).toHaveLength(1);
    autoRender = true; await act(async () => { pendingRenders[0].finishCancel(); });
    await settledPages(view.container, [1,2]); expect(maxActiveRenders).toBe(1);
  });

  it('does not render a deferred getPage completion from an obsolete document', async () => {
    let finishPage!: (page: typeof documentFixture.pages[number]) => void;
    const old = documentFixture;
    const getPage = old.doc.getPage.getMockImplementation()!;
    old.doc.getPage.mockImplementation(async page => {
      if (old.doc.getPage.mock.calls.length === 31) return new Promise(resolve => { finishPage = resolve; });
      return getPage(page);
    });
    const view = render(<PDFCanvasRenderer url="https://fixture.test/old.pdf" renderMode="viewport" />);
    await waitFor(() => expect(old.doc.getPage).toHaveBeenCalledTimes(31));
    documentFixture = fixture(2);
    view.rerender(<PDFCanvasRenderer url="https://fixture.test/replacement.pdf" renderMode="viewport" />);
    await settledPages(view.container, [1,2]);
    await act(async () => { finishPage(old.pages[0]); });
    expect(old.pages[0].render).not.toHaveBeenCalled(); expect(holders(view.container)).toHaveLength(2);
    expect(canvasPages(view.container)).toEqual([1,2]); expect(maxActiveRenders).toBe(1);
  });

  it('ignores sub-2px width changes and preserves the visible page fraction on real resize', async () => {
    const { container } = render(<PDFCanvasRenderer url="https://fixture.test/long.pdf" renderMode="viewport" />);
    await settledPages(container, [1,2,3]); await show([5]); await settledPages(container, [3,4,5,6,7]);
    const anchor = holders(container)[4]; scrollY += anchor.getBoundingClientRect().top + 200;
    const originalCanvas = anchor.querySelector('canvas'); const before = rendered.length;
    width = 601; act(() => window.dispatchEvent(new Event('resize')));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 230)); });
    expect(rendered).toHaveLength(before); expect(anchor.querySelector('canvas')).toBe(originalCanvas);
    width = 900; act(() => window.dispatchEvent(new Event('resize')));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 230)); });
    await settledPages(container, [3,4,5,6,7]);
    expect(holders(container)[4]).toBe(anchor);
    expect(anchor.style.height).toBe('1200px');
    expect(-anchor.getBoundingClientRect().top / anchor.getBoundingClientRect().height).toBeCloseTo(0.25);
    expect(window.scrollBy).toHaveBeenCalled(); expect(maxActiveRenders).toBe(1);
  });

  it('cancels renders and destroys the replaced document without stale canvases', async () => {
    autoRender = false;
    const view = render(<PDFCanvasRenderer url="https://fixture.test/old.pdf" renderMode="viewport" />);
    await waitFor(() => expect(pendingRenders).toHaveLength(1));
    const oldDoc = documentFixture; documentFixture = fixture(2); autoRender = true;
    view.rerender(<PDFCanvasRenderer url="https://fixture.test/new.pdf" renderMode="viewport" />);
    await settledPages(view.container, [1,2]);
    expect(oldDoc.doc.destroy).toHaveBeenCalledTimes(1);
    expect(pendingRenders[0].cancel).toHaveBeenCalled();
    expect(holders(view.container)).toHaveLength(2); expect(maxActiveRenders).toBe(1);
    view.unmount(); expect(documentFixture.doc.destroy).toHaveBeenCalledTimes(1);
    expect(observers.every(observer => observer.disconnect.mock.calls.length > 0)).toBe(true);
  });

  it('destroys a pending loading task and ignores its late document', async () => {
    let finishLoad!: (doc: typeof documentFixture.doc) => void;
    const loading = { promise: new Promise(resolve => { finishLoad = resolve; }), destroy: vi.fn(async () => {}) };
    pdfBoundary.getDocument.mockReturnValueOnce(loading);
    const view = render(<PDFCanvasRenderer url="https://fixture.test/pending.pdf" renderMode="viewport" />);
    await waitFor(() => expect(pdfBoundary.getDocument).toHaveBeenCalledTimes(1));
    view.unmount(); expect(loading.destroy).toHaveBeenCalledTimes(1);
    await act(async () => { finishLoad(documentFixture.doc); });
    expect(documentFixture.doc.destroy).toHaveBeenCalledTimes(1); expect(rendered).toHaveLength(0);
  });

  it('reports rasterisation failures in the affected placeholder instead of leaving it blank', async () => {
    failRenderPage = 2; const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(<PDFCanvasRenderer url="https://fixture.test/long.pdf" renderMode="viewport" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to render page 2');
    await waitFor(() => expect(canvasPages(container)).toEqual([1,3]));
    expect(holders(container)[1].style.height).toBe('450px'); expect(consoleError).toHaveBeenCalled();
  });

  it('reports empty and invalid documents', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    documentFixture = fixture(0);
    const view = render(<PDFCanvasRenderer url="https://fixture.test/empty.pdf" renderMode="viewport" />);
    expect(await screen.findByText('This PDF contains no pages.')).toBeInTheDocument();
    const invalid = new Error('Invalid PDF structure.'); invalid.name = 'InvalidPDFException';
    pdfBoundary.getDocument.mockReturnValueOnce({ promise: Promise.reject(invalid), destroy: vi.fn(async () => {}) });
    view.rerender(<PDFCanvasRenderer url="https://fixture.test/invalid.pdf" renderMode="viewport" />);
    expect(await screen.findByText('This PDF could not be opened. Please regenerate the document and try again.')).toBeInTheDocument();
  });

  it.each(['default', 'fallback'] as const)('preserves all-pages rendering for %s', async mode => {
    documentFixture = fixture(6);
    if (mode === 'fallback') vi.stubGlobal('IntersectionObserver', undefined);
    const { container } = render(<PDFCanvasRenderer url="https://fixture.test/all.pdf" renderMode={mode === 'fallback' ? 'viewport' : undefined} />);
    await waitFor(() => expect(container.querySelectorAll('canvas')).toHaveLength(6));
    expect(rendered).toEqual([1,2,3,4,5,6]); expect(observers).toHaveLength(0);
  });
});
