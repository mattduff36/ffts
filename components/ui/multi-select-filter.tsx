'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface MultiSelectFilterOption<TValue extends string> {
  value: TValue;
  label: string;
  description?: string;
  groupLabel?: string;
  searchLabel?: string;
  count?: number;
}

interface MultiSelectFilterProps<TValue extends string> {
  label: string;
  allLabel: string;
  selectedValues: TValue[];
  options: readonly MultiSelectFilterOption<TValue>[];
  onSelectedValuesChange: (values: TValue[]) => void;
  triggerClassName?: string;
  panelClassName?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyLabel?: string;
  allOptionPosition?: 'top' | 'bottom';
  showPanelLabel?: boolean;
  collapsibleGroupLabels?: readonly string[];
  minimumSearchCharactersByGroupLabel?: Readonly<Record<string, number>>;
}

type MultiSelectFilterRenderEntry<TValue extends string> =
  | {
    type: 'option';
    option: MultiSelectFilterOption<TValue>;
    shouldShowGroup: boolean;
  }
  | {
    type: 'search-gated-group';
    groupLabel: string;
    minimumSearchCharacters: number;
  };

function getMultiSelectTriggerLabel<TValue extends string>({
  allLabel,
  selectedValues,
  options,
}: {
  allLabel: string;
  selectedValues: TValue[];
  options: readonly MultiSelectFilterOption<TValue>[];
}) {
  if (selectedValues.length === 0) return allLabel;
  if (selectedValues.length === 1) {
    return options.find((option) => option.value === selectedValues[0])?.label || allLabel;
  }
  return `${selectedValues.length} selected`;
}

