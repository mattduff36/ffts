/** @vitest-environment happy-dom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TrainingRecordDialog } from '@/app/(dashboard)/training/components/TrainingRecordDialog';
import type { TrainingRecordWithRelations } from '@/types/training';

function makeRecord(): TrainingRecordWithRelations {
  return {
    id: 'record-1',
    source_record_id: 'avs-training-record-0001',
    import_batch_id: 'batch-1',
    person_id: 'person-1',
    qualification_id: 'qualification-1',
    employee_name_raw: 'Example Operator',
    qualification_raw: 'SMSTS',
    qualification_canonical_proposed: 'Site Management Safety Training Scheme (SMSTS)',
    qualification_validation_status: 'standardised_or_spelling_corrected',
    qualification_group: null,
    relationship: null,
    card_number: 'CARD-123',
    card_type_or_status: 'Competent',
    approved: null,
    issue_date: null,
    issue_raw: null,
    expiry_date: '2030-11-30',
    expiry_raw: '30.11.2030',
    date_of_birth: null,
    date_of_birth_raw: null,
    comments: 'Original note',
    additional_comments: null,
    rebooked: null,
    cpcs_statuses: ['needs_nvq'],
    cpcs_status_meanings: ['Needs NVQ'],
    cpcs_source_fill_colours: [],
    colour_formatting_ignored: false,
    colour_formatting_rule: null,
    source_sheet: 'CPCS',
    source_row: 12,
    record_status: 'active',
    next_review_at: null,
    created_by: null,
    updated_by: null,
    created_at: '2026-06-04T10:00:00.000Z',
    updated_at: '2026-06-04T10:00:00.000Z',
    person: {
      id: 'person-1',
      employee_key: 'EXAMPLE OPERATOR',
      employee_name_raw: 'Example Operator',
      profile_id: 'profile-1',
      profile_match_status: 'matched',
    },
    qualification: {
      id: 'qualification-1',
      qualification_key: 'SMSTS',
      canonical_name: 'Site Management Safety Training Scheme (SMSTS)',
      validation_status: 'standardised_or_spelling_corrected',
    },
  };
}

describe('TrainingRecordDialog', () => {
  it('shows source traceability and submits edited record data', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <TrainingRecordDialog
        open
        record={makeRecord()}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    );

    expect(screen.getByText(/Source: CPCS row 12/)).toBeTruthy();
    expect(screen.getByText(/raw expiry: 30.11.2030/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Comments'), {
      target: { value: 'Updated note' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      comments: 'Updated note',
      employee_name_raw: 'Example Operator',
    }));
  });
});
