'use client';

import { useEffect } from 'react';

function isNumericInput(target: EventTarget | null): target is HTMLInputElement {
  return target instanceof HTMLInputElement && target.type === 'number';
}

function scrollWheelTarget(target: HTMLElement, deltaY: number) {
  let node: HTMLElement | null = target.parentElement;

  while (node) {
    const { overflowY } = window.getComputedStyle(node);
    const allowsScroll = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
    if (allowsScroll && node.scrollHeight > node.clientHeight) {
      const previous = node.scrollTop;
      node.scrollTop += deltaY;
      if (node.scrollTop !== previous) return;
    }
    node = node.parentElement;
  }

  window.scrollBy(0, deltaY);
}

export function NumericInputBehavior() {
  useEffect(() => {
    function handleWheel(event: WheelEvent) {
      if (event.ctrlKey || event.metaKey) return;
      if (!isNumericInput(event.target)) return;

      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1);
      scrollWheelTarget(event.target, delta);
    }

    document.addEventListener('wheel', handleWheel, { capture: true, passive: false });
    return () => {
      document.removeEventListener('wheel', handleWheel, { capture: true });
    };
  }, []);

  return null;
}
