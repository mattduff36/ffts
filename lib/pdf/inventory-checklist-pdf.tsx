import React from 'react';
import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import {
  INVENTORY_CHECK_OVERALL_STATUS_LABELS,
  INVENTORY_CHECKLIST_STATUS_LABELS,
  getInventoryChecklistSummary,
  type InventoryCheckOverallStatus,
  type InventoryChecklistItemResult,
} from '@/lib/checklists/inventory-service-checklist';
import { templateConfig } from '@/lib/config/template-config';

const BRAND_YELLOW = '#f2cc0c';
const BRAND_YELLOW_LIGHT = '#fff6cc';
const BRAND_TEXT = '#111827';

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 9.5,
    fontFamily: 'Helvetica',
    color: '#1f2937',
  },
  header: {
    marginBottom: 16,
    borderBottom: `2pt solid ${BRAND_YELLOW}`,
    paddingBottom: 10,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerText: {
    flex: 1,
    paddingRight: 12,
  },
  companyName: {
    fontSize: 13,
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
    fontSize: 9.5,
    color: '#64748b',
  },
  logo: {
    width: 112,
    height: 58,
    objectFit: 'contain',
  },
  section: {
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 10.5,
    fontWeight: 'bold',
    color: BRAND_TEXT,
    backgroundColor: BRAND_YELLOW,
    padding: 6,
    marginBottom: 6,
  },
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    border: '1pt solid #e2e8f0',
  },
  infoCell: {
    width: '50%',
    padding: 6,
    borderBottom: '1pt solid #e2e8f0',
  },
  infoLabel: {
    fontSize: 7.5,
    textTransform: 'uppercase',
    color: '#64748b',
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 9.5,
    color: '#0f172a',
    fontWeight: 'bold',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 9,
    backgroundColor: BRAND_YELLOW_LIGHT,
    border: `1pt solid ${BRAND_YELLOW}`,
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
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: BRAND_YELLOW_LIGHT,
    border: '1pt solid #d1d5db',
    borderBottom: '0pt solid transparent',
  },
  tableHeaderNumber: {
    width: '9%',
    padding: 4,
    fontSize: 8,
    fontWeight: 'bold',
    color: '#334155',
    borderRight: '1pt solid #d1d5db',
  },
  tableHeaderItem: {
    width: '43%',
    padding: 4,
    fontSize: 8,
    fontWeight: 'bold',
    color: '#334155',
    borderRight: '1pt solid #d1d5db',
  },
  tableHeaderResult: {
    width: '16%',
    padding: 4,
    fontSize: 8,
    fontWeight: 'bold',
    color: '#334155',
    borderRight: '1pt solid #d1d5db',
  },
  tableHeaderComments: {
    width: '32%',
    padding: 4,
    fontSize: 8,
    fontWeight: 'bold',
    color: '#334155',
  },
  tableRow: {
    flexDirection: 'row',
    border: '1pt solid #e2e8f0',
    borderTop: '0pt solid transparent',
  },
  tableNumber: {
    width: '9%',
    padding: 4,
    fontSize: 8.5,
    color: '#64748b',
    borderRight: '1pt solid #e2e8f0',
  },
  tableItem: {
    width: '43%',
    padding: 4,
    fontSize: 8.5,
    color: '#1f2937',
    borderRight: '1pt solid #e2e8f0',
  },
  tableResult: {
    width: '16%',
    padding: 4,
    borderRight: '1pt solid #e2e8f0',
  },
  tableComments: {
    width: '32%',
    padding: 4,
    fontSize: 8.5,
    color: '#334155',
    lineHeight: 1.2,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 3,
    padding: '2pt 6pt',
    fontSize: 7.5,
    fontWeight: 'bold',
  },
  passBadge: {
    backgroundColor: '#dcfce7',
    color: '#166534',
  },
  failBadge: {
    backgroundColor: '#fee2e2',
    color: '#991b1b',
  },
  naBadge: {
    backgroundColor: '#e2e8f0',
    color: '#334155',
  },
  emptyComment: {
    color: '#94a3b8',
    fontStyle: 'italic',
  },
  noteBox: {
    border: '1pt solid #e2e8f0',
    padding: 8,
    fontSize: 9,
    color: '#334155',
    lineHeight: 1.35,
  },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 36,
    right: 36,
    borderTop: '1pt solid #e2e8f0',
    paddingTop: 5,
    fontSize: 7,
    color: '#94a3b8',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});

export interface InventoryChecklistPdfItem {
  itemNumber: string;
  name: string;
  category: string;
  locationName: string | null;
  groupName: string | null;
  sourceReference: string | null;
}

