import React from 'react';
import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { format } from 'date-fns';
import { formatAssetMeterReading, getAssetMeterLabel, type AssetMeterUnit } from '@/lib/workshop-tasks/asset-meter';
import { templateConfig } from '@/lib/config/template-config';

const BRAND_YELLOW = templateConfig.branding.brandColor;
const BRAND_YELLOW_LIGHT = '#fff6cc';
const BRAND_TEXT = '#111827';

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 9.5,
    fontFamily: 'Helvetica',
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
  headerTextWrap: {
    flex: 1,
    paddingRight: 12,
  },
  logo: {
    width: 120,
    height: 64,
    objectFit: 'contain',
  },
  companyName: {
    fontSize: 14,
    fontWeight: 'bold',
    color: BRAND_TEXT,
    marginBottom: 2,
  },
  title: {
    fontSize: 17,
    fontWeight: 'bold',
    color: BRAND_TEXT,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 10,
    color: '#64748b',
    marginBottom: 3,
  },
  section: {
    marginTop: 10,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 'bold',
    marginBottom: 6,
    color: BRAND_TEXT,
    backgroundColor: BRAND_YELLOW,
    padding: 6,
    borderRadius: 2,
  },
  infoRow: {
    flexDirection: 'row',
    marginBottom: 4,
    paddingVertical: 1,
  },
  label: {
    fontWeight: 'bold',
    width: 140,
    color: '#64748b',
    fontSize: 9,
  },
  value: {
    flex: 1,
    color: '#1e293b',
    fontSize: 9.5,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 10,
    backgroundColor: BRAND_YELLOW_LIGHT,
    border: `1pt solid ${BRAND_YELLOW}`,
    borderRadius: 3,
    marginBottom: 10,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 13,
    fontWeight: 'bold',
    color: BRAND_TEXT,
  },
  statLabel: {
    fontSize: 8,
    color: '#64748b',
  },
  checklistSectionTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#0f172a',
    marginBottom: 4,
  },
  checklistSectionDescription: {
    fontSize: 8.5,
    color: '#64748b',
    marginBottom: 5,
  },
  checklistTableHeader: {
    flexDirection: 'row',
    border: '1pt solid #d1d5db',
    borderBottom: '0pt solid transparent',
    backgroundColor: BRAND_YELLOW_LIGHT,
  },
  checklistTableHeaderCellLabel: {
    width: '46%',
    borderRight: '1pt solid #d1d5db',
    paddingVertical: 4,
    paddingHorizontal: 5,
    fontSize: 8.5,
    fontWeight: 'bold',
    color: '#334155',
  },
  checklistTableHeaderCellValue: {
    width: '54%',
    paddingVertical: 4,
    paddingHorizontal: 5,
    fontSize: 8.5,
    fontWeight: 'bold',
    color: '#334155',
  },
  checklistRow: {
    flexDirection: 'row',
    border: '1pt solid #e2e8f0',
    borderTop: '0pt solid transparent',
  },
  checklistLabelCell: {
    width: '46%',
    borderRight: '1pt solid #e2e8f0',
    paddingVertical: 3,
    paddingHorizontal: 5,
    fontSize: 8.5,
    color: '#1f2937',
    lineHeight: 1.2,
  },
  checklistValueCell: {
    width: '54%',
    paddingVertical: 3,
    paddingHorizontal: 5,
    fontSize: 8.5,
    color: '#0f172a',
    lineHeight: 1.2,
  },
  requiredMarker: {
    color: '#dc2626',
  },
  emptyValue: {
    color: '#94a3b8',
    fontStyle: 'italic',
  },
  signatureSection: {
    marginTop: 6,
    paddingTop: 6,
    borderTop: '1pt solid #e2e8f0',
  },
  signatureSectionTitle: {
    fontSize: 8,
    color: '#64748b',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  signatureCard: {
    border: '1pt solid #d1d5db',
    borderLeft: `4pt solid ${BRAND_YELLOW}`,
    borderRadius: 4,
    padding: 6,
    backgroundColor: '#fbfcfe',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  signatureInfoColumn: {
    flex: 1,
    paddingRight: 8,
  },
  signatureCardTitle: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#0f172a',
    marginBottom: 4,
  },
  signatureMetaColumn: {
    width: '100%',
  },
  signatureMetaLabel: {
    fontSize: 7.5,
    color: '#64748b',
    textTransform: 'uppercase',
    marginBottom: 1,
  },
  signatureMetaValue: {
    fontSize: 8.5,
    color: '#0f172a',
    marginBottom: 3,
    lineHeight: 1.15,
  },
  signatureCanvasWrap: {
    width: 176,
    height: 58,
    marginLeft: 6,
    border: '1pt solid #d1d5db',
    borderRadius: 4,
    backgroundColor: '#ffffff',
    padding: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  signatureImage: {
    width: '98%',
    height: '94%',
    objectFit: 'cover',
  },
  signatureMissing: {
    fontSize: 8,
    color: '#94a3b8',
    fontStyle: 'italic',
  },
  statusBadge: {
    alignSelf: 'flex-start',
    marginTop: 6,
    padding: '2pt 7pt',
    borderRadius: 4,
    fontSize: 8,
    fontWeight: 'bold',
  },
  statusCompleted: {
    backgroundColor: '#22c55e',
    color: '#ffffff',
  },
  statusPending: {
    backgroundColor: BRAND_YELLOW,
    color: BRAND_TEXT,
  },
  valueBadge: {
    alignSelf: 'flex-start',
    borderRadius: 3,
    padding: '1pt 5pt',
    fontSize: 7.25,
    fontWeight: 'bold',
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 40,
    right: 40,
    textAlign: 'center',
    color: '#94a3b8',
    fontSize: 8,
    borderTop: '1pt solid #e2e8f0',
    paddingTop: 10,
  },
});

