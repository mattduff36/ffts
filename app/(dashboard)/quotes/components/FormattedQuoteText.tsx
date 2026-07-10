import type { ReactNode } from 'react';
import {
  getQuoteInlinePlainText,
  parseQuoteRichText,
  type QuoteRichTextInline,
} from '@/lib/quotes/quote-rich-text';
import { cn } from '@/lib/utils/cn';

interface FormattedQuoteTextProps {
  value: string;
  className?: string;
  omitLeadingHeading?: string;
}

function renderInline(nodes: QuoteRichTextInline[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;

    switch (node.type) {
      case 'text':
        return node.text;
      case 'strong':
        return <strong key={key} className="font-semibold">{renderInline(node.children, key)}</strong>;
      case 'emphasis':
        return <em key={key} className="italic">{renderInline(node.children, key)}</em>;
      case 'link':
        return (
          <a
            key={key}
            href={node.href}
            target="_blank"
            rel="noreferrer"
            className="text-blue-300 underline underline-offset-2"
          >
            {renderInline(node.children, key)}
          </a>
        );
    }
  });
}

export function FormattedQuoteText({ value, className, omitLeadingHeading }: FormattedQuoteTextProps) {
  const blocks = parseQuoteRichText(value).filter((block, index) => {
    if (!omitLeadingHeading || index !== 0 || block.type !== 'heading') {
      return true;
    }

    return getQuoteInlinePlainText(block.children).trim().toLowerCase() !== omitLeadingHeading.toLowerCase();
  });

  if (blocks.length === 0) {
    return null;
  }

  return (
    <div className={cn('space-y-2 font-sans text-slate-300', className)}>
      {blocks.map((block, index) => {
        const key = `block-${index}`;

        if (block.type === 'heading') {
          const headingClassName = cn(
            'font-semibold text-white',
            block.level === 1 ? 'text-base' : block.level === 2 ? 'text-sm' : 'text-sm'
          );
          return (
            <p key={key} className={headingClassName}>
              {renderInline(block.children, key)}
            </p>
          );
        }

        if (block.type === 'list') {
          const ListTag = block.ordered ? 'ol' : 'ul';
          return (
            <ListTag
              key={key}
              className={cn(
                'space-y-1 pl-5',
                block.ordered ? 'list-decimal' : 'list-disc'
              )}
            >
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-item-${itemIndex}`} className="pl-1">
                  {renderInline(item, `${key}-item-${itemIndex}`)}
                </li>
              ))}
            </ListTag>
          );
        }

        return (
          <p key={key} className="whitespace-pre-wrap">
            {renderInline(block.children, key)}
          </p>
        );
      })}
    </div>
  );
}
