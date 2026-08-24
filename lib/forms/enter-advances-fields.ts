import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const ACTIVATE_ON_ENTER_INPUT_TYPES = new Set([
  'button',
  'submit',
  'reset',
  'file',
  'image',
]);

export function getFormFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isTabbable);
}

export function shouldEnterAdvanceFromTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement) return false;
  if (target.isContentEditable) return false;
  if (target.getAttribute('role') === 'textbox' && target.getAttribute('aria-multiline') === 'true') {
    return false;
  }
  if (target instanceof HTMLButtonElement) return false;
  if (target instanceof HTMLInputElement && ACTIVATE_ON_ENTER_INPUT_TYPES.has(target.type)) {
    return false;
  }
  return true;
}

export function focusNextFormField(root: HTMLElement, current: HTMLElement): boolean {
  const elements = getFormFocusableElements(root);
  const currentIndex = resolveCurrentIndex(elements, current);
  if (currentIndex < 0) return false;

  const next = elements[currentIndex + 1];
  if (!next) return false;

  next.focus();
  return document.activeElement === next;
}

export function handleEnterAdvancesFields(event: ReactKeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Enter') return;
  if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
  if (event.nativeEvent.isComposing) return;
  if (!shouldEnterAdvanceFromTarget(event.target)) return;

  const root = resolveRoot(event.currentTarget, event.target);
  const current = event.target instanceof HTMLElement ? event.target : null;
  if (!root || !current) return;

  event.preventDefault();
  focusNextFormField(root, current);
}

function resolveRoot(currentTarget: EventTarget, target: EventTarget | null): HTMLElement | null {
  if (currentTarget instanceof HTMLElement) return currentTarget;
  if (target instanceof HTMLElement) return target.closest('form');
  return null;
}

function resolveCurrentIndex(elements: HTMLElement[], current: HTMLElement): number {
  let node: HTMLElement | null = current;
  while (node) {
    const index = elements.indexOf(node);
    if (index >= 0) return index;
    node = node.parentElement;
  }
  return -1;
}

function isTabbable(element: HTMLElement): boolean {
  if (element.getAttribute('tabindex') === '-1') return false;
  if (element.getAttribute('aria-hidden') === 'true') return false;
  if (element.closest('[aria-hidden="true"]')) return false;
  if (element.closest('[inert]')) return false;
  if (element.hasAttribute('disabled')) return false;
  return element.getClientRects().length > 0;
}