export interface V2PdfFieldData {
  field_key: string;
  label: string;
  field_type: 'marking_code' | 'text' | 'long_text' | 'number' | 'date' | 'yes_no' | 'signature';
  is_required: boolean;
  response_value: string | null;
  response_json: Record<string, unknown> | null;
}

export interface V2PdfSectionData {
  section_key: string;
  title: string;
  description: string | null;
  fields: V2PdfFieldData[];
}

interface WorkshopAttachmentPDFProps {
  templateName: string;
  templateDescription: string | null;
  taskTitle: string;
  taskCategory: string;
  taskStatus: string;
  attachmentStatus: 'pending' | 'completed';
  completedAt: string | null;
  createdAt: string;
  signatureTimestampOverride?: string | null;
  signatureTimestampOverrideDateOnly?: boolean;
  v2Sections: V2PdfSectionData[];
  assetName: string | null;
  assetType: 'van' | 'plant' | 'hgv' | null;
  assetMeterReading?: number | null;
  assetMeterUnit?: AssetMeterUnit | null;
  logoSrc?: string | null;
}

function normalizeValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

export function isSignatureComplete(responseJson: Record<string, unknown> | null | undefined): boolean {
  if (!responseJson) return false;
  const dataUrl = normalizeValue(responseJson.data_url);
  const signedBy = normalizeValue(responseJson.signed_by_name);
  const signedAt = normalizeValue(responseJson.signed_at);
  return dataUrl.length > 0 && signedBy.length > 0 && signedAt.length > 0;
}

function formatDateSafe(value: string): string {
  try {
    return format(new Date(value), 'PPP');
  } catch {
    return value;
  }
}

function formatDateTimeSafe(value: string): string {
  try {
    return format(new Date(value), 'PPP p');
  } catch {
    return value;
  }
}

export function getSignatureTimestampText({
  signatureAt,
  signatureTimestampOverride = null,
  signatureTimestampOverrideDateOnly = false,
}: {
  signatureAt: string | null;
  signatureTimestampOverride?: string | null;
  signatureTimestampOverrideDateOnly?: boolean;
}): string {
  const effectiveTimestamp = signatureTimestampOverride || signatureAt;

  if (!effectiveTimestamp) {
    return 'No signature captured';
  }

  return signatureTimestampOverrideDateOnly
    ? formatDateSafe(effectiveTimestamp)
    : formatDateTimeSafe(effectiveTimestamp);
}

function getMarkingCodeLabel(value: string): string {
  const lookup = new Map([
    ['serviceable', 'Pass'],
    ['attention', 'Fail'],
    ['not_checked', 'N/A'],
    ['not_applicable', 'N/A'],
    ['monitor', 'Monitor'],
  ]);
  return lookup.get(value) || value;
}

function getYesNoLabel(value: string): string {
  const lookup = new Map([
    ['yes', 'Yes'],
    ['no', 'No'],
    ['na', 'N/A'],
  ]);
  return lookup.get(value) || value;
}