export interface InventoryChecklistPdfCheck {
  checklistLabel: string;
  pdfTitle: string;
  pdfSubtitle: string;
  checkedAt: string;
  checkedByName: string | null;
  intervalDays: number;
  note: string | null;
  overallStatus: InventoryCheckOverallStatus;
  checklistItems: InventoryChecklistItemResult[];
}

interface InventoryChecklistPDFProps {
  item: InventoryChecklistPdfItem;
  check: InventoryChecklistPdfCheck;
  logoSrc?: string | null;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00`));
}

function formatGeneratedAt(): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());
}

function getBadgeStyle(status: InventoryChecklistItemResult['status']) {
  if (status === 'ok') return [styles.badge, styles.passBadge];
  if (status === 'attention') return [styles.badge, styles.failBadge];
  return [styles.badge, styles.naBadge];
}

export function InventoryChecklistPDF({ item, check, logoSrc }: InventoryChecklistPDFProps) {
  const summary = getInventoryChecklistSummary(check.checklistItems);
  const generatedAt = formatGeneratedAt();

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <View style={styles.headerText}>
              <Text style={styles.companyName}>{templateConfig.branding.companyName}</Text>
              <Text style={styles.title}>{check.pdfTitle}</Text>
              <Text style={styles.subtitle}>{check.pdfSubtitle}</Text>
            </View>
            {logoSrc ? (
              // eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer Image does not support alt.
              <Image src={logoSrc} style={styles.logo} />
            ) : null}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Checklist Details</Text>
          <View style={styles.infoGrid}>
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>Inventory Item</Text>
              <Text style={styles.infoValue}>{item.name}</Text>
            </View>
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>Item Number</Text>
              <Text style={styles.infoValue}>{item.itemNumber}</Text>
            </View>
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>Category</Text>
              <Text style={styles.infoValue}>{item.category}</Text>
            </View>
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>Location</Text>
              <Text style={styles.infoValue}>{item.locationName || 'Not assigned'}</Text>
            </View>
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>Group</Text>
              <Text style={styles.infoValue}>{item.groupName || 'No group'}</Text>
            </View>
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>Source Reference</Text>
              <Text style={styles.infoValue}>{item.sourceReference || 'Not recorded'}</Text>
            </View>
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>Check Type</Text>
              <Text style={styles.infoValue}>{check.checklistLabel}</Text>
            </View>
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>Checked Date</Text>
              <Text style={styles.infoValue}>{formatDate(check.checkedAt)}</Text>
            </View>
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>Checked By</Text>
              <Text style={styles.infoValue}>{check.checkedByName || 'Unknown user'}</Text>
            </View>
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>Overall Result</Text>
              <Text style={styles.infoValue}>{INVENTORY_CHECK_OVERALL_STATUS_LABELS[check.overallStatus]}</Text>
            </View>
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>Check Interval</Text>
              <Text style={styles.infoValue}>{check.intervalDays} days</Text>
            </View>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{summary.pass}</Text>
            <Text style={styles.statLabel}>Pass</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{summary.fail}</Text>
            <Text style={styles.statLabel}>Fail</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{summary.na}</Text>
            <Text style={styles.statLabel}>N/A</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{summary.total}</Text>
            <Text style={styles.statLabel}>Total</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Checklist Results</Text>
          <View style={styles.tableHeader}>
            <Text style={styles.tableHeaderNumber}>No.</Text>
            <Text style={styles.tableHeaderItem}>Item</Text>
            <Text style={styles.tableHeaderResult}>Result</Text>
            <Text style={styles.tableHeaderComments}>Comments</Text>
          </View>
          {check.checklistItems.map((checklistItem) => (
            <View key={checklistItem.item_number} style={styles.tableRow} wrap={false}>
              <Text style={styles.tableNumber}>{checklistItem.item_number}</Text>
              <Text style={styles.tableItem}>{checklistItem.label}</Text>
              <View style={styles.tableResult}>
                <Text style={getBadgeStyle(checklistItem.status)}>{INVENTORY_CHECKLIST_STATUS_LABELS[checklistItem.status]}</Text>
              </View>
              <Text style={checklistItem.comment ? styles.tableComments : [styles.tableComments, styles.emptyComment]}>
                {checklistItem.comment || 'No comments'}
              </Text>
            </View>
          ))}
        </View>

        {check.note ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>General Comments</Text>
            <Text style={styles.noteBox}>{check.note}</Text>
          </View>
        ) : null}

        <View style={styles.footer} fixed>
          <Text>Generated {generatedAt}</Text>
          <Text>Inventory checklist PDF</Text>
        </View>
      </Page>
    </Document>
  );
}
