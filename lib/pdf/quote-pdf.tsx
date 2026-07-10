import React from 'react';
import { Document, Image, Link, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { Style } from '@react-pdf/types';
import { format } from 'date-fns';
import {
  getQuoteInlinePlainText,
  parseQuoteRichText,
  type QuoteRichTextInline,
} from '@/lib/quotes/quote-rich-text';
import { QUOTE_VAT_RATE_NOTICE } from '@/lib/quotes/quote-vat-notice';
import { templateConfig } from '@/lib/config/template-config';

const BRAND_YELLOW = '#f2cc0c';
const BRAND_YELLOW_LIGHT = '#fff6cc';
const BRAND_TEXT = '#111827';
const BRAND_MUTED = '#475569';
const BRAND_BORDER = '#cbd5e1';
const BRAND_BORDER_DARK = '#94a3b8';
const PAGE_PADDING = 36;
const PAGE_BOTTOM_PADDING = 78;
const A4_CONTENT_HEIGHT = 841.89 - PAGE_PADDING - PAGE_BOTTOM_PADDING;
const MAX_TABLE_MIN_PRESENCE_AHEAD = A4_CONTENT_HEIGHT - 60;

const styles = StyleSheet.create({
  page: {
    padding: PAGE_PADDING,
    paddingBottom: PAGE_BOTTOM_PADDING,
    fontSize: 9.5,
    fontFamily: 'Helvetica',
    color: BRAND_TEXT,
  },
  header: {
    marginBottom: 18,
    borderBottom: `2pt solid ${BRAND_YELLOW}`,
    paddingBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerMeta: {
    flex: 1,
    paddingRight: 16,
  },
  eyebrow: {
    fontSize: 8,
    color: BRAND_MUTED,
    letterSpacing: 1,
  },
  quoteRef: {
    fontSize: 20,
    fontWeight: 'bold',
    color: BRAND_TEXT,
    marginTop: 4,
    marginBottom: 4,
  },
  versionText: {
    fontSize: 9,
    color: BRAND_MUTED,
    marginTop: 2,
  },
  dateBadge: {
    alignSelf: 'flex-start',
    marginTop: 10,
    backgroundColor: BRAND_YELLOW_LIGHT,
    border: `1pt solid ${BRAND_YELLOW}`,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  dateLabel: {
    fontSize: 7,
    color: BRAND_MUTED,
    marginBottom: 2,
  },
  dateValue: {
    fontSize: 10,
    fontWeight: 'bold',
    color: BRAND_TEXT,
  },
  logoWrap: {
    width: 180,
    alignItems: 'flex-end',
  },
  logo: {
    width: 180,
    height: 96,
    objectFit: 'contain',
  },
  fallbackCompanyName: {
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'right',
    color: BRAND_TEXT,
    marginBottom: 4,
  },
  fallbackCompanySubtitle: {
    fontSize: 11,
    textAlign: 'right',
    color: BRAND_MUTED,
  },
  contactStrip: {
    marginTop: 12,
    backgroundColor: BRAND_YELLOW_LIGHT,
    border: `1pt solid ${BRAND_YELLOW}`,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
  },
  contactItem: {
    width: '33.33%',
    paddingRight: 8,
  },
  contactLabel: {
    fontSize: 7,
    color: BRAND_MUTED,
    marginBottom: 2,
  },
  contactValue: {
    fontSize: 8.5,
    color: BRAND_TEXT,
    fontWeight: 'bold',
    lineHeight: 1.4,
  },
  recipientCard: {
    marginBottom: 14,
    border: `1pt solid ${BRAND_BORDER}`,
    borderLeft: `4pt solid ${BRAND_YELLOW}`,
    borderRadius: 4,
    padding: 12,
    backgroundColor: '#ffffff',
  },
  recipientRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  recipientColumn: {
    width: '50%',
    paddingRight: 12,
  },
  recipientColumnRight: {
    width: '50%',
    paddingLeft: 12,
  },
  sectionEyebrow: {
    fontSize: 7.5,
    color: BRAND_MUTED,
    marginBottom: 4,
    letterSpacing: 0.8,
  },
  recipientName: {
    fontSize: 11,
    fontWeight: 'bold',
    color: BRAND_TEXT,
    marginBottom: 3,
  },
  emailLink: {
    fontSize: 9,
    color: '#1d4ed8',
    textDecoration: 'underline',
  },
  preparedSiteAddress: {
    fontSize: 9,
    color: BRAND_TEXT,
    lineHeight: 1.4,
  },
  salutation: {
    marginBottom: 12,
    fontSize: 10,
    color: BRAND_TEXT,
  },
  introText: {
    fontSize: 10,
    marginBottom: 14,
    lineHeight: 1.45,
    color: BRAND_TEXT,
  },
  summaryCard: {
    marginBottom: 12,
    padding: 12,
    backgroundColor: '#f8fafc',
    border: `1pt solid ${BRAND_BORDER}`,
    borderLeft: `4pt solid ${BRAND_YELLOW}`,
    borderRadius: 4,
  },
  subjectTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: BRAND_TEXT,
    marginBottom: 4,
  },
  subjectDescription: {
    fontSize: 10,
    color: BRAND_MUTED,
    lineHeight: 1.45,
  },
  subjectDescriptionHeading: {
    fontSize: 10,
    color: BRAND_TEXT,
    fontWeight: 'bold',
    lineHeight: 1.35,
  },
  scopeSection: {
    marginTop: 2,
  },
  scopeTitle: {
    fontSize: 7.5,
    color: BRAND_MUTED,
    marginBottom: 5,
    letterSpacing: 0.8,
  },
  scopeText: {
    fontSize: 10,
    color: BRAND_TEXT,
    lineHeight: 1.45,
  },
  scopeBottomSpacer: {
    height: 16,
  },
  scopeHeading: {
    fontSize: 10,
    color: BRAND_TEXT,
    fontWeight: 'bold',
    lineHeight: 1.45,
  },
  detailRow: {
    flexDirection: 'row',
    marginTop: 4,
  },
  detailLabel: {
    width: 82,
    fontSize: 8.5,
    fontWeight: 'bold',
    color: BRAND_MUTED,
  },
  detailValue: {
    flex: 1,
    fontSize: 9.5,
    color: BRAND_TEXT,
    lineHeight: 1.4,
  },
  detailContent: {
    flex: 1,
  },
  detailValueHeading: {
    fontSize: 9.5,
    color: BRAND_TEXT,
    fontWeight: 'bold',
    lineHeight: 1.35,
  },
  detailLink: {
    flex: 1,
    fontSize: 9.5,
    color: '#1d4ed8',
    textDecoration: 'underline',
  },
  tableLabel: {
    fontSize: 7.5,
    color: BRAND_MUTED,
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  table: {
    marginBottom: 12,
    border: `1pt solid ${BRAND_BORDER_DARK}`,
    borderRadius: 4,
    overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: BRAND_YELLOW,
  },
  tableHeaderText: {
    fontSize: 8.5,
    fontWeight: 'bold',
    color: BRAND_TEXT,
  },
  tableRow: {
    flexDirection: 'row',
    borderTop: `1pt solid ${BRAND_BORDER}`,
    backgroundColor: '#ffffff',
  },
  tableRowAlt: {
    flexDirection: 'row',
    borderTop: `1pt solid ${BRAND_BORDER}`,
    backgroundColor: '#f8fafc',
  },
  colItemHeader: {
    width: '40%',
    padding: 8,
  },
  colQtyHeader: {
    width: '15%',
    padding: 8,
    textAlign: 'right',
  },
  colRateHeader: {
    width: '20%',
    padding: 8,
    textAlign: 'right',
  },
  colTotalHeader: {
    width: '25%',
    padding: 8,
    textAlign: 'right',
  },
  colItem: {
    width: '40%',
    padding: 8,
    fontSize: 9,
    color: BRAND_TEXT,
    fontWeight: 'bold',
  },
  colItemCell: {
    width: '40%',
    padding: 8,
  },
  colItemText: {
    fontSize: 9,
    color: BRAND_TEXT,
    fontWeight: 'bold',
    lineHeight: 1.35,
  },
  colQty: {
    width: '15%',
    padding: 8,
    textAlign: 'right',
    fontSize: 9,
    color: BRAND_TEXT,
  },
  colRate: {
    width: '20%',
    padding: 8,
    textAlign: 'right',
    fontSize: 9,
    color: BRAND_TEXT,
  },
  colTotal: {
    width: '25%',
    padding: 8,
    textAlign: 'right',
    fontSize: 9,
    color: BRAND_TEXT,
  },
  totalRow: {
    flexDirection: 'row',
    borderTop: `1pt solid ${BRAND_BORDER_DARK}`,
    backgroundColor: BRAND_YELLOW_LIGHT,
  },
  totalLabel: {
    width: '75%',
    padding: 9,
    fontWeight: 'bold',
    fontSize: 10.5,
    color: BRAND_TEXT,
  },
  totalValue: {
    width: '25%',
    padding: 9,
    textAlign: 'right',
    fontWeight: 'bold',
    fontSize: 10.5,
    color: BRAND_TEXT,
  },
  notesPanel: {
    marginTop: 2,
    padding: 12,
    backgroundColor: BRAND_YELLOW_LIGHT,
    border: `1pt solid ${BRAND_YELLOW}`,
    borderRadius: 4,
  },
  notesPrimary: {
    fontSize: 9.5,
    color: BRAND_TEXT,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  notesSecondary: {
    fontSize: 9,
    color: BRAND_MUTED,
    lineHeight: 1.5,
  },
  inlineStrong: {
    fontWeight: 'bold',
  },
  inlineEmphasis: {
    fontStyle: 'italic',
  },
  inlineLink: {
    color: '#1d4ed8',
    textDecoration: 'underline',
  },
  richHeading: {
    fontWeight: 'bold',
    color: BRAND_TEXT,
  },
  richListLine: {
    marginLeft: 8,
    lineHeight: 1.45,
  },
  signoff: {
    marginTop: 24,
  },
  signoffRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  signoffLine: {
    fontSize: 10,
    color: BRAND_TEXT,
  },
  signoffName: {
    fontSize: 10.5,
    fontWeight: 'bold',
    color: BRAND_TEXT,
    marginTop: 3,
  },
  signoffTitle: {
    fontSize: 9.5,
    color: BRAND_MUTED,
    marginTop: 2,
  },
  eAndOe: {
    fontSize: 9,
    color: BRAND_MUTED,
  },
  footer: {
    position: 'absolute',
    bottom: 28,
    left: 36,
    right: 36,
    paddingTop: 8,
    borderTop: `1pt solid ${BRAND_BORDER}`,
  },
  footerServices: {
    fontSize: 8,
    fontWeight: 'bold',
    color: BRAND_TEXT,
    textAlign: 'center',
    marginBottom: 3,
  },
  footerDetails: {
    fontSize: 7.5,
    color: BRAND_MUTED,
    textAlign: 'center',
    lineHeight: 1.4,
  },
});

function gbp(value: number): string {
  return `£${value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface LineItem {
  description: string;
  quantity: number;
  unit?: string | null;
  unit_rate: number;
  line_total: number;
}

interface QuotePDFProps {
  quoteReference: string;
  baseQuoteReference?: string;
  quoteDate: string;
  attentionName: string;
  attentionEmail: string;
  salutation: string;
  projectDescription: string;
  subjectLine: string;
  scope?: string;
  siteAddress?: string;
  managerEmail?: string;
  lineItems: LineItem[];
  total: number;
  pricingMode?: 'itemized' | 'attachments_only';
  validityDays: number;
  signoffName: string;
  signoffTitle: string;
  versionLabel?: string;
  customFooterText?: string;
  logoSrc?: string | null;
}

type PdfTextStyle = Style | Style[];

interface PdfRichTextProps {
  value: string;
  textStyle: PdfTextStyle;
  headingStyle?: PdfTextStyle;
  blockGap?: number;
  omitLeadingHeading?: string;
}

function composePdfTextStyle(
  ...items: Array<PdfTextStyle | Style | undefined>
): Style[] {
  return items.flatMap(item => {
    if (!item) return [];
    return Array.isArray(item) ? item : [item];
  });
}

function blockSpacing(index: number, gap: number): Style | undefined {
  return index > 0 ? { marginTop: gap } : undefined;
}

function renderPdfInline(nodes: QuoteRichTextInline[], keyPrefix: string): React.ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;

    switch (node.type) {
      case 'text':
        return node.text;
      case 'strong':
        return (
          <Text key={key} style={styles.inlineStrong}>
            {renderPdfInline(node.children, key)}
          </Text>
        );
      case 'emphasis':
        return (
          <Text key={key} style={styles.inlineEmphasis}>
            {renderPdfInline(node.children, key)}
          </Text>
        );
      case 'link':
        return (
          <Link key={key} src={node.href} style={styles.inlineLink}>
            {renderPdfInline(node.children, key)}
          </Link>
        );
    }
  });
}

function PdfRichText({ value, textStyle, headingStyle, blockGap = 4, omitLeadingHeading }: PdfRichTextProps) {
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
    <>
      {blocks.map((block, index) => {
        const key = `rich-block-${index}`;
        const spacing = blockSpacing(index, blockGap);

        if (block.type === 'heading') {
          return (
            <Text key={key} style={composePdfTextStyle(textStyle, styles.richHeading, headingStyle, spacing)}>
              {renderPdfInline(block.children, key)}
            </Text>
          );
        }

        if (block.type === 'list') {
          return (
            <View key={key} style={spacing || {}}>
              {block.items.map((item, itemIndex) => (
                <Text
                  key={`${key}-item-${itemIndex}`}
                  style={composePdfTextStyle(textStyle, styles.richListLine)}
                >
                  {block.ordered ? `${itemIndex + 1}. ` : '\u2022 '}
                  {renderPdfInline(item, `${key}-item-${itemIndex}`)}
                </Text>
              ))}
            </View>
          );
        }

        return (
          <Text key={key} style={composePdfTextStyle(textStyle, spacing)}>
            {renderPdfInline(block.children, key)}
          </Text>
        );
      })}
    </>
  );
}

function formatQuantity(item: LineItem): string {
  const unit = item.unit?.trim();
  if (unit && unit !== String(item.quantity)) return `${item.quantity} ${unit}`;
  return `${item.quantity}`;
}

function estimateQuoteTableRowHeight(item: LineItem): number {
  const lineCount = Math.max(1, Math.ceil(item.description.trim().length / 42));
  return 18 + lineCount * 11;
}

function getQuoteTableMinPresenceAhead(lineItems: LineItem[]): number {
  const labelHeight = 18;
  const headerHeight = 28;
  const totalHeight = 30;
  const rowHeight = lineItems.reduce(
    (sum, item) => sum + estimateQuoteTableRowHeight(item),
    0
  );

  return Math.min(
    MAX_TABLE_MIN_PRESENCE_AHEAD,
    labelHeight + headerHeight + totalHeight + rowHeight
  );
}

export function QuotePDF({
  quoteReference,
  baseQuoteReference,
  quoteDate,
  attentionName,
  attentionEmail,
  salutation,
  projectDescription,
  subjectLine,
  scope,
  siteAddress,
  managerEmail,
  lineItems,
  total,
  pricingMode = 'itemized',
  validityDays,
  signoffName,
  signoffTitle,
  versionLabel,
  customFooterText,
  logoSrc = null,
}: QuotePDFProps) {
  const managerContactEmail = managerEmail?.trim() || '';
  const keepQuoteTableTogether = lineItems.length <= 4;
  const quoteTableMinPresenceAhead = keepQuoteTableTogether
    ? getQuoteTableMinPresenceAhead(lineItems)
    : 64;
  const formattedDate = (() => {
    try {
      const d = new Date(quoteDate);
      const day = d.getDate();
      const suffix = [11, 12, 13].includes(day) ? 'th'
        : day % 10 === 1 ? 'st'
        : day % 10 === 2 ? 'nd'
        : day % 10 === 3 ? 'rd'
        : 'th';
      return `${day}${suffix} ${format(d, 'MMMM yyyy')}`;
    } catch {
      return quoteDate;
    }
  })();

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <View style={styles.headerMeta}>
              <Text style={styles.eyebrow}>QUOTATION</Text>
              <Text style={styles.quoteRef}>{quoteReference}</Text>
              {versionLabel && versionLabel !== 'Original' && (
                <Text style={styles.versionText}>Version: {versionLabel}</Text>
              )}
              {baseQuoteReference && baseQuoteReference !== quoteReference && (
                <Text style={styles.versionText}>Base quote: {baseQuoteReference}</Text>
              )}
              <View style={styles.dateBadge}>
                <Text style={styles.dateLabel}>Issue date</Text>
                <Text style={styles.dateValue}>{formattedDate}</Text>
              </View>
            </View>

            <View style={styles.logoWrap}>
              {logoSrc ? (
                // eslint-disable-next-line jsx-a11y/alt-text
                <Image src={logoSrc} style={styles.logo} />
              ) : (
                <>
                  <Text style={styles.fallbackCompanyName}>
                    {templateConfig.branding.companyName}
                  </Text>
                  <Text style={styles.fallbackCompanySubtitle}>Plant Co. Ltd.</Text>
                </>
              )}
            </View>
          </View>

          <View style={styles.contactStrip}>
            <View style={styles.contactItem}>
              <Text style={styles.contactLabel}>Telephone</Text>
              <Text style={styles.contactValue}>01636 812227</Text>
            </View>
            <View style={styles.contactItem}>
              <Text style={styles.contactLabel}>Email</Text>
              {managerContactEmail && (
                <Link src={`mailto:${managerContactEmail}`} style={styles.contactValue}>
                  {managerContactEmail}
                </Link>
              )}
            </View>
            <View style={styles.contactItem}>
              <Text style={styles.contactLabel}>Registered Office</Text>
              <Text style={styles.contactValue}>
                Vivienne House, Racecourse Road, Crew Lane Ind Est, Southwell, Notts, NG25 0TX
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.recipientCard} wrap={false}>
          <View style={styles.recipientRow}>
            <View style={styles.recipientColumn}>
              <Text style={styles.sectionEyebrow}>PREPARED FOR</Text>
              {attentionName ? (
                <Text style={styles.recipientName}>For the attention of {attentionName}</Text>
              ) : (
                <Text style={styles.recipientName}>For the attention of your team</Text>
              )}
              {attentionEmail && (
                <Link src={`mailto:${attentionEmail}`} style={styles.emailLink}>
                  {attentionEmail}
                </Link>
              )}
            </View>
            {siteAddress && (
              <View style={styles.recipientColumnRight}>
                <Text style={styles.sectionEyebrow}>SITE ADDRESS</Text>
                <Text style={styles.preparedSiteAddress}>{siteAddress}</Text>
              </View>
            )}
          </View>
        </View>

        <Text style={styles.salutation}>{salutation || 'Dear Sir/Madam,'}</Text>
        <Text style={styles.introText}>
          Further to your request, we are pleased to provide our quotation as follows:
        </Text>

        <View style={styles.summaryCard}>
          {subjectLine && <Text style={styles.subjectTitle}>{subjectLine}</Text>}
          {projectDescription && (
            <PdfRichText
              value={projectDescription}
              textStyle={styles.subjectDescription}
              headingStyle={styles.subjectDescriptionHeading}
            />
          )}
        </View>

        {scope && (
          <>
            <Text style={[styles.scopeSection, styles.scopeTitle]}>SCOPE</Text>
            <PdfRichText
              value={scope}
              textStyle={styles.scopeText}
              headingStyle={styles.scopeHeading}
              blockGap={4}
              omitLeadingHeading="scope of works"
            />
            <View style={styles.scopeBottomSpacer} />
          </>
        )}

        {pricingMode === 'attachments_only' ? (
          <View style={styles.notesPanel}>
            <Text style={styles.notesPrimary}>Pricing and supporting details are supplied in the attached documents.</Text>
            <Text style={styles.notesSecondary}>
              Please refer to the attached pricing documents for the quoted costs and any supporting scope details.
            </Text>
          </View>
        ) : (
          <View
            minPresenceAhead={quoteTableMinPresenceAhead}
            wrap={!keepQuoteTableTogether}
          >
            <Text style={styles.tableLabel} minPresenceAhead={quoteTableMinPresenceAhead}>QUOTED ITEMS</Text>
            <View style={styles.table}>
              <View style={styles.tableHeader} wrap={false}>
                <Text style={[styles.colItemHeader, styles.tableHeaderText]}>Item</Text>
                <Text style={[styles.colQtyHeader, styles.tableHeaderText]}>Quantity</Text>
                <Text style={[styles.colRateHeader, styles.tableHeaderText]}>Unit Rate</Text>
                <Text style={[styles.colTotalHeader, styles.tableHeaderText]}>Total</Text>
              </View>
              {lineItems.map((item, idx) => (
                <View
                  key={idx}
                  style={idx % 2 === 0 ? styles.tableRow : styles.tableRowAlt}
                  wrap={false}
                >
                  <View style={styles.colItemCell}>
                    <PdfRichText
                      value={item.description}
                      textStyle={styles.colItemText}
                      headingStyle={styles.colItemText}
                      blockGap={2}
                    />
                  </View>
                  <Text style={styles.colQty}>{formatQuantity(item)}</Text>
                  <Text style={styles.colRate}>{gbp(item.unit_rate)}</Text>
                  <Text style={styles.colTotal}>{gbp(item.line_total)}</Text>
                </View>
              ))}
              <View style={styles.totalRow} wrap={false}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalValue}>{gbp(total)}</Text>
              </View>
            </View>
          </View>
        )}

        <View style={styles.notesPanel}>
          <PdfRichText
            value={customFooterText || `Quotation valid for ${validityDays} days.\n${QUOTE_VAT_RATE_NOTICE}`}
            textStyle={styles.notesPrimary}
            headingStyle={styles.notesPrimary}
          />
          <Text style={styles.notesSecondary}>
            We trust you will find this of interest and assure you of our close attention to your requirements.
          </Text>
        </View>

        <View style={styles.signoff}>
          <View style={styles.signoffRow}>
            <View>
              <Text style={styles.signoffLine}>Yours faithfully</Text>
              {signoffName && <Text style={styles.signoffName}>{signoffName}</Text>}
              {signoffTitle && <Text style={styles.signoffTitle}>{signoffTitle}</Text>}
            </View>
            <Text style={styles.eAndOe}>E & OE</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerServices}>
            PLANT HIRE | TIPPER HIRE | CIVIL ENGINEERING | CONTRACT EARTH MOVING
          </Text>
          <Text style={styles.footerDetails}>
            {templateConfig.branding.registrationText}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
