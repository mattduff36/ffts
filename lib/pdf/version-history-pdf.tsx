import React from 'react';
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import {
  formatReleaseHistoryMonthLabel,
  getReleaseHistoryMonthKey,
  type ReleaseHistoryEntry,
} from '@/lib/config/release-version-logic';

interface VersionHistoryPDFProps {
  entries: ReleaseHistoryEntry[];
  generatedAt: string;
}

interface VersionHistoryMonthGroup {
  key: string;
  entries: ReleaseHistoryEntry[];
}

const BRAND_YELLOW = '#f2cc0c';
const BRAND_TEXT = '#111827';

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: BRAND_TEXT,
  },
  header: {
    borderBottom: `2pt solid ${BRAND_YELLOW}`,
    marginBottom: 18,
    paddingBottom: 10,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  subtitle: {
    color: '#64748b',
    fontSize: 10,
  },
  monthSection: {
    marginBottom: 16,
  },
  monthTitle: {
    backgroundColor: '#fff7cc',
    border: `1pt solid ${BRAND_YELLOW}`,
    borderRadius: 3,
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 8,
    padding: 7,
  },
  release: {
    border: '1pt solid #d1d5db',
    borderRadius: 3,
    marginBottom: 8,
    padding: 8,
  },
  releaseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  version: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  kind: {
    color: '#64748b',
    fontSize: 8,
    textTransform: 'uppercase',
  },
  releaseTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    marginBottom: 3,
  },
  summary: {
    color: '#334155',
    fontSize: 9,
    lineHeight: 1.4,
    marginBottom: 5,
  },
  meta: {
    color: '#64748b',
    fontSize: 8,
    marginBottom: 5,
  },
  detailItem: {
    color: '#334155',
    fontSize: 8.5,
    lineHeight: 1.35,
    marginBottom: 2,
  },
  footer: {
    borderTop: '1pt solid #e5e7eb',
    color: '#64748b',
    fontSize: 8,
    marginTop: 12,
    paddingTop: 8,
  },
});

function formatPushedAt(value: string | null): string {
  if (!value) {
    return 'Timestamp unavailable';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Timestamp unavailable';
  }

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/London',
  }).format(date);
}

function getUpdateKindLabel(entry: ReleaseHistoryEntry): string {
  return entry.updateKind === 'major' ? 'Major update' : 'Minor update';
}

function groupEntriesByMonth(entries: ReleaseHistoryEntry[]): VersionHistoryMonthGroup[] {
  const groups = new Map<string, ReleaseHistoryEntry[]>();

  for (const entry of entries) {
    const monthKey = getReleaseHistoryMonthKey(entry.version);
    const monthEntries = groups.get(monthKey) ?? [];
    monthEntries.push(entry);
    groups.set(monthKey, monthEntries);
  }

  return Array.from(groups.entries()).map(([key, monthEntries]) => ({
    key,
    entries: monthEntries,
  }));
}

export function VersionHistoryPDF({ entries, generatedAt }: VersionHistoryPDFProps) {
  const monthGroups = groupEntriesByMonth(entries);

  return (
    <Document title="SquireApp Version History">
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>SquireApp Version History</Text>
          <Text style={styles.subtitle}>
            A plain-English record of app updates, generated on {formatPushedAt(generatedAt)}.
          </Text>
        </View>

        {monthGroups.map((group) => (
          <View key={group.key} style={styles.monthSection}>
            <Text style={styles.monthTitle}>{formatReleaseHistoryMonthLabel(group.key)}</Text>
            {group.entries.map((entry) => {
              const details = entry.details.length > 0 ? entry.details : [entry.summary || entry.description];

              return (
                <View key={entry.version} style={styles.release} wrap={false}>
                  <View style={styles.releaseHeader}>
                    <Text style={styles.version}>Version {entry.version}</Text>
                    <Text style={styles.kind}>{getUpdateKindLabel(entry)}</Text>
                  </View>
                  <Text style={styles.releaseTitle}>{entry.title}</Text>
                  <Text style={styles.summary}>{entry.summary || entry.description}</Text>
                  <Text style={styles.meta}>Published: {formatPushedAt(entry.pushedAt)}</Text>
                  {entry.areas.length > 0 ? (
                    <Text style={styles.meta}>Areas touched: {entry.areas.join(', ')}</Text>
                  ) : null}
                  {details.map((detail) => (
                    <Text key={detail} style={styles.detailItem}>
                      - {detail}
                    </Text>
                  ))}
                </View>
              );
            })}
          </View>
        ))}

        <Text style={styles.footer}>
          This document is generated from the release history used by the Help page.
        </Text>
      </Page>
    </Document>
  );
}
