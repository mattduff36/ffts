import { describe, expect, it } from 'vitest';
import {
  getPdfLoadMessage,
  isExpectedPdfLoadError,
  isExpectedPdfRenderError,
} from '@/lib/pdf/render-errors';

describe('isExpectedPdfRenderError', () => {
  it('returns true for RenderingCancelledException by name', () => {
    const error = new Error('Some PDF render error');
    error.name = 'RenderingCancelledException';

    expect(isExpectedPdfRenderError(error)).toBe(true);
  });

  it('returns true for rendering cancelled message', () => {
    const error = new Error('Rendering cancelled, page 8');

    expect(isExpectedPdfRenderError(error)).toBe(true);
  });

  it('returns true for transport destroyed teardown errors', () => {
    const error = new Error('Transport destroyed');

    expect(isExpectedPdfRenderError(error)).toBe(true);
  });

  it('returns false for non-cancellation render errors', () => {
    const error = new Error('Failed to fetch');

    expect(isExpectedPdfRenderError(error)).toBe(false);
  });

  it('returns false for non-error values', () => {
    expect(isExpectedPdfRenderError('Rendering cancelled')).toBe(false);
    expect(isExpectedPdfRenderError(null)).toBe(false);
  });
});

describe('isExpectedPdfLoadError', () => {
  it('returns true for invalid PDF structure errors', () => {
    const error = new Error('Invalid PDF structure.');
    error.name = 'InvalidPDFException';

    expect(isExpectedPdfLoadError(error)).toBe(true);
    expect(getPdfLoadMessage(error)).toBe('This PDF could not be opened. Please regenerate the document and try again.');
  });

  it('returns true for expected HTTP PDF load responses', () => {
    const error = new Error('Unexpected server response (403) while retrieving PDF');

    expect(isExpectedPdfLoadError(error)).toBe(true);
    expect(getPdfLoadMessage(error)).toBe('This PDF link has expired or is unavailable. Please reopen the document and try again.');
  });

  it('returns true for transient HTTP PDF load responses', () => {
    const error = new Error('Unexpected server response (504) while retrieving PDF');

    expect(isExpectedPdfLoadError(error)).toBe(true);
    expect(getPdfLoadMessage(error)).toBe('The PDF service did not respond in time. Please try reopening the document.');
  });

  it('returns true for transient browser PDF network failures', () => {
    const error = new Error('Load failed');
    error.name = 'UnknownErrorException';

    expect(isExpectedPdfLoadError(error)).toBe(true);
    expect(getPdfLoadMessage(error)).toBe('Unable to load PDF. Please check your connection and try again.');
  });
});
