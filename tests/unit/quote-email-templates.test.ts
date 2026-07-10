import { describe, expect, it } from 'vitest';
import { QUOTE_VAT_RATE_NOTICE } from '@/lib/quotes/quote-vat-notice';
import {
  getQuoteEmailTemplateDefinition,
  renderQuoteEmailTemplate,
  validateQuoteEmailTemplateInput,
} from '@/lib/server/quote-email-templates';

describe('quote email templates', () => {
  it('renders safe subject and body placeholders', () => {
    const definition = getQuoteEmailTemplateDefinition('po_request');
    const rendered = renderQuoteEmailTemplate(
      {
        subject_template: definition.default_subject_template,
        body_template: definition.default_body_template,
      },
      {
        quote_name: '40001-GH - Demo',
        contact_name: 'Alex <script>',
        sender_name: 'George & Team',
      }
    );

    expect(rendered.subject).toBe('40001-GH - Demo');
    expect(rendered.bodyText).toContain('Hello Alex <script>,');
    expect(rendered.bodyText).toContain(QUOTE_VAT_RATE_NOTICE);
    expect(rendered.bodyHtml).toContain('Hello Alex &lt;script&gt;,');
    expect(rendered.bodyHtml).toContain('George &amp; Team');
  });

  it('includes the VAT notice in the default customer quote email', () => {
    const definition = getQuoteEmailTemplateDefinition('customer_quote');
    const rendered = renderQuoteEmailTemplate(
      {
        subject_template: definition.default_subject_template,
        body_template: definition.default_body_template,
      },
      {
        quote_name: '40001-GH - Demo',
        contact_name: 'Alex',
        subject_line: 'Concrete repairs',
        pricing_note: '',
        signoff_name: 'George',
        signoff_title: 'Contracts Manager',
      }
    );

    expect(rendered.bodyText).toContain(QUOTE_VAT_RATE_NOTICE);
  });

  it('rejects placeholders that are not supported by a template', () => {
    const errors = validateQuoteEmailTemplateInput({
      template_key: 'po_request',
      subject_template: 'PO for {invoice_number}',
      body_template: 'Hello {contact_name}',
    });

    expect(errors).toEqual([
      'Unsupported placeholder for this template: {invoice_number}.',
    ]);
  });

  it('rejects blank subject and body templates', () => {
    const errors = validateQuoteEmailTemplateInput({
      template_key: 'customer_quote',
      subject_template: ' ',
      body_template: '',
    });

    expect(errors).toContain('Subject is required.');
    expect(errors).toContain('Body wording is required.');
  });
});
