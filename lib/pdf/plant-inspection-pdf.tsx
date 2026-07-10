import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image as PdfImage } from '@react-pdf/renderer';
import { PLANT_INSPECTION_ITEMS } from '@/lib/checklists/plant-checklists';
import { formatDate } from '@/lib/utils/date';
import { templateConfig } from '@/lib/config/template-config';
import { getPdfContactLine, getPdfRegisteredOfficeLine, getPdfRegistrationLine } from '@/lib/pdf/branding';

const styles = StyleSheet.create({
  page: { padding: 20, fontSize: 7, fontFamily: 'Helvetica' },
  formNumber: {
    position: 'absolute',
    top: 34,
    right: 24,
    fontSize: 14,
    color: '#555',
    fontWeight: 'bold',
  },
  companyHeader: { textAlign: 'center', marginBottom: 8 },
  companyName: { fontSize: 16, fontWeight: 'bold', marginBottom: 1 },
  companyDetails: { fontSize: 6, marginBottom: 1 },
  companyPhone: { fontSize: 8, fontWeight: 'bold' },
  registeredNo: { fontSize: 6, fontStyle: 'italic', marginTop: 1, marginBottom: 2 },
  pageTitle: { fontSize: 11, fontWeight: 'bold', marginTop: 2 },
  topTable: { borderWidth: 1, borderColor: '#000' },
  topRow: { flexDirection: 'row', minHeight: 30 },
  topCell: {
    padding: 4,
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: '#000',
  },
  topCellLast: { padding: 4, justifyContent: 'center' },
  topLabel: { fontSize: 8 },
  topValue: { fontSize: 8, fontWeight: 'bold', marginTop: 3 },
  checklistTable: { borderWidth: 1, borderTopWidth: 0, borderColor: '#000' },
  checklistHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#000',
    backgroundColor: '#f0f0f0',
    minHeight: 18,
    alignItems: 'center',
  },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#000', minHeight: 18 },
  rowLast: { flexDirection: 'row', minHeight: 18 },
  numCell: {
    width: '6%',
    borderRightWidth: 1,
    borderRightColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 2,
  },
  itemCell: {
    width: '50%',
    borderRightWidth: 1,
    borderRightColor: '#000',
    justifyContent: 'center',
    padding: 3,
  },
  passCell: {
    width: '10%',
    borderRightWidth: 1,
    borderRightColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 2,
  },
  failCell: {
    width: '10%',
    borderRightWidth: 1,
    borderRightColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 2,
  },
  commentsCell: { width: '24%', justifyContent: 'center', padding: 3 },
  headerText: { fontSize: 7, fontWeight: 'bold' },
  numText: { fontSize: 8, fontWeight: 'bold' },
  itemText: { fontSize: 7 },
  markText: { fontSize: 7, fontWeight: 'bold' },
  commentsText: { fontSize: 6, lineHeight: 1.2 },
  checkedByBox: {
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: '#000',
    paddingHorizontal: 4,
    paddingVertical: 3,
    minHeight: 34,
    justifyContent: 'center',
  },
  checkedByLabel: { fontSize: 7, fontWeight: 'bold', marginBottom: 2 },
  signatureRow: { flexDirection: 'row', alignItems: 'center' },
  signatureImageWrap: {
    width: 120,
    height: 48,
    borderWidth: 1,
    borderColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  signatureImage: { width: 114, height: 40, objectFit: 'contain' },
  signatureMissing: { fontSize: 6, color: '#666' },
  signerMeta: { fontSize: 7 },
  defectsBox: {
    borderWidth: 1,
    borderColor: '#000',
    marginTop: 5,
    padding: 4,
    minHeight: 70,
  },
  defectsTitle: { fontSize: 8, fontWeight: 'bold', marginBottom: 3 },
  defectsText: { fontSize: 6, lineHeight: 1.2 },
  legendSection: { marginTop: 6, textAlign: 'center' },
  legendText: { fontSize: 6, fontWeight: 'bold', marginBottom: 1 },
  legendNote: { fontSize: 5 },
});

interface PlantInspectionPDFProps {
  inspection: {
    id: string;
    inspection_date: string;
    inspection_end_date: string;
    current_mileage: number | null;
    inspector_comments: string | null;
    signature_data: string | null;
    signed_at?: string | null;
  };
  plant: {
    plant_id: string;
    nickname: string | null;
    serial_number?: string | null;
    van_categories: { name: string } | null;
    isHired?: boolean;
    hiringCompany?: string | null;
  };
  operator: {
    full_name: string;
  };
  items: Array<{
    item_number: number;
    item_description: string;
    day_of_week: number;
    status: 'ok' | 'attention' | 'na';
    comments: string | null;
  }>;
  dailyHours: Array<{
    day_of_week: number;
    hours: number | null;
  }>;
}

