import { describe, expect, it } from 'vitest';
import { inferLegacySectionsForTemplate } from '@/lib/workshop-attachments/legacy-to-v2-sectioning';

describe('inferLegacySectionsForTemplate', () => {
  it('groups van service questions into multiple meaningful sections', () => {
    const sections = inferLegacySectionsForTemplate('Van Service', [
      { question_text: 'engine oil and filter', question_type: 'checkbox', is_required: true, sort_order: 1 },
      { question_text: 'any comments', question_type: 'text', is_required: false, sort_order: 2 },
      { question_text: 'front brake pads', question_type: 'checkbox', is_required: false, sort_order: 3 },
      { question_text: 'headlights', question_type: 'checkbox', is_required: false, sort_order: 4 },
      { question_text: 'service record updated', question_type: 'checkbox', is_required: false, sort_order: 5 },
    ]);

    expect(sections.length).toBeGreaterThan(1);
    expect(sections.some((section) => section.section_key === 'engine_service')).toBe(true);
    expect(sections.some((section) => section.section_key === 'drivetrain_brakes')).toBe(true);
    expect(sections.some((section) => section.section_key === 'documentation_signoff')).toBe(true);
  });

  it('maps checklist checkboxes to marking codes with note validation', () => {
    const sections = inferLegacySectionsForTemplate('Plant Service / Inspection', [
      { question_text: 'engine oil filter change', question_type: 'checkbox', is_required: false, sort_order: 1 },
    ]);

    expect(sections).toHaveLength(1);
    const field = sections[0].fields[0];
    expect(field.field_type).toBe('marking_code');
    expect(field.validation_json).toEqual({ require_note_for: ['attention'] });
  });

  it('collapses repeated comment prompts into one section comment field', () => {
    const sections = inferLegacySectionsForTemplate('LOLER THOROUGH EXAMINATION', [
      { question_text: 'pins and bushes', question_type: 'checkbox', is_required: false, sort_order: 1 },
      { question_text: 'comments', question_type: 'text', is_required: false, sort_order: 2 },
      { question_text: 'lifting chart stickers', question_type: 'checkbox', is_required: false, sort_order: 3 },
      { question_text: 'any comments', question_type: 'text', is_required: false, sort_order: 4 },
    ]);

    const commentsPerSection = sections.map((section) => (
      section.fields.filter((field) => field.label === 'Section Comments')
    ));

    commentsPerSection.forEach((fields) => {
      expect(fields.length).toBeLessThanOrEqual(1);
      if (fields.length === 1)
        expect(fields[0].field_type).toBe('long_text');
    });
  });

  it('generates a unique fallback key when duplicate candidate already exists', () => {
    const sections = inferLegacySectionsForTemplate('Custom Checklist', [
      { question_text: 'foo', question_type: 'text', is_required: false, sort_order: 1 },
      { question_text: 'foo 3 1', question_type: 'text', is_required: false, sort_order: 2 },
      { question_text: 'foo', question_type: 'text', is_required: false, sort_order: 3 },
    ]);

    expect(sections).toHaveLength(1);
    const keys = sections[0].fields.map((field) => field.field_key);
    expect(keys).toEqual(['foo', 'foo_3_1', 'foo_3_2']);
  });
});
