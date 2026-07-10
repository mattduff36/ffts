export type QuoteRichTextInline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: QuoteRichTextInline[] }
  | { type: 'emphasis'; children: QuoteRichTextInline[] }
  | { type: 'link'; href: string; children: QuoteRichTextInline[] };

export type QuoteRichTextBlock =
  | { type: 'paragraph'; children: QuoteRichTextInline[] }
  | { type: 'heading'; level: 1 | 2 | 3; children: QuoteRichTextInline[] }
  | { type: 'list'; ordered: boolean; items: QuoteRichTextInline[][] };

const MAX_HEADING_LEVEL = 3;
const SAFE_LINK_PATTERN = /^(https?:\/\/|mailto:)/i;

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

export function normalizeQuoteRichText(value: string): string {
  return normalizeLineEndings(value)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sanitizeHref(value: string): string | null {
  const trimmed = value.trim();
  return SAFE_LINK_PATTERN.test(trimmed) ? trimmed : null;
}

function pushText(nodes: QuoteRichTextInline[], text: string) {
  if (!text) return;

  const previous = nodes[nodes.length - 1];
  if (previous?.type === 'text') {
    previous.text += text;
    return;
  }

  nodes.push({ type: 'text', text });
}

export function parseQuoteInlineText(value: string): QuoteRichTextInline[] {
  const nodes: QuoteRichTextInline[] = [];
  let index = 0;

  while (index < value.length) {
    const remaining = value.slice(index);
    const linkMatch = remaining.match(/^\[([^\]\n]+)\]\(([^)\s]+)\)/);
    if (linkMatch?.[1] && linkMatch[2]) {
      const href = sanitizeHref(linkMatch[2]);
      if (href) {
        nodes.push({
          type: 'link',
          href,
          children: parseQuoteInlineText(linkMatch[1]),
        });
        index += linkMatch[0].length;
        continue;
      }
    }

    if (remaining.startsWith('**')) {
      const closeIndex = remaining.indexOf('**', 2);
      if (closeIndex > 2) {
        nodes.push({
          type: 'strong',
          children: parseQuoteInlineText(remaining.slice(2, closeIndex)),
        });
        index += closeIndex + 2;
        continue;
      }
    }

    if (remaining.startsWith('*')) {
      const closeIndex = remaining.indexOf('*', 1);
      if (closeIndex > 1) {
        nodes.push({
          type: 'emphasis',
          children: parseQuoteInlineText(remaining.slice(1, closeIndex)),
        });
        index += closeIndex + 1;
        continue;
      }
    }

    const nextSpecial = remaining.search(/\*\*|\*|\[/);
    if (nextSpecial > 0) {
      pushText(nodes, remaining.slice(0, nextSpecial));
      index += nextSpecial;
    } else {
      pushText(nodes, remaining[0] || '');
      index += 1;
    }
  }

  return nodes;
}

export function getQuoteInlinePlainText(nodes: QuoteRichTextInline[]): string {
  return nodes.map((node) => {
    if (node.type === 'text') return node.text;
    return getQuoteInlinePlainText(node.children);
  }).join('');
}

function isBulletLine(line: string): boolean {
  return /^\s*(?:[-*\u2022])\s+\S/.test(line);
}

function isOrderedLine(line: string): boolean {
  return /^\s*\d+[.)]\s+\S/.test(line);
}

function stripListMarker(line: string): string {
  return line.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s+/, '').trim();
}