export function MultiSelectFilter<TValue extends string>({
  label,
  allLabel,
  selectedValues,
  options,
  onSelectedValuesChange,
  triggerClassName,
  panelClassName,
  searchable = false,
  searchPlaceholder = 'Search...',
  emptyLabel = 'No options found',
  allOptionPosition = 'top',
  showPanelLabel = true,
  collapsibleGroupLabels = [],
  minimumSearchCharactersByGroupLabel = {},
}: MultiSelectFilterProps<TValue>) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set(collapsibleGroupLabels));
  const containerRef = useRef<HTMLDivElement>(null);
  const panelId = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-filter-menu`;
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredOptions = searchable && normalizedSearchQuery
    ? options.filter((option) => (option.searchLabel || `${option.label} ${option.description || ''} ${option.groupLabel || ''}`).toLowerCase().includes(normalizedSearchQuery))
    : options;
  const collapsibleGroupSet = useMemo(() => new Set(collapsibleGroupLabels), [collapsibleGroupLabels]);
  const renderEntries = useMemo<MultiSelectFilterRenderEntry<TValue>[]>(() => {
    const entries: MultiSelectFilterRenderEntry<TValue>[] = [];
    const hiddenSearchGatedGroups = new Set<string>();
    let previousVisibleGroupLabel: string | undefined;

    filteredOptions.forEach((option) => {
      const minimumSearchCharacters = option.groupLabel
        ? minimumSearchCharactersByGroupLabel[option.groupLabel]
        : undefined;
      const isSearchGated = typeof minimumSearchCharacters === 'number' && minimumSearchCharacters > 0;

      if (option.groupLabel && isSearchGated && normalizedSearchQuery.length < minimumSearchCharacters) {
        if (!hiddenSearchGatedGroups.has(option.groupLabel)) {
          entries.push({
            type: 'search-gated-group',
            groupLabel: option.groupLabel,
            minimumSearchCharacters,
          });
          hiddenSearchGatedGroups.add(option.groupLabel);
          previousVisibleGroupLabel = option.groupLabel;
        }
        return;
      }

      const shouldShowGroup = Boolean(option.groupLabel && option.groupLabel !== previousVisibleGroupLabel);
      entries.push({ type: 'option', option, shouldShowGroup });
      previousVisibleGroupLabel = option.groupLabel;
    });

    return entries;
  }, [filteredOptions, minimumSearchCharactersByGroupLabel, normalizedSearchQuery.length]);

  function closeMenu() {
    setOpen(false);
    setSearchQuery('');
  }

  function toggleMenu() {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (!nextOpen) setSearchQuery('');
  }

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!containerRef.current?.contains(target)) closeMenu();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeMenu();
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  function toggleValue(value: TValue) {
    if (selectedValues.includes(value)) {
      onSelectedValuesChange(selectedValues.filter((selectedValue) => selectedValue !== value));
      return;
    }

    onSelectedValuesChange([...selectedValues, value]);
  }

  function toggleGroup(groupLabel: string) {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupLabel)) next.delete(groupLabel);
      else next.add(groupLabel);
      return next;
    });
  }

  const allOption = (
    <label className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-left hover:bg-slate-800">
      <input
        type="checkbox"
        checked={selectedValues.length === 0}
        onChange={() => onSelectedValuesChange([])}
        className="h-4 w-4 accent-brand-yellow"
      />
      <span className="min-w-0 flex-1 truncate">{allLabel}</span>
    </label>
  );

  return (
    <div ref={containerRef} className={cn('relative w-full sm:w-[150px]', triggerClassName)}>
      <Button
        type="button"
        variant="outline"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggleMenu}
        className="w-full justify-between border-slate-600 bg-slate-800 text-white hover:bg-slate-700"
      >
        <span className="truncate">
          {getMultiSelectTriggerLabel({ allLabel, selectedValues, options })}
        </span>
        <ChevronDown className={cn('ml-2 h-4 w-4 shrink-0 opacity-70 transition-transform', open && 'rotate-180')} />
      </Button>

      {open ? (
        <div
          id={panelId}
          className={cn(
            'absolute left-0 top-full z-40 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-slate-700 bg-slate-950 p-1 text-sm text-slate-200 shadow-xl',
            panelClassName
          )}
        >
          {searchable ? (
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
          ) : null}
          {showPanelLabel ? (
            <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
          ) : null}
          {allOptionPosition === 'top' ? allOption : null}
          {renderEntries.map((entry) => {
            if (entry.type === 'search-gated-group') {
              return (
                <button
                  key={`search-gated-${entry.groupLabel}`}
                  type="button"
                  disabled
                  className="mt-1 flex w-full cursor-default items-start gap-2 rounded-sm px-3 py-2 text-left opacity-80"
                >
                  <ChevronRight className="mt-0.5 h-4 w-4 text-slate-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-bold uppercase leading-5 tracking-[0.18em] text-slate-400">
                      {entry.groupLabel}
                    </span>
                    <span className="block truncate text-xs leading-4 text-slate-500">
                      Type at least {entry.minimumSearchCharacters} characters to search
                    </span>
                  </span>
                </button>
              );
            }

            const { option, shouldShowGroup } = entry;
            const isCollapsibleGroup = Boolean(option.groupLabel && collapsibleGroupSet.has(option.groupLabel));
            const isGroupCollapsed = Boolean(
              !normalizedSearchQuery &&
              option.groupLabel &&
              collapsedGroups.has(option.groupLabel)
            );

            return (
              <Fragment key={`option-${option.value}`}>
                {shouldShowGroup ? (
                  isCollapsibleGroup ? (
                    <button
                      type="button"
                      onClick={() => toggleGroup(option.groupLabel!)}
                      className="mt-1 flex w-full items-start gap-2 rounded-sm px-3 py-2 text-left hover:bg-slate-800/70"
                      aria-expanded={!collapsedGroups.has(option.groupLabel!)}
                    >
                      {collapsedGroups.has(option.groupLabel!) ? (
                        <ChevronRight className="mt-0.5 h-4 w-4 text-slate-300" />
                      ) : (
                        <ChevronDown className="mt-0.5 h-4 w-4 text-slate-300" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-bold uppercase leading-5 tracking-[0.18em] text-slate-200">
                          {option.groupLabel}
                        </span>
                        <span className="block truncate text-xs leading-4 text-slate-500">
                          {collapsedGroups.has(option.groupLabel!) ? 'Click to expand' : 'Click to collapse'}
                        </span>
                      </span>
                    </button>
                  ) : (
                    <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                      {option.groupLabel}
                    </div>
                  )
                ) : null}
                {!isGroupCollapsed ? (
                  <label className="flex w-full cursor-pointer items-start gap-2 rounded-sm px-3 py-2 text-left hover:bg-slate-800">
                    <input
                      type="checkbox"
                      checked={selectedValues.includes(option.value)}
                      onChange={() => toggleValue(option.value)}
                      className="mt-0.5 h-4 w-4 accent-brand-yellow"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate leading-5">{option.label}</span>
                      {option.description ? (
                        <span className="block truncate text-xs leading-4 text-slate-500">{option.description}</span>
                      ) : null}
                    </span>
                    {typeof option.count === 'number' && option.count > 0 ? (
                      <span className="mt-0.5 text-xs text-slate-400">({option.count})</span>
                    ) : null}
                  </label>
                ) : null}
              </Fragment>
            );
          })}
          {renderEntries.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-slate-400">{emptyLabel}</div>
          ) : null}
          {allOptionPosition === 'bottom' ? (
            <div className="mt-1 border-t border-slate-800 pt-1">{allOption}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
