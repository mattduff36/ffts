import { describe, expect, it } from 'vitest';
import {
  buildProfileNameIndex,
  matchTrainingPersonToProfile,
  normalizeTrainingPersonName,
  parseTrainingDate,
} from '@/lib/utils/training-import';

describe('training import helpers', () => {
  it('normalizes person names for exact profile matching', () => {
    expect(normalizeTrainingPersonName('  Frank   Barlow ')).toBe('FRANK BARLOW');
  });

  it('parses ISO and UK date formats while preserving raw text', () => {
    expect(parseTrainingDate('2027-04-30')).toEqual({ date: '2027-04-30', raw: '2027-04-30' });
    expect(parseTrainingDate('30.11.2030')).toEqual({ date: '2030-11-30', raw: '30.11.2030' });
    expect(parseTrainingDate('01/08/2028')).toEqual({ date: '2028-08-01', raw: '01/08/2028' });
    expect(parseTrainingDate('NO EXPIRY')).toEqual({ date: null, raw: 'NO EXPIRY' });
  });

  it('rejects impossible or incomplete dates but keeps the raw value', () => {
    expect(parseTrainingDate('18/02/163')).toEqual({ date: null, raw: '18/02/163' });
    expect(parseTrainingDate('31/02/2028')).toEqual({ date: null, raw: '31/02/2028' });
  });

  it('matches exact profile names and reports ambiguous matches', () => {
    const index = buildProfileNameIndex([
      { id: 'profile-1', full_name: 'Frank Barlow' },
      { id: 'profile-2', full_name: 'Jane Barlow' },
      { id: 'profile-3', full_name: 'Jane  Barlow' },
    ]);

    expect(matchTrainingPersonToProfile('FRANK BARLOW', index)).toMatchObject({
      profileId: 'profile-1',
      status: 'matched',
    });
    expect(matchTrainingPersonToProfile('Jane Barlow', index)).toMatchObject({
      profileId: null,
      status: 'ambiguous',
    });
    expect(matchTrainingPersonToProfile('Unknown Person', index)).toMatchObject({
      profileId: null,
      status: 'unmatched',
    });
  });
});
