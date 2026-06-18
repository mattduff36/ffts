import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image as PdfImage } from '@react-pdf/renderer';
import { VanInspection, InspectionItem } from '@/types/inspection';
import { formatDate } from '@/lib/utils/date';
import { buildInspectionPdfCommentsText } from '@/lib/utils/inspection-pdf-comments';
import { templateConfig } from '@/lib/config/template-config';
import { getPdfContactLine, getPdfRegisteredOfficeLine, getPdfRegistrationLine } from '@/lib/pdf/branding';

// Create styles for the PDF matching the Van inspection form
const styles = StyleSheet.create({
  page: {
    padding: 20,
    fontSize: 7,
    fontFamily: 'Helvetica',
  },
  // Form number in top right
  formNumber: {
    position: 'absolute',
    top: 30,
    right: 30,
    fontSize: 14,
    fontWeight: 'bold',
    color: '#666',
  },
  // Company header
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
  // Top info table
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
  // Week ending row with day columns
  weekRow: {
    flexDirection: 'row',
    minHeight: 18,
  },
  weekLabel: {
    width: '40%',
    padding: 4,
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: '#000',
  },
  dayCell: {
    width: '8.57%', // 60% / 7 days
    padding: 4,
    justifyContent: 'center',
    alignItems: 'center',
    borderRightWidth: 1,
    borderRightColor: '#000',
  },
  dayCellLast: {
    width: '8.57%',
    padding: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dayText: {
    fontSize: 7,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  // Checklist table
  checklistTable: {
    borderWidth: 1,
    borderColor: '#000',
    borderTopWidth: 0,
  },
  checklistRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#000',
    minHeight: 16,
  },
  checklistRowLast: {
    flexDirection: 'row',
    minHeight: 16,
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
    width: '34%',
    padding: 3,
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: '#000',
  },
  checkCell: {
    width: '8.57%',
    padding: 2,
    justifyContent: 'center',
    alignItems: 'center',
    borderRightWidth: 1,
    borderRightColor: '#000',
  },
  checkCellLast: {
    width: '8.57%',
    padding: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  numberText: {
    fontSize: 8,
    fontWeight: 'bold',
  },
  itemText: {
    fontSize: 7,
  },
  checkText: {
    fontSize: 6,
    fontWeight: 'bold',
  },
  // Checked by section
  checkedBySection: {
    borderWidth: 1,
    borderColor: '#000',
    borderTopWidth: 0,
    padding: 4,
    minHeight: 34,
  },
  checkedByText: {
    fontSize: 7,
  },
  checkedByLabel: {
    fontSize: 7,
    fontWeight: 'bold',
    marginBottom: 2,
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
  // Comments sections
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
  commentsText: {
    fontSize: 6,
    lineHeight: 1.2,
  },
});

interface VanInspectionPDFProps {
  inspection: VanInspection;
  items: InspectionItem[];
  vehicleReg?: string;
  employeeName?: string;
}

export function VanInspectionPDF({ inspection, items, vehicleReg, employeeName }: VanInspectionPDFProps) {
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

  // Get form number (last 5 digits of ID or full ID if shorter)
  const formNumber = inspection.id 
    ? inspection.id.slice(-5).toUpperCase() 
    : '00000';

  // Get unique item descriptions from the items (should be 14 for Van)
  const uniqueItems: { number: number; description: string }[] = [];
  const seenNumbers = new Set<number>();
  
  items.forEach(item => {
    if (!seenNumbers.has(item.item_number)) {
      seenNumbers.add(item.item_number);
      uniqueItems.push({
        number: item.item_number,
        description: item.item_description,
      });
    }
  });
  
  // Sort by item number
  uniqueItems.sort((a, b) => a.number - b.number);

  // Helper to get check text for an item on a specific day (1=Monday, 7=Sunday)
  const getCheckMark = (itemNumber: number, dayOfWeek: number) => {
    const item = items.find(i => 
      Number(i.item_number) === Number(itemNumber) && 
      Number((i as unknown as { day_of_week?: number }).day_of_week ?? 0) === Number(dayOfWeek)
    );
    if (!item) return '';
    return item.status === 'ok' ? 'PASS' : item.status === 'attention' ? 'FAIL' : 'N/A';
  };

  const defectsAndComments = buildInspectionPdfCommentsText({
    inspectorComments: inspection.inspector_comments,
    items: items as Array<InspectionItem & { day_of_week?: number | null }>,
  });

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Form Number in top right */}
        <View style={styles.formNumber}>
          <Text>{formNumber}</Text>
        </View>

        {/* Company Header */}
        <View style={styles.companyHeader}>
          <Text style={[styles.companyName, { color: templateConfig.branding.brandColor }]}>
            {templateConfig.branding.companyName}
          </Text>
          <Text style={styles.companyDetails}>{getPdfRegisteredOfficeLine()}</Text>
          <Text style={styles.companyPhone}>{getPdfContactLine()}</Text>
          <Text style={styles.registeredNo}>{getPdfRegistrationLine()}</Text>
          <Text style={styles.pageTitle}>COMPANY VAN INSPECTION PAD</Text>
        </View>

        {/* Top Info Table */}
        <View style={styles.topTable}>
          <View style={styles.topRow}>
            <View style={[styles.topCell, { width: '30%' }]}>
              <Text style={styles.topLabel}>REG NO.</Text>
              <Text style={styles.topValue}>{vehicleReg || ''}</Text>
            </View>
            <View style={[styles.topCell, { width: '30%' }]}>
              <Text style={styles.topLabel}>MILEAGE</Text>
              <Text style={styles.topValue}>{inspection.current_mileage || ''}</Text>
            </View>
            <View style={[styles.topCellLast, { width: '40%' }]}>
              <Text style={styles.topLabel}>DRIVER NAME</Text>
              <Text style={styles.topValue}>{employeeName || ''}</Text>
            </View>
          </View>

          {/* Week Ending Row with Day Columns */}
          <View style={styles.weekRow}>
            <View style={styles.weekLabel}>
              <Text style={styles.topLabel}>WEEK ENDING DATE.</Text>
              <Text style={styles.topValue}>{inspection.inspection_end_date ? formatDate(new Date(inspection.inspection_end_date)) : ''}</Text>
            </View>
            <View style={styles.dayCell}>
              <Text style={styles.dayText}>MON</Text>
            </View>
            <View style={styles.dayCell}>
              <Text style={styles.dayText}>TUE</Text>
            </View>
            <View style={styles.dayCell}>
              <Text style={styles.dayText}>WED</Text>
            </View>
            <View style={styles.dayCell}>
              <Text style={styles.dayText}>THUR</Text>
            </View>
            <View style={styles.dayCell}>
              <Text style={styles.dayText}>FRI</Text>
            </View>
            <View style={styles.dayCell}>
              <Text style={styles.dayText}>SAT</Text>
            </View>
            <View style={styles.dayCellLast}>
              <Text style={styles.dayText}>SUN</Text>
            </View>
          </View>
        </View>

        {/* Checklist Table */}
        <View style={styles.checklistTable}>
          {uniqueItems.map((item, index) => (
            <View key={item.number} style={index === uniqueItems.length - 1 ? styles.checklistRowLast : styles.checklistRow}>
              <View style={styles.numberCell}>
                <Text style={styles.numberText}>{String(item.number).padStart(2, '0')}</Text>
              </View>
              <View style={styles.itemCell}>
                <Text style={styles.itemText}>{item.description}</Text>
              </View>
              {/* 7 day columns (1=Mon, 2=Tue, ..., 7=Sun) */}
              {[1, 2, 3, 4, 5, 6].map((dayOfWeek) => (
                <View key={dayOfWeek} style={styles.checkCell}>
                  <Text style={styles.checkText}>{getCheckMark(item.number, dayOfWeek)}</Text>
                </View>
              ))}
              <View style={styles.checkCellLast}>
                <Text style={styles.checkText}>{getCheckMark(item.number, 7)}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Checked By Section */}
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

        {/* Defects / Comments Section */}
        <View style={styles.commentsBox}>
          <Text style={styles.commentsTitle}>DEFECTS/COMMENTS</Text>
          <Text style={styles.commentsText}>
            {defectsAndComments || '................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................'}
          </Text>
        </View>
      </Page>
    </Document>
  );
}


