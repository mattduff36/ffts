import { describe, expect, it, vi } from 'vitest';
import {
  compareVrnChange,
  type VrnChangeComparisonServices,
} from '@/lib/services/vrn-change-comparison';
import type { VehicleDataResponse } from '@/types/dvla-api';

interface MotExpiryFixture {
  registration: string;
  motExpiryDate: string | null;
  motStatus: string;
  lastTestDate: string | null;
  lastTestResult: string | null;
  rawData: {
    registration: string;
    make: string;
    model: string;
    firstUsedDate: string;
    fuelType: string;
    primaryColour: string;
  };
}

function createDvlaFixture(registrationNumber: string, overrides: Partial<VehicleDataResponse> = {}): VehicleDataResponse {
  return {
    registrationNumber,
    taxStatus: 'Taxed',
    taxDueDate: '2026-12-01',
    motStatus: 'Valid',
    motExpiryDate: null,
    make: 'FORD',
    model: null,
    colour: 'WHITE',
    yearOfManufacture: 2021,
    engineSize: 1995,
    fuelType: 'DIESEL',
    co2Emissions: 180,
    monthOfFirstRegistration: '2021-03',
    rawData: {},
    ...overrides,
  };
}

function createMotFixture(registration: string, overrides: Partial<MotExpiryFixture> = {}): MotExpiryFixture {
  return {
    registration,
    motExpiryDate: '2026-10-01',
    motStatus: 'Valid',
    lastTestDate: '2025-10-01',
    lastTestResult: 'PASSED',
    rawData: {
      registration,
      make: 'FORD',
      model: 'TRANSIT',
      firstUsedDate: '2021-03-01',
      fuelType: 'Diesel',
      primaryColour: 'White',
    },
    ...overrides,
  };
}

function createServices(
  oldDvla: VehicleDataResponse,
  newDvla: VehicleDataResponse,
  oldMot: MotExpiryFixture,
  newMot: MotExpiryFixture
): VrnChangeComparisonServices {
  return {
    dvlaService: {
      getVehicleData: vi.fn()
        .mockResolvedValueOnce(oldDvla)
        .mockResolvedValueOnce(newDvla),
    },
    motService: {
      getMotExpiryData: vi.fn()
        .mockResolvedValueOnce(oldMot)
        .mockResolvedValueOnce(newMot),
    },
  };
}

describe('compareVrnChange', () => {
  it('does not flag a difference when old and new VRNs return the same vehicle details', async () => {
    const comparison = await compareVrnChange(
      'AB12 CDE',
      'PR11 VTE',
      createServices(
        createDvlaFixture('AB12CDE'),
        createDvlaFixture('PR11VTE'),
        createMotFixture('AB12CDE'),
        createMotFixture('PR11VTE')
      )
    );

    expect(comparison.hasDifferences).toBe(false);
    expect(comparison.differences).toEqual([]);
    expect(comparison.oldRegistration).toBe('AB12 CDE');
    expect(comparison.newRegistration).toBe('PR11 VTE');
  });

  it('reports live DVLA and MOT detail differences for mismatched VRNs', async () => {
    const comparison = await compareVrnChange(
      'AB12 CDE',
      'PR11 VTE',
      createServices(
        createDvlaFixture('AB12CDE'),
        createDvlaFixture('PR11VTE', { colour: 'BLACK', taxDueDate: '2026-11-01' }),
        createMotFixture('AB12CDE'),
        createMotFixture('PR11VTE', {
          motExpiryDate: '2026-09-01',
          rawData: {
            registration: 'PR11VTE',
            make: 'FORD',
            model: 'TRANSIT CUSTOM',
            firstUsedDate: '2021-03-01',
            fuelType: 'Diesel',
            primaryColour: 'Black',
          },
        })
      )
    );

    expect(comparison.hasDifferences).toBe(true);
    expect(comparison.differences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'dvla.colour', oldValue: 'WHITE', newValue: 'BLACK' }),
        expect.objectContaining({ key: 'dvla.taxDueDate', oldValue: '2026-12-01', newValue: '2026-11-01' }),
        expect.objectContaining({ key: 'mot.model', oldValue: 'TRANSIT', newValue: 'TRANSIT CUSTOM' }),
        expect.objectContaining({ key: 'mot.motExpiryDate', oldValue: '2026-10-01', newValue: '2026-09-01' }),
      ])
    );
  });
});
