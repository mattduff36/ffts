import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image as PdfImage } from '@react-pdf/renderer';
import { TRUCK_CHECKLIST_ITEMS } from '@/lib/checklists/vehicle-checklists';
import { formatDate } from '@/lib/utils/date';
import type { EnrichedDefectItem } from '@/lib/utils/hgvDefectWorkshopDetails';
import { templateConfig } from '@/lib/config/template-config';

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
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#000', minHeight: 17 },
  rowLast: { flexDirection: 'row', minHeight: 17 },
  numCell: {
    width: '6%',
    borderRightWidth: 1,
    borderRightColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 2,
  },
  itemCell: {
    width: '44%',
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
  naCell: {
    width: '10%',
    borderRightWidth: 1,
    borderRightColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 2,
  },
  commentsCell: { width: '20%', justifyContent: 'center', padding: 3 },
  headerText: { fontSize: 7, fontWeight: 'bold' },
  numText: { fontSize: 8, fontWeight: 'bold' },
  itemText: { fontSize: 6.5 },
  markText: { fontSize: 7, fontWeight: 'bold' },
  commentsText: { fontSize: 6, lineHeight: 1.2 },
  sectionDividerRow: {
    borderBottomWidth: 1,
    borderBottomColor: '#000',
    backgroundColor: '#eef4ff',
  },
  sectionDividerText: {
    fontSize: 7,
    fontWeight: 'bold',
    textAlign: 'center',
    paddingVertical: 3,
  },
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
    minHeight: 48,
  },
  defectsTitle: { fontSize: 8, fontWeight: 'bold', marginBottom: 3 },
  defectsText: { fontSize: 6, lineHeight: 1.2 },
  defectItemWrap: { marginTop: 3 },
  defectItemTitle: { fontSize: 6.2, fontWeight: 'bold' },
  defectItemBody: { fontSize: 5.8, lineHeight: 1.2 },
  workshopSignatureWrap: {
    width: 90,
    height: 28,
    borderWidth: 1,
    borderColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  workshopSignatureImage: { width: 84, height: 22, objectFit: 'contain' },
  legendSection: { marginTop: 6, textAlign: 'center' },
  legendText: { fontSize: 6, fontWeight: 'bold', marginBottom: 1 },
  legendNote: { fontSize: 5 },
});

interface HgvInspectionPDFProps {
  inspection: {
    id: string;
    inspection_date: string;
    current_mileage: number | null;
    inspector_comments: string | null;
    signature_data?: string | null;
    signed_at?: string | null;
  };
  hgv: {
    reg_number: string;
    nickname: string | null;
    hgv_categories: { name: string } | null;
  };
  operator: { full_name: string };
  items: Array<{
    item_number: number;
    item_description: string;
    day_of_week?: number;
    status: 'ok' | 'attention' | 'na';
    comments: string | null;
  }>;
  defectsWithWorkshop?: EnrichedDefectItem[];
}

