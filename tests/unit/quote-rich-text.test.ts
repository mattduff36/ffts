import { afterEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import {
  convertHtmlToQuoteMarkdown,
  getQuoteRichPasteText,
  parseQuoteRichText,
} from '@/lib/quotes/quote-rich-text';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('quote rich text formatting', () => {
  it('parses ChatGPT-style markdown headings, emphasis and lists', () => {
    const blocks = parseQuoteRichText([
      '## Scope of Works',
      '',
      'Carry out **breakout** and *reinstatement* works.',
      '',
      '- Saw cut perimeter',
      '- Break out slab',
      '',
      '1. Prepare sub-base',
      '2. Pour concrete',
    ].join('\n'));

    expect(blocks).toMatchObject([
      { type: 'heading', level: 2 },
      {
        type: 'paragraph',
        children: [
          { type: 'text', text: 'Carry out ' },
          { type: 'strong', children: [{ type: 'text', text: 'breakout' }] },
          { type: 'text', text: ' and ' },
          { type: 'emphasis', children: [{ type: 'text', text: 'reinstatement' }] },
          { type: 'text', text: ' works.' },
        ],
      },
      { type: 'list', ordered: false, items: expect.arrayContaining([expect.any(Array)]) },
      { type: 'list', ordered: true, items: expect.arrayContaining([expect.any(Array)]) },
    ]);
  });

  it('converts simple rich clipboard HTML into safe markdown text', () => {
    const window = new Window();
    vi.stubGlobal('DOMParser', window.DOMParser);
    vi.stubGlobal('Node', window.Node);
    vi.stubGlobal('Element', window.Element);

    const markdown = convertHtmlToQuoteMarkdown(`
      <h2>Scope of Works</h2>
      <p style="font-family: 'Times New Roman', serif;">Carry out <strong>breakout</strong> and <em>sealing</em> works.</p>
      <ul>
        <li>Saw cut perimeter</li>
        <li>Break out slab</li>
      </ul>
    `);

    expect(markdown).toBe([
      '## Scope of Works',
      '',
      'Carry out **breakout** and *sealing* works.',
      '',
      '- Saw cut perimeter',
      '- Break out slab',
    ].join('\n'));
    expect(markdown).not.toContain('Times New Roman');
  });

  it('falls back to normalized plain text when rich clipboard HTML is absent', () => {
    const clipboardData = {
      getData: vi.fn((type: string) => {
        if (type === 'text/plain') {
          return 'Line one\r\n\r\n\r\n- Line two';
        }

        return '';
      }),
    };

    expect(getQuoteRichPasteText(clipboardData)).toBe('Line one\n\n- Line two');
  });
});
