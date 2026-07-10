/** @vitest-environment happy-dom */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TrainingQualificationDialog } from '@/app/(dashboard)/training/components/TrainingQualificationDialog';
import type { TrainingQualification } from '@/types/training';

function makeQualification(): TrainingQualification {
  return {
    id: 'qualification-1',
    qualification_key: 'SMSTS',
    qualification_raw: 'SMSTS',
    canonical_name: 'Site Management Safety Training Scheme (SMSTS)',
    validation_status: 'standardised_or_spelling_corrected',
    validation_notes: 'Reviewed from import',
    source_sheets: ['CPCS'],
    record_count: 4,
    created_at: '2026-06-04T10:00:00.000Z',
    updated_at: '2026-06-04T10:00:00.000Z',
  };
}

describe('TrainingQualificationDialog', () => {
  it('resets stale form values when qualification is cleared', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    const { rerender } = render(
      <TrainingQualificationDialog
        open
        qualification={makeQualification()}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(screen.getByLabelText('Canonical Name'), {
      target: { value: 'Edited stale qualification' },
    });
    fireEvent.change(screen.getByLabelText('Validation Notes'), {
      target: { value: 'Edited stale notes' },
    });

    expect((screen.getByLabelText('Canonical Name') as HTMLInputElement).value).toBe('Edited stale qualification');
    expect((screen.getByLabelText('Validation Notes') as HTMLInputElement).value).toBe('Edited stale notes');

    rerender(
      <TrainingQualificationDialog
        open
        qualification={null}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    );

    expect((screen.getByLabelText('Canonical Name') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Validation Notes') as HTMLInputElement).value).toBe('');
  });
});