export function HgvInspectionPDF({ inspection, hgv, operator, items, defectsWithWorkshop = [] }: HgvInspectionPDFProps) {
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
    return [...sameNumber].sort((a, b) => (a.day_of_week || 0) - (b.day_of_week || 0))[0];
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

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.formNumber}>
          <Text>{formNumber}</Text>
        </View>

        <View style={styles.companyHeader}>
          <Text style={styles.companyName}>{templateConfig.branding.companyName}</Text>
          <Text style={styles.companyDetails}>
            REGISTERED OFFICE: 1 TEMPLATE ROAD, SAMPLE BUSINESS PARK, SAMPLE CITY, AB1 2CD
          </Text>
          <Text style={styles.companyPhone}>Telephone: SOUTHWELL (01636) 812227</Text>
          <Text style={styles.registeredNo}>Registered in England No. 1000918</Text>
          <Text style={styles.pageTitle}>HGV INSPECTION PAD</Text>
        </View>

        <View style={styles.topTable}>
          <View style={styles.topRow}>
            <View style={[styles.topCell, { width: '40%' }]}>
              <Text style={styles.topLabel}>MACHINE</Text>
              <Text style={styles.topValue}>{hgv.reg_number}</Text>
            </View>
            <View style={[styles.topCell, { width: '20%' }]}>
              <Text style={styles.topLabel}>HOURS / KM</Text>
              <Text style={styles.topValue}>{inspection.current_mileage ?? '-'}</Text>
            </View>
            <View style={[styles.topCellLast, { width: '40%' }]}>
              <Text style={styles.topLabel}>OPERATOR&apos;S NAME</Text>
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
            <View style={styles.naCell}>
              <Text style={styles.headerText}>N/A</Text>
            </View>
            <View style={styles.commentsCell}>
              <Text style={styles.headerText}>COMMENTS</Text>
            </View>
          </View>
          {TRUCK_CHECKLIST_ITEMS.map((itemLabel, index) => {
            const itemNumber = index + 1;
            const item = getSingleItem(itemNumber);
            const isLast = index === TRUCK_CHECKLIST_ITEMS.length - 1;
            const rowStyle = isLast ? styles.rowLast : styles.row;
            const passMark = item?.status === 'ok' ? 'PASS' : '';
            const failMark = item?.status === 'attention' ? 'FAIL' : '';
            const naMark = item?.status === 'na' ? 'N/A' : '';
            const itemComments = item?.comments || '';

            return (
              <React.Fragment key={itemNumber}>
                {itemNumber === 22 && (
                  <View style={styles.sectionDividerRow}>
                    <Text style={styles.sectionDividerText}>Artics only</Text>
                  </View>
                )}
                <View style={rowStyle}>
                  <View style={styles.numCell}>
                    <Text style={styles.numText}>{String(itemNumber).padStart(2, '0')}</Text>
                  </View>
                  <View style={styles.itemCell}>
                    <Text style={styles.itemText}>{itemLabel}</Text>
                  </View>
                  <View style={styles.passCell}>
                    <Text style={styles.markText}>{passMark}</Text>
                  </View>
                  <View style={styles.failCell}>
                    <Text style={styles.markText}>{failMark}</Text>
                  </View>
                  <View style={styles.naCell}>
                    <Text style={styles.markText}>{naMark}</Text>
                  </View>
                  <View style={styles.commentsCell}>
                    <Text style={styles.commentsText}>{itemComments}</Text>
                  </View>
                </View>
              </React.Fragment>
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
          {defectsWithWorkshop.map((defect) => {
            const latestWorkshopTask = defect.workshop_tasks[0];
            return (
              <View key={defect.id} style={styles.defectItemWrap}>
                <Text style={styles.defectItemTitle}>
                  {defect.item_number}. {defect.item_description}
                </Text>
                <Text style={styles.defectItemBody}>
                  Defect note: {defect.comments || 'None'}
                </Text>
                {latestWorkshopTask ? (
                  <>
                    <Text style={styles.defectItemBody}>
                      Workshop complete: {latestWorkshopTask.completed_at ? formatDate(latestWorkshopTask.completed_at) : '-'} by {latestWorkshopTask.completed_by}
                    </Text>
                    <Text style={styles.defectItemBody}>
                      Completion note: {latestWorkshopTask.completed_comment || 'None'}
                    </Text>
                    {latestWorkshopTask.completion_signed_at && (
                      <Text style={styles.defectItemBody}>
                        Signed: {formatDate(latestWorkshopTask.completion_signed_at)}
                      </Text>
                    )}
                    {latestWorkshopTask.completion_signature_data && (
                      <View style={styles.workshopSignatureWrap}>
                        <PdfImage src={latestWorkshopTask.completion_signature_data} style={styles.workshopSignatureImage} />
                      </View>
                    )}
                    {latestWorkshopTask.timeline.slice(-3).map((event) => (
                      <Text key={event.id} style={styles.defectItemBody}>
                        - {formatDate(event.created_at)} {event.status}: {event.body}
                      </Text>
                    ))}
                  </>
                ) : (
                  <Text style={styles.defectItemBody}>Workshop status: Not completed</Text>
                )}
              </View>
            );
          })}
        </View>

        <View style={styles.legendSection}>
          <Text style={styles.legendText}>USE THE FOLLOWING: PASS = IN ORDER   FAIL = REQUIRES ATTENTION   N/A = NOT APPLICABLE</Text>
          <Text style={styles.legendNote}>Inspection Date: {formatDate(inspection.inspection_date)}</Text>
          <Text style={styles.legendNote}>Category: {hgv.hgv_categories?.name || 'Uncategorised'}{hgv.nickname ? ` | Nickname: ${hgv.nickname}` : ''}</Text>
        </View>
      </Page>
    </Document>
  );
}
