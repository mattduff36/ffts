/**
 * Shared HTML shell and fragment helpers for operational (non-quote) emails.
 * Table-based layout for broad client support; branding from templateConfig.
 */

import { templateConfig } from '@/lib/config/template-config';

export type OperationalEmailTone = 'neutral' | 'notice' | 'warning' | 'critical';

interface TonePalette {
  border: string;
  background: string;
  text: string;
  title: string;
}

const TONE_PALETTE: Record<OperationalEmailTone, TonePalette> = {
  neutral: {
    border: '#d4d4d8',
    background: '#fafafa',
    text: '#3f3f46',
    title: '#18181b',
  },
  notice: {
    border: '#d97706',
    background: '#fffbeb',
    text: '#92400e',
    title: '#78350f',
  },
  warning: {
    border: '#dc2626',
    background: '#fef2f2',
    text: '#991b1b',
    title: '#7f1d1d',
  },
  critical: {
    border: '#b91c1c',
    background: '#fef2f2',
    text: '#991b1b',
    title: '#7f1d1d',
  },
};

const FONT_STACK = 'Arial, Helvetica, sans-serif';
const TEXT_COLOR = '#27272a';
const MUTED_COLOR = '#71717a';
const BORDER_COLOR = '#e4e4e7';
const OUTER_BG = '#f4f4f5';

export function escapeEmailHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function emailParagraph(text: string, options?: { muted?: boolean; html?: boolean }): string {
  const color = options?.muted ? MUTED_COLOR : TEXT_COLOR;
  const content = options?.html ? text : escapeEmailHtml(text);
  return `<p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.55; color: ${color};">${content}</p>`;
}

export function emailDetailTable(
  rows: Array<{ label: string; value: string; valueHtml?: boolean }>
): string {
  const body = rows
    .map((row, index) => {
      const isLast = index === rows.length - 1;
      const border = isLast ? 'none' : `1px solid ${BORDER_COLOR}`;
      const value = row.valueHtml ? row.value : escapeEmailHtml(row.value);
      return `
        <tr>
          <td style="padding: 10px 0; border-bottom: ${border}; width: 34%; vertical-align: top; font-size: 13px; color: ${MUTED_COLOR};">${escapeEmailHtml(row.label)}</td>
          <td style="padding: 10px 0; border-bottom: ${border}; vertical-align: top; font-size: 15px; color: ${TEXT_COLOR}; font-weight: 600;">${value}</td>
        </tr>`;
    })
    .join('');

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 0 20px 0; border: 1px solid ${BORDER_COLOR}; border-radius: 3px;">
      <tr>
        <td style="padding: 4px 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            ${body}
          </table>
        </td>
      </tr>
    </table>`;
}

export function emailCallout(params: {
  title: string;
  body: string;
  tone?: OperationalEmailTone;
  bodyHtml?: boolean;
}): string {
  const tone = params.tone || 'neutral';
  const palette = TONE_PALETTE[tone];
  const body = params.bodyHtml ? params.body : escapeEmailHtml(params.body);

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 0 20px 0;">
      <tr>
        <td style="padding: 14px 16px; background-color: ${palette.background}; border-left: 3px solid ${palette.border}; border-radius: 2px;">
          <p style="margin: 0 0 6px 0; font-size: 13px; font-weight: 700; color: ${palette.title};">${escapeEmailHtml(params.title)}</p>
          <p style="margin: 0; font-size: 14px; line-height: 1.5; color: ${palette.text}; white-space: pre-wrap;">${body}</p>
        </td>
      </tr>
    </table>`;
}

export function emailSteps(heading: string, steps: string[]): string {
  const items = steps
    .map(
      step =>
        `<li style="margin: 0 0 8px 0; font-size: 15px; line-height: 1.5; color: ${TEXT_COLOR};">${escapeEmailHtml(step)}</li>`
    )
    .join('');

  return `
    <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 700; color: ${TEXT_COLOR};">${escapeEmailHtml(heading)}</p>
    <ol style="margin: 0 0 20px 0; padding-left: 22px;">
      ${items}
    </ol>`;
}

export function emailCredential(rows: Array<{ label: string; value: string; emphasize?: boolean }>): string {
  const brand = templateConfig.branding.brandColor;
  const body = rows
    .map((row, index) => {
      const isLast = index === rows.length - 1;
      const valueStyle = row.emphasize
        ? `margin: 0; font-size: 22px; font-weight: 700; letter-spacing: 0.5px; color: ${TEXT_COLOR}; font-family: Consolas, 'Courier New', monospace;`
        : `margin: 0; font-size: 15px; font-weight: 600; color: ${TEXT_COLOR};`;
      return `
        <tr>
          <td style="padding: ${index === 0 ? '0' : '14px'} 0 ${isLast ? '0' : '0'} 0;">
            <p style="margin: 0 0 4px 0; font-size: 12px; color: ${MUTED_COLOR}; text-transform: uppercase; letter-spacing: 0.4px;">${escapeEmailHtml(row.label)}</p>
            <p style="${valueStyle}">${escapeEmailHtml(row.value)}</p>
          </td>
        </tr>`;
    })
    .join('');

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 0 20px 0; border: 1px solid ${BORDER_COLOR}; border-left: 3px solid ${brand}; border-radius: 3px;">
      <tr>
        <td style="padding: 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            ${body}
          </table>
        </td>
      </tr>
    </table>`;
}

export function emailButton(label: string, href: string): string {
  const brand = templateConfig.branding.brandColor;
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 20px 0;">
      <tr>
        <td style="border-radius: 3px; background-color: #18181b;">
          <a href="${escapeEmailHtml(href)}" style="display: inline-block; padding: 12px 22px; font-family: ${FONT_STACK}; font-size: 14px; font-weight: 700; color: ${brand}; text-decoration: none; border-radius: 3px;">${escapeEmailHtml(label)}</a>
        </td>
      </tr>
    </table>`;
}

