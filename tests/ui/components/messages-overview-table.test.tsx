/** @vitest-environment happy-dom */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MESSAGES_OVERVIEW_COLUMN_VISIBILITY,
  MessagesOverviewTable,
} from '@/components/messages/MessagesOverviewTable';
import type { MessageDisplayPriority, MessageReportData, MessageType } from '@/types/messages';

function makeReport(type: MessageType, subject: string, priority?: MessageDisplayPriority): MessageReportData {
  return {
    message: {
      id: subject.toLowerCase().replaceAll(' ', '-'),
      type,
      subject,
      body: 'Body',
      priority: priority ?? (type === 'TOOLBOX_TALK' ? 'HIGH' : 'LOW'),
      sender_id: 'sender-1',
      created_at: '2026-06-04T10:00:00.000Z',
      updated_at: '2026-06-04T10:00:00.000Z',
      deleted_at: null,
      created_via: type === 'TOOLBOX_TALK' ? 'web' : `toolbox-talks_${type.toLowerCase()}`,
      module_key: 'toolbox_talks',
      pdf_file_path: null,
      acceptance_delay_minutes: 0,
      sender: {
        id: 'sender-1',
        full_name: 'Site Manager',
        role: 'manager',
      },
    },
    recipients: [],
    total_assigned: 1,
    total_signed: 0,
    total_pending: 1,
    compliance_rate: 0,
  };
}

describe('MessagesOverviewTable', () => {
  it('shows a Type badge for every supported overview message type', () => {
    render(
      <MessagesOverviewTable
        messages={[
          makeReport('TOOLBOX_TALK', 'Harness safety'),
          makeReport('NOTIFICATION', 'Safety notice'),
          makeReport('REMINDER', 'Follow up reminder'),
        ]}
        columnVisibility={{ ...DEFAULT_MESSAGES_OVERVIEW_COLUMN_VISIBILITY, type: true }}
        deleting={false}
        onSelectMessage={vi.fn()}
        onDeleteMessage={vi.fn()}
        onExportPDF={vi.fn()}
        onViewAttachedPDF={vi.fn()}
      />
    );

    expect(screen.getByText('Toolbox Talk')).toBeTruthy();
    expect(screen.getByText('Notification')).toBeTruthy();
    expect(screen.getByText('Reminder')).toBeTruthy();
    expect(screen.getByText('Notification').className).toContain('bg-brand-yellow text-slate-900');
    expect(screen.getByText('Reminder').className).toContain('bg-reminders text-white');
  });

  it('renders supported priority badges as transparent coloured outlines', () => {
    render(
      <MessagesOverviewTable
        messages={[
          makeReport('TOOLBOX_TALK', 'Low priority', 'LOW'),
          makeReport('REMINDER', 'Medium priority', 'MEDIUM'),
          makeReport('TOOLBOX_TALK', 'High priority', 'HIGH'),
          makeReport('TOOLBOX_TALK', 'Urgent priority', 'URGENT'),
        ]}
        columnVisibility={{ ...DEFAULT_MESSAGES_OVERVIEW_COLUMN_VISIBILITY, priority: true }}
        deleting={false}
        onSelectMessage={vi.fn()}
        onDeleteMessage={vi.fn()}
        onExportPDF={vi.fn()}
        onViewAttachedPDF={vi.fn()}
      />
    );

    expect(screen.getByText('Low').className).toContain('border-emerald-400 bg-transparent text-emerald-300');
    expect(screen.getByText('Medium').className).toContain('border-amber-400 bg-transparent text-amber-300');
    expect(screen.getByText('High').className).toContain('border-orange-400 bg-transparent text-orange-300');
    expect(screen.getByText('Urgent').className).toContain('border-red-500 bg-transparent text-red-500');
  });
});