export function isV2FieldAnswered(field: V2PdfFieldData): boolean {
  if (field.field_type === 'signature') return isSignatureComplete(field.response_json);
  return normalizeValue(field.response_value).length > 0;
}

function displayValue(field: V2PdfFieldData): string {
  const value = normalizeValue(field.response_value);
  if (!value) return '';
  if (field.field_type === 'marking_code') return getMarkingCodeLabel(value);
  if (field.field_type === 'yes_no') return getYesNoLabel(value);
  if (field.field_type === 'date') return formatDateSafe(value);
  return value;
}

interface BadgeAppearance {
  label: string;
  backgroundColor: string;
  textColor: string;
}

function getBadgeAppearance(field: V2PdfFieldData): BadgeAppearance | null {
  const value = normalizeValue(field.response_value).toLowerCase();
  if (!value) return null;

  if (field.field_type === 'marking_code') {
    if (value === 'serviceable') return { label: 'Pass', backgroundColor: '#16a34a', textColor: '#ffffff' };
    if (value === 'monitor') return { label: 'Monitor', backgroundColor: '#f59e0b', textColor: BRAND_TEXT };
    if (value === 'attention') return { label: 'Fail', backgroundColor: '#dc2626', textColor: '#ffffff' };
    if (value === 'not_applicable') return { label: 'N/A', backgroundColor: '#9ca3af', textColor: BRAND_TEXT };
    return { label: getMarkingCodeLabel(value), backgroundColor: '#9ca3af', textColor: BRAND_TEXT };
  }

  if (field.field_type === 'yes_no') {
    if (value === 'yes') return { label: 'Yes', backgroundColor: '#16a34a', textColor: '#ffffff' };
    if (value === 'no') return { label: 'No', backgroundColor: '#dc2626', textColor: '#ffffff' };
    if (value === 'na') return { label: 'N/A', backgroundColor: '#9ca3af', textColor: BRAND_TEXT };
  }

  return null;
}

