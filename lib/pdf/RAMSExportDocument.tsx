import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image as PdfImage } from '@react-pdf/renderer';
import { format } from 'date-fns';
import { templateConfig } from '@/lib/config/template-config';

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: 'Helvetica',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
    borderBottom: '3pt solid #F9D71C',
    paddingBottom: 15,
  },
  logo: {
    width: 120,
    height: 'auto',
  },
  headerText: {
    flex: 1,
    marginLeft: 15,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#5A6C7D',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 12,
    color: '#5A6C7D',
    marginBottom: 3,
  },
  section: {
    marginTop: 15,
    marginBottom: 15,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#5A6C7D',
    backgroundColor: '#F9D71C',
    padding: 8,
    borderRadius: 3,
  },
  infoRow: {
    flexDirection: 'row',
    marginBottom: 5,
  },
  label: {
    fontWeight: 'bold',
    width: 120,
    color: '#5A6C7D',
  },
  value: {
    flex: 1,
    color: '#1e293b',
  },
  table: {
    marginTop: 10,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#F9D71C',
    padding: 8,
    fontWeight: 'bold',
    borderBottom: '2pt solid #5A6C7D',
  },
  tableRow: {
    flexDirection: 'row',
    padding: 8,
    borderBottom: '0.5pt solid #e2e8f0',
  },
  tableCell: {
    flex: 1,
    color: '#5A6C7D',
  },
  signatureBox: {
    marginTop: 10,
    padding: 10,
    border: '2pt solid #F9D71C',
    borderRadius: 4,
    backgroundColor: '#fffef5',
  },
  signatureImage: {
    width: 200,
    height: 60,
    objectFit: 'contain',
    marginTop: 5,
  },
  signatureContentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 15,
  },
  signatureLeftColumn: {
    flex: 1,
  },
  signatureRightColumn: {
    flex: 1,
    alignItems: 'flex-end',
  },
  badge: {
    padding: '3pt 8pt',
    borderRadius: 4,
    fontSize: 9,
  },
  badgeSigned: {
    backgroundColor: '#22c55e',
    color: '#ffffff',
  },
  badgePending: {
    backgroundColor: '#ef4444',
    color: '#ffffff',
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 40,
    right: 40,
    textAlign: 'center',
    color: '#5A6C7D',
    fontSize: 8,
    borderTop: '2pt solid #F9D71C',
    paddingTop: 10,
  },
  statsCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 15,
    backgroundColor: '#fffef5',
    border: '2pt solid #F9D71C',
    borderRadius: 5,
    marginBottom: 15,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#5A6C7D',
    marginBottom: 3,
  },
  statLabel: {
    fontSize: 9,
    color: '#5A6C7D',
  },
});

interface RAMSExportDocumentProps {
  document: {
    id: string;
    title: string;
    description: string | null;
    file_name: string;
    file_size: number;
    file_type: string;
    created_at: string;
    uploader_name: string;
  };
  assignments: Array<{
    id: string;
    status: 'pending' | 'read' | 'signed';
    signed_at: string | null;
    signature_data: string | null;
    comments: string | null;
    action_taken: string | null;
    employee: {
      full_name: string;
      role: string;
    };
  }>;
  visitorSignatures: Array<{
    id: string;
    visitor_name: string;
    visitor_company: string | null;
    visitor_role: string | null;
    signed_at: string;
    signature_data: string;
    recorder: {
      full_name: string;
    };
  }>;
  logoUrl: string;
}

