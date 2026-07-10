import React from 'react';
import { Document, Image as PdfImage, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { InspectionItem, VanInspection } from '@/types/inspection';
import { formatDate } from '@/lib/utils/date';
import { buildInspectionPdfCommentsText } from '@/lib/utils/inspection-pdf-comments';
import { templateConfig } from '@/lib/config/template-config';

const styles = StyleSheet.create({
  page: {
    padding: 20,
    fontSize: 7,
    fontFamily: 'Helvetica',
  },
  formNumber: {
    position: 'absolute',
    top: 30,
    right: 30,
    fontSize: 14,
    fontWeight: 'bold',
    color: '#666',
  },
  companyHeader: {
    textAlign: 'center',
    marginBottom: 8,
  },
  companyName: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 1,
    letterSpacing: 0.5,
  },
  companyDetails: {
    fontSize: 6,
    marginBottom: 1,
  },
  companyPhone: {
    fontSize: 8,
    fontWeight: 'bold',
    marginTop: 1,
  },
  registeredNo: {
    fontSize: 6,
    fontStyle: 'italic',
    marginTop: 1,
    marginBottom: 2,
  },
  pageTitle: {
    fontSize: 11,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 6,
  },
  topTable: {
    borderWidth: 1,
    borderColor: '#000',
    marginBottom: 0,
  },
  topRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#000',
    minHeight: 22,
  },
  topRowLast: {
    flexDirection: 'row',
    minHeight: 22,
  },
  topCell: {
    padding: 4,
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: '#000',
  },
  topCellLast: {
    padding: 4,
    justifyContent: 'center',
  },
  topLabel: {
    fontSize: 8,
    fontWeight: 'bold',
  },
  topValue: {
    fontSize: 8,
    marginTop: 2,
  },
  checklistTable: {
    borderWidth: 1,
    borderColor: '#000',
    borderTopWidth: 0,
  },
  tableHeader: {
    flexDirection: 'row',
    minHeight: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#000',
    backgroundColor: '#efefef',
  },
  checklistRow: {
    flexDirection: 'row',
    minHeight: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#000',
  },
  checklistRowLast: {
    flexDirection: 'row',
    minHeight: 18,
  },
  numberCell: {
    width: '6%',
    padding: 3,
    justifyContent: 'center',
    alignItems: 'center',
    borderRightWidth: 1,
    borderRightColor: '#000',
  },
  itemCell: {
    width: '49%',
    padding: 3,
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: '#000',
  },
  passCell: {
    width: '11%',
    padding: 3,
    justifyContent: 'center',
    alignItems: 'center',
    borderRightWidth: 1,
    borderRightColor: '#000',
  },
  failCell: {
    width: '11%',
    padding: 3,
    justifyContent: 'center',
    alignItems: 'center',
    borderRightWidth: 1,
    borderRightColor: '#000',
  },
  commentsCell: {
    width: '23%',
    padding: 3,
    justifyContent: 'center',
  },
  headerText: {
    fontSize: 7,
    fontWeight: 'bold',
  },
  numberText: {
    fontSize: 8,
    fontWeight: 'bold',
  },
  itemText: {
    fontSize: 7,
  },
  statusText: {
    fontSize: 6,
    fontWeight: 'bold',
  },
  commentsText: {
    fontSize: 6,
    lineHeight: 1.2,
  },
  checkedBySection: {
    borderWidth: 1,
    borderColor: '#000',
    borderTopWidth: 0,
    padding: 4,
    minHeight: 34,
  },
  checkedByLabel: {
    fontSize: 7,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  checkedByText: {
    fontSize: 7,
  },
  signatureRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  signatureImageWrap: {
    width: 120,
    height: 48,
    borderWidth: 1,
    borderColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  signatureImage: {
    width: 114,
    height: 40,
    objectFit: 'contain',
  },
  signatureMissing: {
    fontSize: 6,
    color: '#666',
  },
  commentsBox: {
    borderWidth: 1,
    borderColor: '#000',
    marginTop: 4,
    padding: 4,
    minHeight: 40,
  },
  commentsTitle: {
    fontSize: 7,
    fontWeight: 'bold',
    marginBottom: 2,
  },
});

interface VanInspectionPDFProps {
  inspection: VanInspection;
  items: InspectionItem[];
  vehicleReg?: string;
  employeeName?: string;
}

function formatSignedAt(signedAt?: string | null) {
  if (!signedAt) return '-';

  const date = new Date(signedAt);
  if (Number.isNaN(date.getTime())) return '-';

  const time = date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${formatDate(signedAt)} ${time}`;
}

function getRowComment(item: InspectionItem): string {
  if (item.status === 'na') {
    return item.comments ? `N/A - ${item.comments}` : 'N/A';
  }

  return item.comments || '';
}

export function VanInspectionPDF({ inspection, items, vehicleReg, employeeName }: VanInspectionPDFProps) {
  const formNumber = inspection.id ? inspection.id.slice(-5).toUpperCase() : '00000';
  const sortedItems = [...items].sort((left, right) => left.item_number - right.item_number);
  const defectsAndComments = buildInspectionPdfCommentsText({
    inspectorComments: inspection.inspector_comments,
    items: items as Array<InspectionItem & { day_of_week?: number | null }>,
  });

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.formNumber}>
          <Text>{formNumber}</Text>
        </View>

        <View style={styles.companyHeader}>
          <Text style={styles.companyName}>{templateConfig.branding.companyName}</Text>
          <Text style={styles.companyDetails}>
            REGISTERED OFFICE: VIVIENNE HOUSE, RACECOURSE ROAD, CREW LANE INDUSTRIAL ESTATE, SOUTHWELL, NOTTS. NG25 0TX
          </Text>
          <Text style={styles.companyPhone}>Telephone: SOUTHWELL (01636) 812227</Text>
          <Text style={styles.registeredNo}>Registered in England No. 1000918</Text>
          <Text style={styles.pageTitle}>COMPANY VAN DAILY CHECK</Text>
        </View>

        <View style={styles.topTable}>
          <View style={styles.topRow}>
            <View style={[styles.topCell, { width: '25%' }]}>
              <Text style={styles.topLabel}>REG NO.</Text>
              <Text style={styles.topValue}>{vehicleReg || ''}</Text>
            </View>
            <View style={[styles.topCell, { width: '25%' }]}>
              <Text style={styles.topLabel}>MILEAGE</Text>
              <Text style={styles.topValue}>{inspection.current_mileage || ''}</Text>
            </View>
            <View style={[styles.topCell, { width: '25%' }]}>
              <Text style={styles.topLabel}>INSPECTION DATE</Text>
              <Text style={styles.topValue}>{formatDate(inspection.inspection_date)}</Text>
            </View>
            <View style={[styles.topCellLast, { width: '25%' }]}>
              <Text style={styles.topLabel}>DRIVER NAME</Text>
              <Text style={styles.topValue}>{employeeName || ''}</Text>
            </View>
          </View>
          <View style={styles.topRowLast}>
            <View style={[styles.topCell, { width: '50%' }]}>
              <Text style={styles.topLabel}>SUBMITTED</Text>
              <Text style={styles.topValue}>{formatSignedAt(inspection.signed_at || inspection.submitted_at)}</Text>
            </View>
            <View style={[styles.topCellLast, { width: '50%' }]}>
              <Text style={styles.topLabel}>STATUS</Text>
              <Text style={styles.topValue}>{inspection.status.toUpperCase()}</Text>
            </View>
          </View>
        </View>

        <View style={styles.checklistTable}>
          <View style={styles.tableHeader}>
            <View style={styles.numberCell}>
              <Text style={styles.headerText}>#</Text>
            </View>
            <View style={styles.itemCell}>
              <Text style={styles.headerText}>CHECKLIST ITEM</Text>
            </View>
            <View style={styles.passCell}>
              <Text style={styles.headerText}>PASS</Text>
            </View>
            <View style={styles.failCell}>
              <Text style={styles.headerText}>FAIL</Text>
            </View>
            <View style={styles.commentsCell}>
              <Text style={styles.headerText}>COMMENTS</Text>
            </View>
          </View>
          {sortedItems.map((item, index) => (
            <View key={item.id} style={index === sortedItems.length - 1 ? styles.checklistRowLast : styles.checklistRow}>
              <View style={styles.numberCell}>
                <Text style={styles.numberText}>{String(item.item_number).padStart(2, '0')}</Text>
              </View>
              <View style={styles.itemCell}>
                <Text style={styles.itemText}>{item.item_description}</Text>
              </View>
              <View style={styles.passCell}>
                <Text style={styles.statusText}>{item.status === 'ok' ? 'PASS' : ''}</Text>
              </View>
              <View style={styles.failCell}>
                <Text style={styles.statusText}>{item.status === 'attention' || item.status === 'defect' ? 'FAIL' : ''}</Text>
              </View>
              <View style={styles.commentsCell}>
                <Text style={styles.commentsText}>{getRowComment(item)}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.checkedBySection}>
          <Text style={styles.checkedByLabel}>Checked By</Text>
          <View style={styles.signatureRow}>
            <View style={styles.signatureImageWrap}>
              {inspection.signature_data ? (
                <PdfImage src={inspection.signature_data} style={styles.signatureImage} />
              ) : (
                <Text style={styles.signatureMissing}>No signature</Text>
              )}
            </View>
            <Text style={styles.checkedByText}>
              {employeeName || ''}  |  Signed: {formatSignedAt(inspection.signed_at)}
            </Text>
          </View>
        </View>

        <View style={styles.commentsBox}>
          <Text style={styles.commentsTitle}>DEFECTS/COMMENTS</Text>
          <Text style={styles.commentsText}>
            {defectsAndComments || 'No defects or additional comments recorded.'}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
