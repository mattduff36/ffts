/// <reference types="@testing-library/jest-dom/vitest" />
/** @vitest-environment happy-dom */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import PDFViewerPage from '@/app/(dashboard)/pdf-viewer/page';
const state = vi.hoisted(() => ({ params: new URLSearchParams(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => state.params, useRouter: () => ({ push: state.push }) }));
vi.mock('@/components/pdf/PDFCanvasRenderer', () => ({ PDFCanvasRenderer: ({ url, renderMode }: { url: string; renderMode: string }) => <div data-testid="pdf-mode" data-url={url}>{renderMode}</div> }));
const signedUrl = 'https://fixture.test/file.pdf?token=a%2Fb&encoded=%2525';
let scrollY = 0;
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); scrollY = 0;
  state.params = new URLSearchParams({ url: signedUrl });
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(1000);
  vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scrollY);
  vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(3000);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe('PDF viewer rendering mode', () => {
  it('uses viewport mode for an ordinary preview and preserves signed URL bytes', async () => {
    render(<PDFViewerPage />);
    expect(screen.getByTestId('pdf-mode')).toHaveTextContent('viewport');
    expect(screen.getByTestId('pdf-mode')).toHaveAttribute('data-url', signedUrl);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('keeps signing in all-pages mode and requires reaching the bottom before safe navigation', async () => {
    state.params.set('sign', '1'); state.params.set('return', '/rams?document=fixture');
    render(<PDFViewerPage />);
    expect(screen.getByTestId('pdf-mode')).toHaveTextContent('all');
    expect(screen.getByRole('button')).toBeDisabled();
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(screen.getByRole('button')).toBeDisabled();
    scrollY = 2200; fireEvent.scroll(window);
    expect(screen.getByRole('button')).toBeEnabled(); fireEvent.click(screen.getByRole('button'));
    expect(state.push).toHaveBeenCalledWith('/rams?document=fixture&openSign=1');
  });
  it('retains the safe fallback for external return URLs', async () => {
    state.params.set('sign', '1'); state.params.set('return', 'https://untrusted.test/');
    render(<PDFViewerPage />); await act(async () => { vi.advanceTimersByTime(300); });
    scrollY = 2200; fireEvent.scroll(window); fireEvent.click(screen.getByRole('button'));
    expect(state.push).toHaveBeenCalledWith('/rams?openSign=1');
  });
  it('continues rejecting non-http PDF URLs', () => {
    state.params.set('url', 'javascript:alert(1)'); render(<PDFViewerPage />);
    expect(screen.getByText('Invalid PDF URL')).toBeInTheDocument();
    expect(screen.queryByTestId('pdf-mode')).not.toBeInTheDocument();
  });
});
