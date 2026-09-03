import { describe, expect, it } from 'vitest';
import {
  getSchedulingViewportFit,
  getRemainingViewportHeight,
  SCHEDULING_BOARD_MIN_CONTENT_WIDTH_PX,
  SCHEDULING_BOARD_MIN_SCALE,
} from '@/app/(dashboard)/scheduling/components/scheduling-viewport-fit';

describe('getSchedulingViewportFit', () => {
  it('uses full size when the content area is at least the min width', () => {
    expect(
      getSchedulingViewportFit({
        availableWidth: SCHEDULING_BOARD_MIN_CONTENT_WIDTH_PX,
        minContentWidth: SCHEDULING_BOARD_MIN_CONTENT_WIDTH_PX,
        isMobile: false,
      })
    ).toEqual({ mode: 'full', scale: 1 });
    expect(
      getSchedulingViewportFit({
        availableWidth: 1920,
        minContentWidth: SCHEDULING_BOARD_MIN_CONTENT_WIDTH_PX,
        isMobile: false,
      })
    ).toEqual({ mode: 'full', scale: 1 });
  });

  it('scales between 67% and 100% so the min width stays visible', () => {
    const availableWidth = Math.round(SCHEDULING_BOARD_MIN_CONTENT_WIDTH_PX * 0.8);
    expect(
      getSchedulingViewportFit({
        availableWidth,
        minContentWidth: SCHEDULING_BOARD_MIN_CONTENT_WIDTH_PX,
        isMobile: false,
      })
    ).toEqual({
      mode: 'scaled',
      scale: availableWidth / SCHEDULING_BOARD_MIN_CONTENT_WIDTH_PX,
    });
  });

  it('allows exactly the 67% floor as scaled', () => {
    const availableWidth = SCHEDULING_BOARD_MIN_CONTENT_WIDTH_PX * SCHEDULING_BOARD_MIN_SCALE;
    expect(
      getSchedulingViewportFit({
        availableWidth,
        minContentWidth: SCHEDULING_BOARD_MIN_CONTENT_WIDTH_PX,
        isMobile: false,
      })
    ).toEqual({
      mode: 'scaled',
      scale: SCHEDULING_BOARD_MIN_SCALE,
    });
  });

  it('blocks below the 67% zoom floor', () => {
    const availableWidth = SCHEDULING_BOARD_MIN_CONTENT_WIDTH_PX * SCHEDULING_BOARD_MIN_SCALE - 1;
    const fit = getSchedulingViewportFit({
      availableWidth,
      minContentWidth: SCHEDULING_BOARD_MIN_CONTENT_WIDTH_PX,
      isMobile: false,
    });
    expect(fit.mode).toBe('blocked');
    expect(fit.scale).toBeLessThan(SCHEDULING_BOARD_MIN_SCALE);
  });

  it('blocks mobile even when the content area is wide', () => {
    expect(
      getSchedulingViewportFit({
        availableWidth: 1920,
        minContentWidth: SCHEDULING_BOARD_MIN_CONTENT_WIDTH_PX,
        isMobile: true,
      })
    ).toEqual({ mode: 'blocked', scale: 0 });
  });

  it('stays full while the content area width is not yet measured', () => {
    expect(
      getSchedulingViewportFit({
        availableWidth: 0,
        minContentWidth: SCHEDULING_BOARD_MIN_CONTENT_WIDTH_PX,
        isMobile: false,
      })
    ).toEqual({ mode: 'full', scale: 1 });
  });
});

describe('getRemainingViewportHeight', () => {
  it('fills from the element top to the viewport bottom minus inset', () => {
    expect(
      getRemainingViewportHeight({
        top: 120,
        viewportHeight: 900,
        bottomInset: 32,
      })
    ).toBe(748);
  });

  it('does not return a negative height', () => {
    expect(
      getRemainingViewportHeight({
        top: 900,
        viewportHeight: 800,
        bottomInset: 32,
      })
    ).toBe(0);
  });
});
