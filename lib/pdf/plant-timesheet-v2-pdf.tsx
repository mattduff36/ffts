import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image as PdfImage } from '@react-pdf/renderer';
import { DAY_NAMES, Timesheet } from '@/types/timesheet';
import { formatDate } from '@/lib/utils/date';
import { getDidNotWorkReasonInfo } from '@/lib/utils/timesheetDidNotWork';
import type { TimesheetOffDayState } from '@/lib/utils/timesheet-off-days';
import { buildLeaveAwareTotals } from '@/lib/utils/timesheet-leave-totals';
import { normalizeTimesheetEntriesForDisplay } from '@/lib/utils/plant-timesheet-v2-normalization';
import { formatEntryJobNumbers } from '@/lib/utils/timesheet-job-codes';
import { addSubsistenceRemark } from '@/lib/utils/timesheet-subsistence';
import { templateConfig } from '@/lib/config/template-config';

const styles = StyleSheet.create({
  page: {
    paddingTop: 24,
    paddingBottom: 24,
    paddingHorizontal: 28,
    fontSize: 9,
    fontFamily: 'Helvetica',
  },
  formNumber: {
    position: 'absolute',
    top: 24,
    right: 22,
    fontSize: 16,
    color: '#666',
  },
  companyHeader: {
    textAlign: 'center',
    marginBottom: 10,
  },
  companyName: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  companyDetails: {
    fontSize: 7.5,
    marginBottom: 2,
  },
  companyPhone: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  headerGrid: {
    marginTop: 4,
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  hiredHeaderBlock: {
    marginTop: 2,
    borderWidth: 1,
    borderColor: '#aaa',
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  hiredHeaderTitle: {
    fontSize: 7.5,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  hiredHeaderLine: {
    fontSize: 7,
    marginBottom: 1,
  },
  headerCell: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  headerLabel: {
    fontSize: 8,
    marginRight: 4,
  },
  headerValue: {
    borderBottomWidth: 1,
    borderBottomColor: '#666',
    borderBottomStyle: 'dotted',
    minHeight: 12,
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: 1,
    paddingLeft: 2,
  },
  table: {
    borderWidth: 1,
    borderColor: '#000',
    marginTop: 4,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#000',
    minHeight: 26,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#000',
    minHeight: 28,
  },
  tableTotalRow: {
    flexDirection: 'row',
    minHeight: 28,
  },
  headerText: {
    fontSize: 7,
    textAlign: 'center',
    lineHeight: 1.15,
  },
  cellText: {
    fontSize: 8,
    textAlign: 'center',
  },
  dayCellText: {
    fontSize: 8,
    textAlign: 'left',
  },
  remarkText: {
    fontSize: 8,
    textAlign: 'left',
    lineHeight: 1.25,
  },
  colDay: {
    width: '8%',
    borderRightWidth: 1,
    borderRightColor: '#000',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  colOperatorTravel: {
    width: '6%',
    borderRightWidth: 1,
    borderRightColor: '#000',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  colOperatorStart: {
    width: '6%',
    borderRightWidth: 1,
    borderRightColor: '#000',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  colOperatorFinish: {
    width: '6%',
    borderRightWidth: 1,
    borderRightColor: '#000',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  colOperatorYard: {
    width: '6%',
    borderRightWidth: 1,
    borderRightColor: '#000',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  colTotalWorking: {
    width: '6%',
    borderRightWidth: 1,
    borderRightColor: '#000',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  colMachineTravel: {
    width: '6%',
    borderRightWidth: 1,
    borderRightColor: '#000',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  colMachineStart: {
    width: '6%',
    borderRightWidth: 1,
    borderRightColor: '#000',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  colMachineFinish: {
    width: '6%',
    borderRightWidth: 1,
    borderRightColor: '#000',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  colMachineWorking: {
    width: '6%',
    borderRightWidth: 1,
    borderRightColor: '#000',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  colMachineStanding: {
    width: '6%',
    borderRightWidth: 1,
    borderRightColor: '#000',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  colMachineOperator: {
    width: '6%',
    borderRightWidth: 1,
    borderRightColor: '#000',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  colMaintenanceBreakdown: {
    width: '6%',
    borderRightWidth: 1,
    borderRightColor: '#000',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  colRemarks: {
    width: '20%',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  footer: {
    marginTop: 14,
  },
  signatureRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  signatureBlock: {
    width: '48%',
  },
  signatureLineLabel: {
    fontSize: 8,
    marginBottom: 2,
  },
  signatureLine: {
    borderBottomWidth: 1,
    borderBottomColor: '#000',
    borderBottomStyle: 'dotted',
    minHeight: 28,
    justifyContent: 'flex-end',
    paddingBottom: 2,
    paddingLeft: 2,
  },
  signatureImage: {
    width: 170,
    height: 28,
  },
  signaturePrintRow: {
    marginTop: 7,
    flexDirection: 'row',
    alignItems: 'center',
  },
  signaturePrintLabel: {
    fontSize: 8,
    marginRight: 4,
  },
  signaturePrintLine: {
    flex: 1,
    borderBottomWidth: 1,
    borderBottomColor: '#000',
    borderBottomStyle: 'dotted',
    minHeight: 12,
    justifyContent: 'flex-end',
    paddingBottom: 1,
    paddingLeft: 2,
  },
  declarationRow: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  declarationText: {
    width: '48%',
    fontSize: 7.5,
    lineHeight: 1.2,
  },
});

interface PlantTimesheetV2PDFProps {
  timesheet: Timesheet;
  employeeName?: string | null;
  offDayStates?: TimesheetOffDayState[];
}

function formatHours(value: number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return Number(value).toFixed(2);
}

function formatPlantRemarks(entry: {
  job_number?: string | null;
  job_numbers?: string[];
  remarks?: string | null;
  subsistence_payment_required?: boolean | null;
}): string {
  const jobNumbers = formatEntryJobNumbers(entry);
  const remarks = entry.subsistence_payment_required
    ? addSubsistenceRemark(entry.remarks)
    : entry.remarks;
  if (jobNumbers !== '-' && remarks?.trim()) {
    return `Job numbers ${jobNumbers} - ${remarks.trim()}`;
  }
  if (jobNumbers !== '-') {
    return `Job numbers ${jobNumbers}`;
  }
  return remarks || '';
}

export function PlantTimesheetV2PDF({ timesheet, employeeName, offDayStates = [] }: PlantTimesheetV2PDFProps) {
  const sortedEntries = (timesheet.entries || []).sort((a, b) => a.day_of_week - b.day_of_week);
  const allDays = normalizeTimesheetEntriesForDisplay(timesheet, [1, 2, 3, 4, 5, 6, 7].map((dayNum) => {
    const entry = sortedEntries.find((item) => item.day_of_week === dayNum);
    return entry || {
      timesheet_id: timesheet.id,
      day_of_week: dayNum,
      time_started: '',
      time_finished: '',
      operator_travel_hours: null,
      operator_yard_hours: null,
      operator_working_hours: null,
      machine_travel_hours: null,
      machine_start_time: '',
      machine_finish_time: '',
      machine_working_hours: null,
      machine_standing_hours: null,
      machine_operator_hours: null,
      maintenance_breakdown_hours: null,
      job_number: null,
      job_numbers: [],
      working_in_yard: false,
      subsistence_payment_required: false,
      daily_total: null,
      remarks: '',
      did_not_work: false,
    };
  }), offDayStates);

  const leaveAwareTotals = buildLeaveAwareTotals(allDays, offDayStates);
  const formNumber = timesheet.id ? timesheet.id.slice(-5).toUpperCase() : '00000';

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.formNumber}>
          <Text>{formNumber}</Text>
        </View>

        <View style={styles.companyHeader}>
          <Text style={styles.companyName}>{templateConfig.branding.companyName}</Text>
          <Text style={styles.companyDetails}>
            REGISTERED OFFICE: VIVIENNE HOUSE, RACECOURSE ROAD, CREW LANE INDUSTRIAL ESTATE, SOUTHWELL, NOTTS. NG25 0TX
          </Text>
          <Text style={styles.companyPhone}>Telephone: SOUTHWELL (01636) 812227</Text>
        </View>

        <View style={styles.headerGrid}>
          <View style={styles.headerRow}>
            <View style={styles.headerCell}>
              <Text style={styles.headerLabel}>MACHINE</Text>
              <View style={styles.headerValue}>
                <Text>{timesheet.reg_number || ''}</Text>
              </View>
            </View>
            <View style={styles.headerCell}>
              <Text style={styles.headerLabel}>SITE ADDRESS</Text>
              <View style={styles.headerValue}>
                <Text>{timesheet.site_address || ''}</Text>
              </View>
            </View>
            <View style={{ ...styles.headerCell, marginRight: 0 }}>
              <Text style={styles.headerLabel}>W/E SUNDAY</Text>
              <View style={styles.headerValue}>
                <Text>{formatDate(new Date(timesheet.week_ending))}</Text>
              </View>
            </View>
          </View>

          <View style={styles.headerRow}>
            <View style={styles.headerCell}>
              <Text style={styles.headerLabel}>OPERATOR</Text>
              <View style={styles.headerValue}>
                <Text>{employeeName || ''}</Text>
              </View>
            </View>
            <View style={styles.headerCell}>
              <Text style={styles.headerLabel}>HIRER</Text>
              <View style={styles.headerValue}>
                <Text>{timesheet.hirer_name || ''}</Text>
              </View>
            </View>
          </View>

          {timesheet.is_hired_plant && (
            <View style={styles.hiredHeaderBlock}>
              <Text style={styles.hiredHeaderTitle}>HIRED PLANT DETAILS</Text>
              <Text style={styles.hiredHeaderLine}>
                ID / SERIAL: {timesheet.hired_plant_id_serial || timesheet.reg_number || ''}
              </Text>
              <Text style={styles.hiredHeaderLine}>
                DESCRIPTION: {timesheet.hired_plant_description || ''}
              </Text>
              <Text style={styles.hiredHeaderLine}>
                HIRING COMPANY: {timesheet.hired_plant_hiring_company || ''}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <View style={styles.colDay}><Text style={styles.headerText}>DAY</Text></View>
            <View style={styles.colOperatorTravel}><Text style={styles.headerText}>OPERATOR{'\n'}TRAVEL{'\n'}HOURS</Text></View>
            <View style={styles.colOperatorStart}><Text style={styles.headerText}>OPERATOR{'\n'}START{'\n'}TIME</Text></View>
            <View style={styles.colOperatorFinish}><Text style={styles.headerText}>OPERATOR{'\n'}FINISH{'\n'}TIME</Text></View>
            <View style={styles.colOperatorYard}><Text style={styles.headerText}>OPERATOR{'\n'}YARD{'\n'}HOURS</Text></View>
            <View style={styles.colTotalWorking}><Text style={styles.headerText}>TOTAL{'\n'}WORKING{'\n'}HOURS</Text></View>
            <View style={styles.colMachineTravel}><Text style={styles.headerText}>MACHINE{'\n'}TRAVEL{'\n'}HOURS</Text></View>
            <View style={styles.colMachineStart}><Text style={styles.headerText}>MACHINE{'\n'}START{'\n'}TIME</Text></View>
            <View style={styles.colMachineFinish}><Text style={styles.headerText}>MACHINE{'\n'}FINISH{'\n'}TIME</Text></View>
            <View style={styles.colMachineWorking}><Text style={styles.headerText}>MACHINE{'\n'}WORKING{'\n'}HOURS</Text></View>
            <View style={styles.colMachineStanding}><Text style={styles.headerText}>MACHINE{'\n'}STANDING{'\n'}HOURS</Text></View>
            <View style={styles.colMachineOperator}><Text style={styles.headerText}>MACHINE{'\n'}OPERATOR{'\n'}HOURS</Text></View>
            <View style={styles.colMaintenanceBreakdown}><Text style={styles.headerText}>M&apos;TANCE{'\n'}OR BREAK{'\n'}DOWN</Text></View>
            <View style={styles.colRemarks}><Text style={styles.headerText}>REMARKS</Text></View>
          </View>

          {allDays.map((entry) => (
            <View key={entry.day_of_week} style={styles.tableRow}>
              <View style={styles.colDay}>
                <Text style={styles.dayCellText}>{DAY_NAMES[entry.day_of_week - 1].substring(0, 3).toUpperCase()}</Text>
              </View>
              <View style={styles.colOperatorTravel}><Text style={styles.cellText}>{entry.did_not_work ? '' : formatHours(entry.operator_travel_hours)}</Text></View>
              <View style={styles.colOperatorStart}><Text style={styles.cellText}>{entry.did_not_work ? '' : (entry.time_started || '')}</Text></View>
              <View style={styles.colOperatorFinish}><Text style={styles.cellText}>{entry.did_not_work ? '' : (entry.time_finished || '')}</Text></View>
              <View style={styles.colOperatorYard}><Text style={styles.cellText}>{entry.did_not_work ? '' : formatHours(entry.operator_yard_hours)}</Text></View>
              <View style={styles.colTotalWorking}><Text style={styles.cellText}>{leaveAwareTotals.rowByDay.get(entry.day_of_week)?.display || ''}</Text></View>
              <View style={styles.colMachineTravel}><Text style={styles.cellText}>{entry.did_not_work ? '' : formatHours(entry.machine_travel_hours)}</Text></View>
              <View style={styles.colMachineStart}><Text style={styles.cellText}>{entry.did_not_work ? '' : (entry.machine_start_time || '')}</Text></View>
              <View style={styles.colMachineFinish}><Text style={styles.cellText}>{entry.did_not_work ? '' : (entry.machine_finish_time || '')}</Text></View>
              <View style={styles.colMachineWorking}><Text style={styles.cellText}>{entry.did_not_work ? '' : formatHours(entry.machine_working_hours)}</Text></View>
              <View style={styles.colMachineStanding}><Text style={styles.cellText}>{entry.did_not_work ? '' : formatHours(entry.machine_standing_hours)}</Text></View>
              <View style={styles.colMachineOperator}><Text style={styles.cellText}>{entry.did_not_work ? '' : formatHours(entry.machine_operator_hours)}</Text></View>
              <View style={styles.colMaintenanceBreakdown}><Text style={styles.cellText}>{entry.did_not_work ? '' : formatHours(entry.maintenance_breakdown_hours)}</Text></View>
              <View style={styles.colRemarks}>
                <Text style={styles.remarkText}>
                  {entry.did_not_work
                    ? getDidNotWorkReasonInfo(
                        entry.did_not_work,
                        entry.remarks?.trim() ? entry.remarks : 'Not on Shift'
                      ).combinedDisplay
                    : formatPlantRemarks(entry)}
                </Text>
              </View>
            </View>
          ))}

          <View style={styles.tableTotalRow}>
            <View style={styles.colDay}>
              <Text style={{ ...styles.dayCellText, fontWeight: 'bold' }}>TOTAL</Text>
            </View>
            <View style={styles.colOperatorTravel}><Text style={styles.cellText}></Text></View>
            <View style={styles.colOperatorStart}><Text style={styles.cellText}></Text></View>
            <View style={styles.colOperatorFinish}><Text style={styles.cellText}></Text></View>
            <View style={styles.colOperatorYard}><Text style={styles.cellText}></Text></View>
            <View style={styles.colTotalWorking}><Text style={{ ...styles.cellText, fontWeight: 'bold' }}>{leaveAwareTotals.weekly.display}</Text></View>
            <View style={styles.colMachineTravel}><Text style={styles.cellText}></Text></View>
            <View style={styles.colMachineStart}><Text style={styles.cellText}></Text></View>
            <View style={styles.colMachineFinish}><Text style={styles.cellText}></Text></View>
            <View style={styles.colMachineWorking}><Text style={styles.cellText}></Text></View>
            <View style={styles.colMachineStanding}><Text style={styles.cellText}></Text></View>
            <View style={styles.colMachineOperator}><Text style={styles.cellText}></Text></View>
            <View style={styles.colMaintenanceBreakdown}><Text style={styles.cellText}></Text></View>
            <View style={styles.colRemarks}><Text style={styles.cellText}></Text></View>
          </View>
        </View>

        <View style={styles.footer}>
          <View style={styles.signatureRow}>
            <View style={styles.signatureBlock}>
              <Text style={styles.signatureLineLabel}>OPERATOR&apos;S SIGNATURE</Text>
              <View style={styles.signatureLine}>
                {timesheet.signature_data ? (
                  <PdfImage style={styles.signatureImage} src={timesheet.signature_data} />
                ) : (
                  <Text></Text>
                )}
              </View>
              <View style={styles.signaturePrintRow}>
                <Text style={styles.signaturePrintLabel}>PRINT NAME</Text>
                <View style={styles.signaturePrintLine}>
                  <Text>{employeeName || ''}</Text>
                </View>
              </View>
            </View>

            <View style={styles.signatureBlock}>
              <Text style={styles.signatureLineLabel}>HIRER&apos;S SIGNATURE</Text>
              <View style={styles.signatureLine}>
                <Text></Text>
              </View>
              <View style={styles.signaturePrintRow}>
                <Text style={styles.signaturePrintLabel}>PRINT NAME</Text>
                <View style={styles.signaturePrintLine}>
                  <Text>{timesheet.hirer_name || ''}</Text>
                </View>
              </View>
            </View>
          </View>

          <View style={styles.declarationRow}>
            <Text style={styles.declarationText}>
              ALL TIME DETAILS GIVEN ABOVE ARE CORRECT{'\n'}
              AND SHOULD BE USED AS A BASIS FOR WAGES
            </Text>
            <Text style={styles.declarationText}>
              ALL DETAILS GIVEN ABOVE ARE AGREED TO MY{'\n'}
              SATISFACTION AND CAN BE USED AS A BASIS FOR{'\n'}
              CHARGING ANY ACCOUNTS TO OUR COMPANY.
            </Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
