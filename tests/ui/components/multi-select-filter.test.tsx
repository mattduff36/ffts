/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MultiSelectFilter } from '@/components/ui/multi-select-filter';

describe('MultiSelectFilter', () => {
  it('gates only Legacy Sites options until the search query has three characters', () => {
    render(
      <MultiSelectFilter
        label="Location"
        allLabel="All locations"
        selectedValues={[]}
        options={[
          {
            value: 'manual-location',
            label: 'TEST LOCATION',
            description: 'Matt Duffill',
            searchLabel: 'TEST LOCATION Matt Duffill',
          },
          {
            value: 'van-location',
            label: '[FE24 TYH - Jeff Mark]',
            description: 'Unassigned',
            groupLabel: 'Vans',
            searchLabel: 'FE24 TYH Jeff Mark Vans',
          },
          {
            value: 'site-location',
            label: '[12345 - Active Site]',
            description: 'Unassigned',
            groupLabel: 'Sites',
            searchLabel: '12345 Active Site Sites',
          },
          {
            value: 'legacy-site-location',
            label: '[4321-AB - Legacy Site]',
            description: 'Unassigned',
            groupLabel: 'Legacy Sites',
            searchLabel: '4321-AB Legacy Site Legacy Sites',
          },
        ]}
        onSelectedValuesChange={vi.fn()}
        searchable
        searchPlaceholder="Search locations..."
        allOptionPosition="bottom"
        showPanelLabel={false}
        collapsibleGroupLabels={['Vans', 'Sites', 'Legacy Sites']}
        minimumSearchCharactersByGroupLabel={{ 'Legacy Sites': 3 }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /all locations/i }));

    expect(screen.getByText('TEST LOCATION')).toBeInTheDocument();
    expect(screen.getByText('Vans')).toBeInTheDocument();
    expect(screen.getByText('Sites')).toBeInTheDocument();
    expect(screen.getByText('Legacy Sites')).toBeInTheDocument();
    expect(screen.getByText('Type at least 3 characters to search')).toBeInTheDocument();
    expect(screen.queryByText('[4321-AB - Legacy Site]')).not.toBeInTheDocument();
    expect(screen.queryByText('No locations found')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /vans click to expand/i }));

    expect(screen.getByText('[FE24 TYH - Jeff Mark]')).toBeInTheDocument();
    expect(screen.queryByText('[4321-AB - Legacy Site]')).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search locations...'), {
      target: { value: '43' },
    });

    expect(screen.getByText('Type at least 3 characters to search')).toBeInTheDocument();
    expect(screen.queryByText('[4321-AB - Legacy Site]')).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search locations...'), {
      target: { value: '432' },
    });

    expect(screen.getByText('[4321-AB - Legacy Site]')).toBeInTheDocument();
    expect(screen.queryByText('Type at least 3 characters to search')).not.toBeInTheDocument();
  });
});
