'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { InventoryLocation } from '../types';
import {
  formatInventoryLocationOptionLabel,
  getInventoryLocationsWithYardFirst,
} from '../utils';

interface InventoryLocationSelectExtraOption {
  value: string;
  label: string;
  className?: string;
}

interface InventoryLocationSelectProps {
  locations: InventoryLocation[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  triggerClassName?: string;
  disabled?: boolean;
  extraOptions?: InventoryLocationSelectExtraOption[];
}

interface InventoryLocationSelectOption {
  value: string;
  label: string;
  searchLabel: string;
  className?: string;
}

export function InventoryLocationSelect({
  locations,
  value,
  onValueChange,
  placeholder = 'Select location',
  searchPlaceholder = 'Search locations...',
  triggerClassName,
  disabled = false,
  extraOptions = [],
}: InventoryLocationSelectProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const options = useMemo<InventoryLocationSelectOption[]>(() => {
    const locationOptions = getInventoryLocationsWithYardFirst(locations).map((location) => {
      const label = formatInventoryLocationOptionLabel(location);

      return {
        value: location.id,
        label,
        searchLabel: [
          label,
          location.name,
          location.location_type,
          location.external_reference,
          location.linked_asset_label,
          location.linked_asset_nickname,
          ...(location.assigned_user_names || []),
        ].filter(Boolean).join(' '),
      };
    });

    return [
      ...locationOptions,
      ...extraOptions.map((option) => ({
        ...option,
        searchLabel: option.label,
      })),
    ];
  }, [extraOptions, locations]);

  const selectedOption = options.find((option) => option.value === value);
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredOptions = normalizedSearchQuery
    ? options.filter((option) => option.searchLabel.toLowerCase().includes(normalizedSearchQuery))
    : options;

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) setSearchQuery('');
  }

  function handleSelect(nextValue: string) {
    onValueChange(nextValue);
    handleOpenChange(false);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'w-full justify-between border-slate-600 bg-slate-800 text-left font-normal text-white hover:bg-slate-700',
            !selectedOption && 'text-muted-foreground',
            triggerClassName
          )}
        >
          <span className="min-w-0 flex-1 truncate">{selectedOption?.label || placeholder}</span>
          <ChevronDown className={cn('ml-2 h-4 w-4 shrink-0 opacity-70 transition-transform', open && 'rotate-180')} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] border-slate-700 bg-slate-950 p-0 text-slate-200"
      >
        <div className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950 p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={searchPlaceholder}
              className="h-9 border-slate-700 bg-slate-900 pl-9 text-white placeholder:text-slate-500"
            />
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                onClick={() => handleSelect(option.value)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-slate-800 focus:bg-slate-800 focus:outline-none',
                  option.className
                )}
              >
                <Check className={cn('h-4 w-4 shrink-0', option.value === value ? 'opacity-100' : 'opacity-0')} />
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
              </button>
            ))
          ) : (
            <div className="px-3 py-6 text-center text-sm text-slate-400">No locations found</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