function parseHeading(line: string): QuoteRichTextBlock | null {
  const hashHeading = line.match(/^(#{1,6})\s+(.+)$/);
  if (hashHeading?.[1] && hashHeading[2]) {
    return {
      type: 'heading',
      level: Math.min(hashHeading[1].length, MAX_HEADING_LEVEL) as 1 | 2 | 3,
      children: parseQuoteInlineText(hashHeading[2].trim()),
    };
  }

  const boldHeading = line.match(/^\*\*(.+)\*\*:?$/);
  if (boldHeading?.[1]) {
    return {
      type: 'heading',
      level: 3,
      children: parseQuoteInlineText(boldHeading[1].trim()),
    };
  }

  return null;
}

export function parseQuoteRichText(value: string): QuoteRichTextBlock[] {
  const normalized = normalizeQuoteRichText(value);
  if (!normalized) return [];

  const lines = normalized.split('\n');
  const blocks: QuoteRichTextBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] || '';
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const heading = parseHeading(trimmed);
    if (heading) {
      blocks.push(heading);
      index += 1;
      continue;
    }

    if (isBulletLine(line) || isOrderedLine(line)) {
      const ordered = isOrderedLine(line);
      const items: QuoteRichTextInline[][] = [];

      while (index < lines.length) {
        const currentLine = lines[index] || '';
        const matchesCurrentList = ordered ? isOrderedLine(currentLine) : isBulletLine(currentLine);
        if (!matchesCurrentList) break;

        items.push(parseQuoteInlineText(stripListMarker(currentLine)));
        index += 1;
      }

      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const currentLine = lines[index] || '';
      const currentTrimmed = currentLine.trim();
      if (
        !currentTrimmed
        || parseHeading(currentTrimmed)
        || isBulletLine(currentLine)
        || isOrderedLine(currentLine)
      ) {
        break;
      }

      paragraphLines.push(currentTrimmed);
      index += 1;
    }

    blocks.push({
      type: 'paragraph',
      children: parseQuoteInlineText(paragraphLines.join('\n')),
    });
  }

  return blocks;
}

function inlineTextFromHtmlNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || '';
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

  const element = node as Element;
  const tagName = element.tagName.toLowerCase();
  const children = Array.from(element.childNodes).map(inlineTextFromHtmlNode).join('');

  if (tagName === 'br') return '\n';
  if (tagName === 'strong' || tagName === 'b') return children ? `**${children}**` : '';
  if (tagName === 'em' || tagName === 'i') return children ? `*${children}*` : '';
  if (tagName === 'a') {
    const href = sanitizeHref(element.getAttribute('href') || '');
    return href && children ? `[${children}](${href})` : children;
  }

  return children;
}

function blockTextFromHtmlElement(element: Element): string {
  const tagName = element.tagName.toLowerCase();

  if (/^h[1-6]$/.test(tagName)) {
    const level = Math.min(Number(tagName.slice(1)), MAX_HEADING_LEVEL);
    return `${'#'.repeat(level)} ${inlineTextFromHtmlNode(element).trim()}`;
  }

  if (tagName === 'ul' || tagName === 'ol') {
    return Array.from(element.children)
      .filter(child => child.tagName.toLowerCase() === 'li')
      .map((child, index) => {
        const marker = tagName === 'ol' ? `${index + 1}.` : '-';
        return `${marker} ${inlineTextFromHtmlNode(child).trim()}`;
      })
      .join('\n');
  }

  if (tagName === 'li') {
    return `- ${inlineTextFromHtmlNode(element).trim()}`;
  }

  if (tagName === 'br') {
    return '\n';
  }

  const childBlocks = Array.from(element.children)
    .filter(child => ['p', 'div', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(child.tagName.toLowerCase()))
    .map(blockTextFromHtmlElement)
    .filter(Boolean);

  if (childBlocks.length > 0) {
    return childBlocks.join('\n\n');
  }

  return inlineTextFromHtmlNode(element).trim();
}

export function convertHtmlToQuoteMarkdown(html: string): string {
  if (!html.trim() || typeof DOMParser === 'undefined') {
    return '';
  }

  const document = new DOMParser().parseFromString(html, 'text/html');
  const blocks = Array.from(document.body.children)
    .map(blockTextFromHtmlElement)
    .filter(Boolean);

  const markdown = blocks.length > 0
    ? blocks.join('\n\n')
    : inlineTextFromHtmlNode(document.body);

  return normalizeQuoteRichText(markdown);
}

export function getQuoteRichPasteText(clipboardData: Pick<DataTransfer, 'getData'>): string | null {
  const html = clipboardData.getData('text/html');
  const markdown = convertHtmlToQuoteMarkdown(html);
  if (markdown) return markdown;

  const plain = clipboardData.getData('text/plain');
  return plain ? normalizeQuoteRichText(plain) : null;
}