export function PlantInspectionPDF({
  inspection,
  plant,
  operator,
  items,
  dailyHours,
}: PlantInspectionPDFProps) {
  const formNumber = inspection.id ? inspection.id.slice(-5).toUpperCase() : '00000';
  const inspectionDay = (() => {
    const date = new Date(inspection.inspection_date);
    const jsDay = date.getDay();
    return jsDay === 0 ? 7 : jsDay;
  })();

  const getSingleItem = (itemNumber: number) => {
    const sameNumber = items.filter((item) => item.item_number === itemNumber);
    if (sameNumber.length === 0) {
      return null;
    }

    const exactDayMatch = sameNumber.find((item) => item.day_of_week === inspectionDay);
    if (exactDayMatch) {
      return exactDayMatch;
    }

    return [...sameNumber].sort((a, b) => a.day_of_week - b.day_of_week)[0];
  };

  const formatSignedAt = (signedAt?: string | null) => {
    if (!signedAt) {
      return '-';
    }
    const date = new Date(signedAt);
    if (Number.isNaN(date.getTime())) {
      return '-';
    }
    const time = date.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return `${formatDate(signedAt)} ${time}`;
  };

  const machineText = plant.isHired
    ? `${plant.plant_id}${plant.nickname ? ` (${plant.nickname})` : ''}`
    : `${plant.plant_id}${plant.nickname ? ` (${plant.nickname})` : ''}${plant.serial_number ? ` (SN: ${plant.serial_number})` : ''}`;
  const checklistItems = (() => {
    const itemByNumber = new Map<number, string>();

    items.forEach((item) => {
      if (itemByNumber.has(item.item_number)) return;
      itemByNumber.set(
        item.item_number,
        item.item_description || PLANT_INSPECTION_ITEMS[item.item_number - 1] || `Item ${item.item_number}`
      );
    });

    if (itemByNumber.size === 0) {
      return PLANT_INSPECTION_ITEMS.map((description, index) => ({
        number: index + 1,
        description,
      }));
    }

    return [...itemByNumber.entries()]
      .sort(([leftNumber], [rightNumber]) => leftNumber - rightNumber)
      .map(([number, description]) => ({ number, description }));
  })();

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.formNumber}>
          <Text>{formNumber}</Text>
        </View>

        <View style={styles.companyHeader}>
          <Text style={[styles.companyName, { color: templateConfig.branding.brandColor }]}>
            {templateConfig.branding.companyName}
          </Text>
          <Text style={styles.companyDetails}>{getPdfRegisteredOfficeLine()}</Text>
          <Text style={styles.companyPhone}>{getPdfContactLine()}</Text>
          <Text style={styles.registeredNo}>{getPdfRegistrationLine()}</Text>
          <Text style={styles.pageTitle}>OPERATED PLANT INSPECTION PAD</Text>
        </View>

        <View style={styles.topTable}>
          <View style={styles.topRow}>
            <View style={[styles.topCell, { width: '44%' }]}>
              <Text style={styles.topLabel}>MACHINE</Text>
              <Text style={styles.topValue}>{machineText}</Text>
            </View>
            <View style={[styles.topCell, { width: '18%' }]}>
              <Text style={styles.topLabel}>HOURS</Text>
              <Text style={styles.topValue}>{inspection.current_mileage != null ? `${inspection.current_mileage}` : '-'}</Text>
            </View>
            <View style={[styles.topCellLast, { width: '38%' }]}>
              <Text style={styles.topLabel}>INSPECTOR NAME</Text>
              <Text style={styles.topValue}>{operator.full_name}</Text>
            </View>
          </View>
        </View>

        <View style={styles.checklistTable}>
          <View style={styles.checklistHeader}>
            <View style={styles.numCell}>
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
          {checklistItems.map((checklistItem, index) => {
            const itemNumber = checklistItem.number;
            const item = getSingleItem(itemNumber);
            const isLast = index === checklistItems.length - 1;
            const rowStyle = isLast ? styles.rowLast : styles.row;
            const passMark = item?.status === 'ok' ? 'PASS' : '';
            const failMark = item?.status === 'attention' ? 'FAIL' : '';
            const itemComments = item?.status === 'na'
              ? ['N/A', item?.comments].filter(Boolean).join(' - ')
              : (item?.comments || '');

            return (
              <View key={itemNumber} style={rowStyle}>
                <View style={styles.numCell}>
                  <Text style={styles.numText}>{String(itemNumber).padStart(2, '0')}</Text>
                </View>
                <View style={styles.itemCell}>
                  <Text style={styles.itemText}>{checklistItem.description}</Text>
                </View>
                <View style={styles.passCell}>
                  <Text style={styles.markText}>{passMark}</Text>
                </View>
                <View style={styles.failCell}>
                  <Text style={styles.markText}>{failMark}</Text>
                </View>
                <View style={styles.commentsCell}>
                  <Text style={styles.commentsText}>{itemComments}</Text>
                </View>
              </View>
            );
          })}
        </View>

        <View style={styles.checkedByBox}>
          <Text style={styles.checkedByLabel}>Checked By</Text>
          <View style={styles.signatureRow}>
            <View style={styles.signatureImageWrap}>
              {inspection.signature_data ? (
                <PdfImage src={inspection.signature_data} style={styles.signatureImage} />
              ) : (
                <Text style={styles.signatureMissing}>No signature</Text>
              )}
            </View>
            <Text style={styles.signerMeta}>
              {operator.full_name}  |  Signed: {formatSignedAt(inspection.signed_at)}
            </Text>
          </View>
        </View>

        <View style={styles.defectsBox}>
          <Text style={styles.defectsTitle}>DEFECTS / COMMENTS</Text>
          <Text style={styles.defectsText}>{inspection.inspector_comments || 'None'}</Text>
        </View>

        <View style={styles.legendSection}>
          <Text style={styles.legendText}>USE THE FOLLOWING: PASS = IN ORDER   FAIL = REQUIRES ATTENTION   N/A = NOT APPLICABLE</Text>
          <Text style={styles.legendNote}>Inspection Date: {formatDate(inspection.inspection_date)}</Text>
          {dailyHours.length > 0 && <Text style={styles.legendNote}>Daily hours records present: {dailyHours.length}</Text>}
          {plant.hiringCompany && <Text style={styles.legendNote}>Hiring Company: {plant.hiringCompany}</Text>}
        </View>
      </Page>
    </Document>
  );
}
