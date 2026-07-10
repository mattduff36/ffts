import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image as PdfImage } from '@react-pdf/renderer';
import { Timesheet, DAY_NAMES } from '@/types/timesheet';
import { formatDate } from '@/lib/utils/date';
import { getDidNotWorkReasonInfo } from '@/lib/utils/timesheetDidNotWork';
import type { TimesheetOffDayState } from '@/lib/utils/timesheet-off-days';
import { buildLeaveAwareTotals } from '@/lib/utils/timesheet-leave-totals';
import { formatEntryJobNumbers, getPrimaryJobNumber } from '@/lib/utils/timesheet-job-codes';
import { addSubsistenceRemark } from '@/lib/utils/timesheet-subsistence';
import { templateConfig } from '@/lib/config/template-config';

// Create styles for the PDF matching the scanned form
const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 9,
    fontFamily: 'Helvetica',
  },
  // Form number in top right
  formNumber: {
    position: 'absolute',
    top: 40,
    right: 40,
    fontSize: 14,
    fontWeight: 'bold',
    color: '#666',
  },
  // Company header
  companyHeader: {
    textAlign: 'center',
    marginBottom: 30,
  },
  companyName: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 3,
    letterSpacing: 0.5,
  },
  companyDetails: {
    fontSize: 8,
    marginBottom: 2,
  },
  companyPhone: {
    fontSize: 10,
    fontWeight: 'bold',
    marginTop: 3,
  },
  // Top info section
  topInfo: {
    flexDirection: 'row',
    marginBottom: 20,
    marginTop: 10,
  },
  infoField: {
    flex: 1,
    flexDirection: 'row',
  },
  infoLabel: {
    fontSize: 9,
    marginRight: 5,
  },
  infoDots: {
    flex: 1,
    borderBottomWidth: 1,
    borderBottomColor: '#666',
    borderBottomStyle: 'dotted',
    marginRight: 10,
    minHeight: 12,
    justifyContent: 'flex-end',
    paddingBottom: 1,
  },
  // Table
  table: {
    marginTop: 5,
    borderWidth: 1,
    borderColor: '#000',
  },
  tableHeaderRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#000',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#000',
    minHeight: 35,
  },
  tableTotalRow: {
    flexDirection: 'row',
    minHeight: 35,
  },
  // Column styles
  colDay: {
    width: '12%',
    padding: 6,
    borderRightWidth: 1,
    borderRightColor: '#000',
    justifyContent: 'center',
  },
  colTimeStarted: {
    width: '12%',
    padding: 6,
    borderRightWidth: 1,
    borderRightColor: '#000',
    justifyContent: 'center',
  },
  colWorkingYard: {
    width: '12%',
    padding: 6,
    borderRightWidth: 1,
    borderRightColor: '#000',
    justifyContent: 'center',
  },
  colTimeFinished: {
    width: '12%',
    padding: 6,
    borderRightWidth: 1,
    borderRightColor: '#000',
    justifyContent: 'center',
  },
  colDailyTotal: {
    width: '10%',
    padding: 6,
    borderRightWidth: 1,
    borderRightColor: '#000',
    justifyContent: 'center',
  },
  colRemarks: {
    width: '42%',
    padding: 6,
    justifyContent: 'center',
  },
  headerText: {
    fontSize: 8,
    textAlign: 'center',
  },
  cellText: {
    fontSize: 8,
    textAlign: 'center',
  },
  // Footer section
  footer: {
    marginTop: 30,
  },
  footerText: {
    fontSize: 8,
    marginBottom: 20,
  },
  signatureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    justifyContent: 'space-between',
  },
  signatureLeftSection: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  signatureLabel: {
    fontSize: 9,
    marginRight: 10,
  },
  signatureRightSection: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  signatureDots: {
    width: 180,
    borderBottomWidth: 1,
    borderBottomColor: '#000',
    borderBottomStyle: 'dotted',
    height: 40,
    marginRight: 10,
  },
  signatureImage: {
    width: 180,
    height: 40,
    marginRight: 10,
  },
  signatureRightLabel: {
    fontSize: 9,
  },
});