export function emailChangeTable(
  rows: Array<{ field: string; previous: string; next: string }>
): string {
  const header = `
    <tr>
      <th align="left" style="padding: 10px 12px; font-size: 11px; font-weight: 700; color: ${MUTED_COLOR}; text-transform: uppercase; letter-spacing: 0.4px; border-bottom: 1px solid ${BORDER_COLOR};">Field</th>
      <th align="left" style="padding: 10px 12px; font-size: 11px; font-weight: 700; color: ${MUTED_COLOR}; text-transform: uppercase; letter-spacing: 0.4px; border-bottom: 1px solid ${BORDER_COLOR};">Previous</th>
      <th align="left" style="padding: 10px 12px; font-size: 11px; font-weight: 700; color: ${MUTED_COLOR}; text-transform: uppercase; letter-spacing: 0.4px; border-bottom: 1px solid ${BORDER_COLOR};">New</th>
    </tr>`;

  const body = rows
    .map(
      (row, index) => `
      <tr>
        <td style="padding: 10px 12px; font-size: 14px; font-weight: 600; color: ${TEXT_COLOR}; border-bottom: ${index === rows.length - 1 ? 'none' : `1px solid ${BORDER_COLOR}`};">${escapeEmailHtml(row.field)}</td>
        <td style="padding: 10px 12px; font-size: 14px; color: ${MUTED_COLOR}; border-bottom: ${index === rows.length - 1 ? 'none' : `1px solid ${BORDER_COLOR}`};">${escapeEmailHtml(row.previous)}</td>
        <td style="padding: 10px 12px; font-size: 14px; font-weight: 600; color: ${TEXT_COLOR}; border-bottom: ${index === rows.length - 1 ? 'none' : `1px solid ${BORDER_COLOR}`};">${escapeEmailHtml(row.next)}</td>
      </tr>`
    )
    .join('');

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 0 20px 0; border: 1px solid ${BORDER_COLOR}; border-radius: 3px;">
      ${header}
      ${body}
    </table>`;
}

export function emailCodeBlock(value: string): string {
  return `<pre style="margin: 0 0 20px 0; padding: 14px; background-color: #fafafa; border: 1px solid ${BORDER_COLOR}; border-radius: 3px; overflow-x: auto; font-size: 12px; line-height: 1.45; color: #3f3f46; font-family: Consolas, 'Courier New', monospace; white-space: pre-wrap;">${escapeEmailHtml(value)}</pre>`;
}

export interface RenderOperationalEmailParams {
  title: string;
  bodyHtml: string;
  preheader?: string;
  tone?: OperationalEmailTone;
}

/**
 * Wrap body HTML in the shared operational email shell.
 */
export function renderOperationalEmail(params: RenderOperationalEmailParams): string {
  const branding = templateConfig.branding;
  const tone = params.tone || 'neutral';
  const accent =
    tone === 'critical' || tone === 'warning'
      ? TONE_PALETTE[tone].border
      : branding.brandColor;
  const year = new Date().getFullYear();
  const title = escapeEmailHtml(params.title);
  const preheader = params.preheader ? escapeEmailHtml(params.preheader) : '';
  const address = branding.registeredAddress ? escapeEmailHtml(branding.registeredAddress) : '';

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>${title}</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: ${OUTER_BG}; font-family: ${FONT_STACK};">
    ${preheader ? `<div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">${preheader}</div>` : ''}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: ${OUTER_BG};">
      <tr>
        <td align="center" style="padding: 24px 12px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width: 600px; background-color: #ffffff; border: 1px solid ${BORDER_COLOR}; border-radius: 3px;">
            <tr>
              <td style="height: 4px; line-height: 4px; font-size: 0; background-color: ${accent};">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding: 20px 28px 8px 28px;">
                <p style="margin: 0; font-size: 13px; font-weight: 700; letter-spacing: 0.3px; color: ${TEXT_COLOR};">${escapeEmailHtml(branding.shortAppName)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding: 8px 28px 8px 28px;">
                <h1 style="margin: 0 0 20px 0; font-size: 20px; line-height: 1.3; font-weight: 700; color: ${TEXT_COLOR};">${title}</h1>
                ${params.bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding: 8px 28px 24px 28px; border-top: 1px solid ${BORDER_COLOR};">
                <p style="margin: 16px 0 0 0; font-size: 12px; line-height: 1.5; color: ${MUTED_COLOR};">
                  ${escapeEmailHtml(branding.companyName)}
                  ${address ? `<br>${address}` : ''}
                  <br>&copy; ${year} ${escapeEmailHtml(branding.companyName)}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
