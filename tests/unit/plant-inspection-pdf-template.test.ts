import React from 'react';
import { describe, expect, it } from 'vitest';
import { PlantInspectionPDF } from '@/lib/pdf/plant-inspection-pdf';

function collectText(node: unknown): string[] {
  if (node == null || typeof node === 'boolean') {
    return [];
  }

  if (typeof node === 'string' || typeof node === 'number') {
    return [String(node)];
  }

  if (Array.isArray(node)) {
    return node.flatMap(collectText);
  }

  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return collectText(node.props.children);
  }

  return [];
}

describe('PlantInspectionPDF', () => {
  it('renders the daily plant inspection pad header without LOLER examination fields', () => {
    const documentNode = PlantInspectionPDF({
      inspection: {
        id: 'plant-inspection-123456',
        inspection_date: '2026-06-01',
        inspection_end_date: '2026-06-01',
        current_mileage: 376,
        inspector_comments: null,
        signature_data: null,
        signed_at: '2026-06-01T15:19:00.000Z',
      },
      plant: {
        plant_id: '574',
        nickname: 'Wheel Loader - HITACHI ZW220-7',
        serial_number: 'HFLNUD50E00500651',
        van_categories: null,
      },
      operator: {
        full_name: 'Dave Johnson',
      },
      items: [
        {
          item_number: 1,
          item_description: 'Oil, fuel & coolant levels/leaks',
          day_of_week: 1,
          status: 'ok',
          comments: null,
        },
      ],
      dailyHours: [],
    });

    const text = collectText(documentNode).join(' ');

    expect(text).toContain('OPERATED PLANT INSPECTION PAD');
    expect(text).toContain('MACHINE');
    expect(text).toContain('HOURS');
    expect(text).toContain('INSPECTOR NAME');
    expect(text).not.toContain('LOLER THOROUGH EXAMINATION');
    expect(text).not.toContain('EXAMINATION');
    expect(text).not.toContain('INTERVAL');
    expect(text).not.toContain('EXPIRY');
  });
});