interface TimesheetPDFProps {
  timesheet: Timesheet;
  employeeName?: string;
  offDayStates?: TimesheetOffDayState[];
}

export function TimesheetPDF({ timesheet, employeeName, offDayStates = [] }: TimesheetPDFProps) {
  // Sort entries by day of week
  const sortedEntries = (timesheet.entries || []).sort((a, b) => a.day_of_week - b.day_of_week);
  
  // Get form number (last 5 digits of ID or full ID if shorter)
  const formNumber = timesheet.id 
    ? timesheet.id.slice(-5).toUpperCase() 
    : '00000';

  // Helper to format remarks with job number (entry may be full TimesheetEntry or partial from allDays)
  const formatRemarks = (entry: {
    job_number?: string | null;
    job_numbers?: string[];
    remarks?: string | null;
    subsistence_payment_required?: boolean | null;
  }) => {
    const jobNumber = getPrimaryJobNumber(entry);
    const remarks = entry.subsistence_payment_required
      ? addSubsistenceRemark(entry.remarks)
      : entry.remarks;
    const formattedJobNumbers = formatEntryJobNumbers(entry);
    
    if (jobNumber && remarks) {
      return `Job number${formattedJobNumbers.includes(',') ? 's' : ''} ${formattedJobNumbers} - ${remarks}`;
    } else if (jobNumber) {
      return `Job number${formattedJobNumbers.includes(',') ? 's' : ''} ${formattedJobNumbers}`;
    } else if (remarks) {
      return remarks;
    }
    return '';
  };

  // Create an array with all 7 days
  const allDays = [1, 2, 3, 4, 5, 6, 7].map(dayNum => {
    const entry = sortedEntries.find(e => e.day_of_week === dayNum);
    return entry || {
      day_of_week: dayNum,
      time_started: '',
      time_finished: '',
      working_in_yard: false,
      daily_total: 0,
      remarks: '',
      subsistence_payment_required: false,
      did_not_work: false,
    };
  });
  const leaveAwareTotals = buildLeaveAwareTotals(allDays, offDayStates);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Form Number in top right */}
        <View style={styles.formNumber}>
          <Text>{formNumber}</Text>
        </View>

        {/* Company Header */}
        <View style={styles.companyHeader}>
          <Text style={styles.companyName}>{templateConfig.branding.companyName}</Text>
          <Text style={styles.companyDetails}>
            REGISTERED OFFICE: VIVIENNE HOUSE, RACECOURSE ROAD, CREW LANE INDUSTRIAL ESTATE, SOUTHWELL, NOTTS. NG25 0TX
          </Text>
          <Text style={styles.companyPhone}>Telephone: SOUTHWELL (01636) 812227</Text>
        </View>

        {/* Top Info Section */}
        <View style={styles.topInfo}>
          <View style={styles.infoField}>
            <Text style={styles.infoLabel}>Reg No.</Text>
            <View style={styles.infoDots}>
              <Text style={{ fontSize: 9, paddingLeft: 5 }}>{timesheet.reg_number || ''}</Text>
            </View>
          </View>
          <View style={styles.infoField}>
            <Text style={styles.infoLabel}>W/E Sunday</Text>
            <View style={styles.infoDots}>
              <Text style={{ fontSize: 9, paddingLeft: 5 }}>{formatDate(new Date(timesheet.week_ending))}</Text>
            </View>
          </View>
        </View>

        <View style={{ marginBottom: 20 }}>
          <View style={styles.infoField}>
            <Text style={styles.infoLabel}>Driver</Text>
            <View style={styles.infoDots}>
              <Text style={{ fontSize: 9, paddingLeft: 5 }}>{employeeName || ''}</Text>
            </View>
          </View>
        </View>

        {/* Table */}
        <View style={styles.table}>
          {/* Header Row */}
          <View style={styles.tableHeaderRow}>
            <View style={styles.colDay}>
              <Text style={styles.headerText}></Text>
            </View>
            <View style={styles.colTimeStarted}>
              <Text style={styles.headerText}>Time{'\n'}Started</Text>
            </View>
            <View style={styles.colWorkingYard}>
              <Text style={styles.headerText}>Working{'\n'}in Yard</Text>
            </View>
            <View style={styles.colTimeFinished}>
              <Text style={styles.headerText}>Time{'\n'}Finished</Text>
            </View>
            <View style={styles.colDailyTotal}>
              <Text style={styles.headerText}>Daily{'\n'}Total</Text>
            </View>
            <View style={styles.colRemarks}>
              <Text style={styles.headerText}>Remarks{'\n'}(Type of work, reason for delay etc.)</Text>
            </View>
          </View>

          {/* Data Rows - All 7 days */}
          {allDays.map((entry, index) => (
            <View key={index} style={styles.tableRow}>
              <View style={styles.colDay}>
                <Text style={[styles.cellText, { textAlign: 'left' }]}>{DAY_NAMES[entry.day_of_week - 1]}</Text>
              </View>
              <View style={styles.colTimeStarted}>
                <Text style={styles.cellText}>
                  {entry.did_not_work ? '' : (entry.time_started || '')}
                </Text>
              </View>
              <View style={styles.colWorkingYard}>
                <Text style={styles.cellText}>
                  {entry.did_not_work ? '' : (entry.working_in_yard ? 'Yes' : '')}
                </Text>
              </View>
              <View style={styles.colTimeFinished}>
                <Text style={styles.cellText}>
                  {entry.did_not_work ? '' : (entry.time_finished || '')}
                </Text>
              </View>
              <View style={styles.colDailyTotal}>
                <Text style={styles.cellText}>
                  {leaveAwareTotals.rowByDay.get(entry.day_of_week)?.display || ''}
                </Text>
              </View>
              <View style={styles.colRemarks}>
                <Text style={[styles.cellText, { textAlign: 'left' }]}>
                  {entry.did_not_work
                    ? getDidNotWorkReasonInfo(
                        entry.did_not_work,
                        entry.remarks?.trim() ? entry.remarks : 'Not on Shift'
                      ).combinedDisplay
                    : formatRemarks(entry)}
                </Text>
              </View>
            </View>
          ))}

          {/* Total Row */}
          <View style={styles.tableTotalRow}>
            <View style={styles.colDay}>
              <Text style={[styles.cellText, { textAlign: 'left', fontWeight: 'bold' }]}>TOTAL</Text>
            </View>
            <View style={styles.colTimeStarted}>
              <Text style={styles.cellText}></Text>
            </View>
            <View style={styles.colWorkingYard}>
              <Text style={styles.cellText}></Text>
            </View>
            <View style={styles.colTimeFinished}>
              <Text style={styles.cellText}></Text>
            </View>
            <View style={styles.colDailyTotal}>
              <Text style={[styles.cellText, { fontWeight: 'bold' }]}>{leaveAwareTotals.weekly.display}</Text>
            </View>
            <View style={styles.colRemarks}>
              <Text style={styles.cellText}></Text>
            </View>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            All time and other details are correct and should{'\n'}be used as a basis for wages etc.
          </Text>

          <View style={styles.signatureRow}>
            <View style={styles.signatureLeftSection}>
              <Text style={styles.signatureLabel}>Driver:</Text>
              <Text style={{ fontSize: 9 }}>{employeeName || ''}</Text>
            </View>
            <View style={styles.signatureRightSection}>
              <Text style={styles.signatureRightLabel}>Signature</Text>
              {timesheet.signature_data ? (
                <PdfImage style={styles.signatureImage} src={timesheet.signature_data} />
              ) : (
                <View style={styles.signatureDots} />
              )}
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
}