export function RAMSExportDocument({
  document,
  assignments,
  visitorSignatures,
  logoUrl,
}: RAMSExportDocumentProps) {
  const signedAssignments = assignments.filter(a => a.status === 'signed');
  const totalSigned = signedAssignments.length;
  const complianceRate =
    assignments.length > 0 ? Math.round((totalSigned / assignments.length) * 100) : 0;

  return (
    <Document>
      {/* Cover Page */}
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <PdfImage src={logoUrl} style={styles.logo} />
          <View style={styles.headerText}>
            <Text style={styles.title}>{document.title}</Text>
            <Text style={styles.subtitle}>Risk Assessment & Method Statement - Signature Record</Text>
            <Text style={styles.subtitle}>
              Exported on {format(new Date(), 'PPP')} at {format(new Date(), 'p')}
            </Text>
          </View>
        </View>

        {/* Document Information */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Document Information</Text>
          {document.description && (
            <View style={styles.infoRow}>
              <Text style={styles.label}>Description:</Text>
              <Text style={styles.value}>{document.description}</Text>
            </View>
          )}
          <View style={styles.infoRow}>
            <Text style={styles.label}>File Name:</Text>
            <Text style={styles.value}>{document.file_name}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.label}>File Type:</Text>
            <Text style={styles.value}>{document.file_type.toUpperCase()}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.label}>Uploaded By:</Text>
            <Text style={styles.value}>{document.uploader_name}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.label}>Upload Date:</Text>
            <Text style={styles.value}>
              {format(new Date(document.created_at), 'PPP')}
            </Text>
          </View>
        </View>

        {/* Compliance Summary */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Compliance Summary</Text>
          <View style={styles.statsCard}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{assignments.length}</Text>
              <Text style={styles.statLabel}>Total Assigned</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{totalSigned}</Text>
              <Text style={styles.statLabel}>Total Signed</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{complianceRate}%</Text>
              <Text style={styles.statLabel}>Compliance Rate</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{visitorSignatures.length}</Text>
              <Text style={styles.statLabel}>Visitor Signatures</Text>
            </View>
          </View>
        </View>

        <View style={styles.footer}>
          <Text>
            This document is a certified record of RAMS acknowledgment and signature compliance
          </Text>
          <Text>Generated by {templateConfig.branding.appName} • {format(new Date(), 'PPP')}</Text>
        </View>
      </Page>

      {/* Employee Signatures */}
      {signedAssignments.length > 0 && (
        <Page size="A4" style={styles.page}>
          <View style={styles.header}>
            <PdfImage src={logoUrl} style={styles.logo} />
            <View style={styles.headerText}>
              <Text style={styles.title}>Employee Signatures</Text>
              <Text style={styles.subtitle}>{document.title}</Text>
            </View>
          </View>

          {signedAssignments.map((assignment) => (
            <View key={assignment.id} style={styles.section}>
              <View style={styles.signatureBox}>
                {/* Two column layout: Info on left, Signature on right */}
                <View style={styles.signatureContentRow}>
                  {/* Left Column - Employee Info */}
                  <View style={styles.signatureLeftColumn}>
                    <View style={styles.infoRow}>
                      <Text style={styles.label}>Employee Name:</Text>
                      <Text style={styles.value}>{assignment.employee.full_name}</Text>
                    </View>
                    <View style={styles.infoRow}>
                      <Text style={styles.label}>Role:</Text>
                      <Text style={styles.value}>{assignment.employee.role}</Text>
                    </View>
                    <View style={styles.infoRow}>
                      <Text style={styles.label}>Signed Date:</Text>
                      <Text style={styles.value}>
                        {assignment.signed_at
                          ? format(new Date(assignment.signed_at), 'PPP p')
                          : 'N/A'}
                      </Text>
                    </View>
                    {assignment.action_taken && (
                      <View style={styles.infoRow}>
                        <Text style={styles.label}>Document Viewed:</Text>
                        <Text style={styles.value}>
                          {assignment.action_taken === 'downloaded' 
                            ? 'Downloaded'
                            : assignment.action_taken === 'opened'
                            ? 'Opened in browser'
                            : assignment.action_taken === 'emailed'
                            ? 'Email'
                            : assignment.action_taken}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Right Column - Signature */}
                  <View style={styles.signatureRightColumn}>
                    <Text style={{ ...styles.label, marginBottom: 5 }}>Signature:</Text>
                    {assignment.signature_data && (
                      <PdfImage 
                        src={assignment.signature_data} 
                        style={styles.signatureImage} 
                      />
                    )}
                  </View>
                </View>

                {/* Comments section spanning full width below */}
                {assignment.comments && (
                  <View style={{ marginTop: 10 }}>
                    <Text style={{ ...styles.label, marginBottom: 5 }}>
                      Comments:
                    </Text>
                    <View style={{ 
                      padding: 8, 
                      backgroundColor: '#f8fafc',
                      border: '1pt solid #e2e8f0',
                      borderRadius: 3 
                    }}>
                      <Text style={{ fontSize: 9, color: '#334155', lineHeight: 1.5 }}>
                        {assignment.comments}
                      </Text>
                    </View>
                  </View>
                )}
              </View>
            </View>
          ))}

          <View style={styles.footer}>
            <Text>Employee Signatures • {format(new Date(), 'PPP')}</Text>
          </View>
        </Page>
      )}

      {/* Visitor Signatures */}
      {visitorSignatures.length > 0 && (
        <Page size="A4" style={styles.page}>
          <View style={styles.header}>
            <PdfImage src={logoUrl} style={styles.logo} />
            <View style={styles.headerText}>
              <Text style={styles.title}>Visitor Signatures</Text>
              <Text style={styles.subtitle}>{document.title}</Text>
            </View>
          </View>

          {visitorSignatures.map((signature) => (
            <View key={signature.id} style={styles.section}>
              <View style={styles.signatureBox}>
                {/* Two column layout: Info on left, Signature on right */}
                <View style={styles.signatureContentRow}>
                  {/* Left Column - Visitor Info */}
                  <View style={styles.signatureLeftColumn}>
                    <View style={styles.infoRow}>
                      <Text style={styles.label}>Visitor Name:</Text>
                      <Text style={styles.value}>{signature.visitor_name}</Text>
                    </View>
                    {signature.visitor_company && (
                      <View style={styles.infoRow}>
                        <Text style={styles.label}>Company:</Text>
                        <Text style={styles.value}>{signature.visitor_company}</Text>
                      </View>
                    )}
                    {signature.visitor_role && (
                      <View style={styles.infoRow}>
                        <Text style={styles.label}>Role:</Text>
                        <Text style={styles.value}>{signature.visitor_role}</Text>
                      </View>
                    )}
                    <View style={styles.infoRow}>
                      <Text style={styles.label}>Signed Date:</Text>
                      <Text style={styles.value}>
                        {format(new Date(signature.signed_at), 'PPP p')}
                      </Text>
                    </View>
                    <View style={styles.infoRow}>
                      <Text style={styles.label}>Recorded By:</Text>
                      <Text style={styles.value}>{signature.recorder.full_name}</Text>
                    </View>
                  </View>

                  {/* Right Column - Signature */}
                  <View style={styles.signatureRightColumn}>
                    <Text style={{ ...styles.label, marginBottom: 5 }}>Signature:</Text>
                    {signature.signature_data && (
                      <PdfImage 
                        src={signature.signature_data} 
                        style={styles.signatureImage} 
                      />
                    )}
                  </View>
                </View>
              </View>
            </View>
          ))}

          <View style={styles.footer}>
            <Text>Page {signedAssignments.length > 0 ? '3+' : '2+'} • Visitor Signatures</Text>
          </View>
        </Page>
      )}
    </Document>
  );
}

