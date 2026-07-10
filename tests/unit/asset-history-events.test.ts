import { describe, expect, it } from 'vitest';
import {
  buildAssetHistoryRows,
  filterAssetHistoryRows,
  formatHistoryPersonName,
  type AssetHistoryFilters,
} from '@/lib/fleet/asset-history-events';

const getFieldLabel = (fieldName: string) => fieldName.replace(/_/g, ' ');

describe('asset history events', () => {
  it('normalises and sorts record, workshop, and daily task rows newest first', () => {
    const rows = buildAssetHistoryRows({
      assetType: 'van',
      getFieldLabel,
      records: [
        {
          id: 'record-1',
          created_at: '2026-05-20T09:00:00.000Z',
          updated_by_name: 'Admin User',
          field_name: 'current_mileage',
          old_value: '100',
          new_value: '200',
          comment: 'Updated mileage',
        },
      ],
      workshopTasks: [
        {
          id: 'task-1',
          action_type: 'workshop_vehicle_task',
          title: 'Replace tyre',
          status: 'completed',
          created_at: '2026-05-21T09:00:00.000Z',
          profiles_created: { full_name: 'Workshop User' },
        },
      ],
      dailyTasks: [
        {
          id: 'inspection-1',
          inspection_date: '2026-05-22',
          inspection_end_date: null,
          submitted_at: '2026-05-22T09:00:00.000Z',
          status: 'submitted',
          current_mileage: 1234,
          profile: { full_name: 'Driver User' },
        },
      ],
    });

    expect(rows.map((row) => row.type)).toEqual(['dailyTask', 'workshop', 'record']);
    expect(rows[0]).toMatchObject({
      type: 'dailyTask',
      statusLabel: 'All Passed',
      person: 'Driver User',
      meter: '1,234 miles',
    });
  });

  it('uses asset-specific daily task routes and meter units', () => {
    const [hgvRow] = buildAssetHistoryRows({
      assetType: 'hgv',
      getFieldLabel,
      records: [],
      workshopTasks: [],
      dailyTasks: [
        {
          id: 'inspection-2',
          inspection_date: '2026-05-22',
          inspection_end_date: null,
          submitted_at: null,
          status: 'submitted',
          current_mileage: 5678,
          profile: null,
        },
      ],
    });

    expect(hgvRow).toMatchObject({
      type: 'dailyTask',
      href: '/hgv-inspections/inspection-2',
      meter: '5,678 km',
    });

    const [plantRow] = buildAssetHistoryRows({
      assetType: 'plant',
      getFieldLabel,
      records: [],
      workshopTasks: [],
      dailyTasks: [
        {
          id: 'inspection-3',
          inspection_date: '2026-05-22',
          inspection_end_date: null,
          submitted_at: null,
          status: 'submitted',
          current_mileage: 90,
          profile: null,
        },
      ],
    });

    expect(plantRow).toMatchObject({
      type: 'dailyTask',
      href: '/plant-inspections/inspection-3',
      meter: '90h',
    });
  });

  it('summarises daily check defects in the status label', () => {
    const [dailyCheckRow] = buildAssetHistoryRows({
      assetType: 'van',
      getFieldLabel,
      records: [],
      workshopTasks: [],
      dailyTasks: [
        {
          id: 'inspection-4',
          inspection_date: '2026-05-22',
          inspection_end_date: null,
          submitted_at: '2026-05-22T09:00:00.000Z',
          status: 'submitted',
          current_mileage: 1234,
          defect_count: 2,
          profile: { full_name: 'Driver User' },
        },
      ],
    });

    expect(dailyCheckRow).toMatchObject({
      type: 'dailyTask',
      statusLabel: '2 Defects',
    });
  });

  it('formats person names consistently for display', () => {
    expect(formatHistoryPersonName('gaz warren')).toBe('Gaz Warren');
    expect(formatHistoryPersonName('ZAK EDLIN')).toBe('Zak Edlin');
    expect(formatHistoryPersonName('Al MacFarlane')).toBe('Al MacFarlane');
    expect(formatHistoryPersonName('  kieran leape  ')).toBe('Kieran Leape');
    expect(formatHistoryPersonName('System')).toBe('System');
  });

  it('filters rows by visible event type', () => {
    const rows = buildAssetHistoryRows({
      assetType: 'van',
      getFieldLabel,
      records: [
        {
          id: 'record-1',
          created_at: '2026-05-20T09:00:00.000Z',
          updated_by_name: null,
          field_name: 'notes',
          old_value: null,
          new_value: 'Checked',
          comment: null,
        },
      ],
      workshopTasks: [
        {
          id: 'task-1',
          action_type: 'inspection_defect',
          title: 'Fix defect',
          status: 'logged',
          created_at: '2026-05-21T09:00:00.000Z',
        },
      ],
      dailyTasks: [],
    });
    const filters: AssetHistoryFilters = {
      record: false,
      workshop: true,
      dailyTask: true,
    };

    expect(filterAssetHistoryRows(rows, filters).map((row) => row.type)).toEqual(['workshop']);
  });
});
