/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScrollArea } from '@/components/ui/scroll-area';

const globalStyles = readFileSync(
  path.join(process.cwd(), 'app/globals.css'),
  'utf8',
);

describe('scrollbar styles', () => {
  it('defaults ScrollArea to the subtle utility while retaining caller classes', () => {
    render(
      <ScrollArea className="custom-scroll-area px-2" data-testid="scroll-area">
        Content
      </ScrollArea>,
    );

    expect(screen.getByTestId('scroll-area')).toHaveClass(
      'scrollbar-subtle',
      'relative',
      'overflow-auto',
      'custom-scroll-area',
      'px-2',
    );
  });

  it('keeps hidden scrollbar overrides after the global native styles', () => {
    const globalRuleIndex = globalStyles.indexOf(':where(*, .scrollbar-subtle)');
    const hiddenRuleIndex = globalStyles.indexOf('.scrollbar-hidden {');
    const nativeScrollbarStyles = globalStyles.slice(
      globalRuleIndex,
      hiddenRuleIndex,
    );

    expect(globalRuleIndex).toBeGreaterThanOrEqual(0);
    expect(globalStyles).toMatch(
      /:where\(\*, \.scrollbar-subtle\)\s*\{[^}]*scrollbar-width:\s*thin;[^}]*scrollbar-color:\s*hsl\(var\(--muted-foreground\) \/ 0\.4\) transparent;/,
    );
    expect(globalStyles).toMatch(
      /::-webkit-scrollbar\s*\{[^}]*width:\s*6px;[^}]*height:\s*6px;/,
    );
    expect(globalStyles).toContain('@media (forced-colors: active)');
    expect(nativeScrollbarStyles).not.toMatch(/#F1D64A|#d1b82f|#f1f1f1/i);
    expect(hiddenRuleIndex).toBeGreaterThan(globalRuleIndex);
    expect(globalStyles).toMatch(
      /\.scrollbar-hidden\s*\{[^}]*scrollbar-width:\s*none;/,
    );
    expect(globalStyles).toMatch(
      /\.scrollbar-hidden::-webkit-scrollbar\s*\{[^}]*display:\s*none;/,
    );
  });
});