export function WorkshopAttachmentPDF({
  templateName,
  templateDescription,
  taskTitle,
  taskCategory,
  taskStatus,
  attachmentStatus,
  completedAt,
  createdAt,
  signatureTimestampOverride = null,
  signatureTimestampOverrideDateOnly = false,
  v2Sections,
  assetName,
  assetType,
  assetMeterReading = null,
  assetMeterUnit = null,
  logoSrc = null,
}: WorkshopAttachmentPDFProps) {
  const itemCount = v2Sections.reduce((count, section) => count + section.fields.length, 0);
  const displayedAnsweredCount = v2Sections.reduce((count, section) => (
    count + section.fields.filter((field) => isV2FieldAnswered(field)).length
  ), 0);
  const formattedAssetMeterReading = formatAssetMeterReading(assetMeterReading);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <View style={styles.headerTextWrap}>
              <Text style={styles.companyName}>{templateConfig.branding.companyName}</Text>
              <Text style={styles.title}>{templateName}</Text>
              {templateDescription && (
                <Text style={styles.subtitle}>{templateDescription}</Text>
              )}
              <Text style={styles.subtitle}>
                Workshop Task Attachment Report
              </Text>
            </View>
            {logoSrc ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={logoSrc} style={styles.logo} />
            ) : null}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Details</Text>
          <View style={styles.infoRow}>
            <Text style={styles.label}>Task Category:</Text>
            <Text style={styles.value}>{taskCategory}</Text>
          </View>
          {taskTitle && (
            <View style={styles.infoRow}>
              <Text style={styles.label}>Task Description:</Text>
              <Text style={styles.value}>{taskTitle}</Text>
            </View>
          )}
          <View style={styles.infoRow}>
            <Text style={styles.label}>Task Status:</Text>
            <Text style={styles.value}>
              {taskStatus === 'completed' ? 'Completed' : 'In Progress'}
            </Text>
          </View>
          {assetName && (
            <View style={styles.infoRow}>
              <Text style={styles.label}>
                {assetType === 'plant' ? 'Plant:' : assetType === 'hgv' ? 'HGV:' : 'Van:'}
              </Text>
              <Text style={styles.value}>{assetName}</Text>
            </View>
          )}
          {formattedAssetMeterReading && (
            <View style={styles.infoRow}>
              <Text style={styles.label}>{getAssetMeterLabel(assetMeterUnit)}:</Text>
              <Text style={styles.value}>{formattedAssetMeterReading}</Text>
            </View>
          )}
          <View style={styles.infoRow}>
            <Text style={styles.label}>Attachment Status:</Text>
            <Text style={styles.value}>
              {attachmentStatus === 'completed' ? 'Completed' : 'Pending'}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.label}>Created:</Text>
            <Text style={styles.value}>
              {formatDateSafe(createdAt)}
            </Text>
          </View>
          {completedAt && (
            <View style={styles.infoRow}>
              <Text style={styles.label}>Completed:</Text>
              <Text style={styles.value}>
                {formatDateTimeSafe(completedAt)}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{itemCount}</Text>
            <Text style={styles.statLabel}>Total Items</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{displayedAnsweredCount}</Text>
            <Text style={styles.statLabel}>Answered</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>
              {itemCount > 0 ? Math.round((displayedAnsweredCount / itemCount) * 100) : 100}%
            </Text>
            <Text style={styles.statLabel}>Completion</Text>
          </View>
        </View>

        <View style={styles.section}>
          {v2Sections.map((section) => {
            const standardFields = section.fields.filter((field) => field.field_type !== 'signature' && isV2FieldAnswered(field));
            const signatureFields = section.fields.filter((field) => field.field_type === 'signature' && isSignatureComplete(field.response_json));

            return (
            <View key={section.section_key} style={{ marginBottom: 10 }}>
              <Text style={styles.checklistSectionTitle}>{section.title}</Text>
              {section.description && (
                <Text style={styles.checklistSectionDescription}>{section.description}</Text>
              )}

              {standardFields.length > 0 && (
                <>
                  <View style={styles.checklistTableHeader}>
                    <Text style={styles.checklistTableHeaderCellLabel}>Checklist Item</Text>
                    <Text style={styles.checklistTableHeaderCellValue}>Result / Response</Text>
                  </View>

                  {standardFields.map((field) => {
                    const renderedValue = displayValue(field);
                    const badge = getBadgeAppearance(field);
                    const hasValue = renderedValue.length > 0;

                    return (
                      <View key={`${section.section_key}::${field.field_key}`} style={styles.checklistRow} wrap={false}>
                        <Text style={styles.checklistLabelCell}>
                          {field.label}
                          {field.is_required && <Text style={styles.requiredMarker}> *</Text>}
                        </Text>

                        <View style={styles.checklistValueCell}>
                          {hasValue ? (
                            badge ? (
                              <Text style={{ ...styles.valueBadge, backgroundColor: badge.backgroundColor, color: badge.textColor }}>
                                {badge.label}
                              </Text>
                            ) : (
                              <Text>{renderedValue}</Text>
                            )
                          ) : null}
                        </View>
                      </View>
                    );
                  })}
                </>
              )}

              {signatureFields.length > 0 && (
                <View style={styles.signatureSection}>
                  <Text style={styles.signatureSectionTitle}>Section Sign-Off</Text>
                  {signatureFields.map((field) => {
                    const signatureName = normalizeValue(field.response_json?.signed_by_name);
                    const signatureAt = normalizeValue(field.response_json?.signed_at);
                    const signatureDataUrl = normalizeValue(field.response_json?.data_url);

                    return (
                      <View
                        key={`${section.section_key}::${field.field_key}::signature`}
                        style={styles.signatureCard}
                        wrap={false}
                      >
                        <View style={styles.signatureInfoColumn}>
                          <Text style={styles.signatureCardTitle}>{field.label}</Text>
                          <View style={styles.signatureMetaColumn}>
                            <Text style={styles.signatureMetaLabel}>Signed By</Text>
                            <Text style={styles.signatureMetaValue}>{signatureName || 'No signature captured'}</Text>
                            <Text style={styles.signatureMetaLabel}>Signed At</Text>
                            <Text style={styles.signatureMetaValue}>
                              {getSignatureTimestampText({
                                signatureAt: signatureAt || null,
                                signatureTimestampOverride,
                                signatureTimestampOverrideDateOnly,
                              })}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.signatureCanvasWrap}>
                          {signatureDataUrl ? (
                            // eslint-disable-next-line jsx-a11y/alt-text
                            <Image src={signatureDataUrl} style={styles.signatureImage} />
                          ) : (
                            <Text style={styles.signatureMissing}>No signature captured</Text>
                          )}
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
            );
          })}
        </View>

        <View style={styles.footer}>
          <Text>
            Generated by SquireApp • {format(new Date(), 'PPP p')}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
