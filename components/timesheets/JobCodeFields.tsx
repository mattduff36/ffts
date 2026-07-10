'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils/cn';
import {
  JOB_NUMBER_MAX_LENGTH,
  normalizeJobNumberInput,
} from '@/lib/utils/timesheet-job-codes';
import type { TimesheetJobCodeOption } from '@/lib/client/timesheet-job-codes';
import { Check, Plus, Search, Trash2, X } from 'lucide-react';

interface JobCodeFieldsProps {
  values: string[];
  onChange: (index: number, value: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
  placeholder?: string;
  inputClassName?: string;
  extraInputClassName?: string;
  containerClassName?: string;
  rowsClassName?: string;
  jobCodeOptions?: TimesheetJobCodeOption[];
  jobCodeOptionsLoading?: boolean;
}

interface JobCodePickerProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  inputClassName?: string;
  jobCodeOptions?: TimesheetJobCodeOption[];
  jobCodeOptionsLoading?: boolean;
  ariaLabel?: string;
  onSearchChange?: (query: string) => void;
  serverSideFiltering?: boolean;
}

interface JobCodeFieldRowProps {
  index: number;
  value: string;
  onChange: (index: number, value: string) => void;
  disabled: boolean;
  placeholder?: string;
  inputClassName?: string;
  jobCodeOptions: TimesheetJobCodeOption[];
  jobCodeOptionsLoading: boolean;
  trailingControl?: ReactNode;
  autoOpen?: boolean;
  onAutoOpenComplete?: () => void;
  onEmptyPickerClose?: (index: number) => void;
  hideTrigger?: boolean;
  ariaLabel?: string;
  onSearchChange?: (query: string) => void;
  serverSideFiltering?: boolean;
}

const JOB_CODE_FILTER_MIN_LENGTH = 3;
const PICKER_VIEWPORT_MARGIN_PX = 8;
const PICKER_MIN_VISIBLE_HEIGHT_PX = 280;
const PICKER_SAFE_AREA_TOP_CSS = 'env(safe-area-inset-top, 0px)';
const PICKER_SAFE_AREA_BOTTOM_CSS = 'env(safe-area-inset-bottom, 0px)';

function getOptionDescription(option: TimesheetJobCodeOption): string {
  const description = [option.customerName, option.quoteTitle]
    .filter(Boolean)
    .join(' - ');

  if (description) return description;
  if (option.source === 'timesheet') return 'Stored timesheet code';
  if (option.source === 'project_number') return 'Project number';
  return option.source === 'legacy_quote' ? 'Legacy quote' : 'Live quote';
}

function getFilterLength(value: string): number {
  return value.trim().replace(/\s+/g, '').length;
}

function optionMatchesFilter(option: TimesheetJobCodeOption, filterValue: string): boolean {
  const query = filterValue.trim().toLowerCase();
  const normalizedJobCodeQuery = normalizeJobNumberInput(filterValue).toLowerCase();
  const searchableText = [
    option.value,
    option.label,
    option.customerName,
    option.quoteTitle,
  ].filter(Boolean).join(' ').toLowerCase();

  return searchableText.includes(query)
    || Boolean(normalizedJobCodeQuery && option.value.toLowerCase().includes(normalizedJobCodeQuery));
}

function getPickerTopCss(viewportTop: number): string {
  const visualViewportTop = Math.max(
    PICKER_VIEWPORT_MARGIN_PX,
    viewportTop + PICKER_VIEWPORT_MARGIN_PX
  );

  return `max(${visualViewportTop}px, calc(${PICKER_SAFE_AREA_TOP_CSS} + ${PICKER_VIEWPORT_MARGIN_PX}px))`;
}

function getPickerMaxHeightCss(viewportTop: number, viewportHeight: number, topCss: string): string {
  const visualViewportBottom = viewportTop + viewportHeight;

  return `max(${PICKER_MIN_VISIBLE_HEIGHT_PX}px, calc(${visualViewportBottom}px - ${topCss} - ${PICKER_VIEWPORT_MARGIN_PX}px - ${PICKER_SAFE_AREA_BOTTOM_CSS}))`;
}

function getKeyboardAwarePickerStyle(): CSSProperties {
  if (typeof window === 'undefined') return {};

  const visualViewport = window.visualViewport;
  const viewportTop = visualViewport?.offsetTop ?? 0;
  const viewportHeight = visualViewport?.height ?? window.innerHeight;
  const top = getPickerTopCss(viewportTop);
  const maxHeight = getPickerMaxHeightCss(viewportTop, viewportHeight, top);

  return {
    top,
    maxHeight,
  };
}

function JobCodeFieldRow({
  index,
  value,
  onChange,
  disabled,
  placeholder,
  inputClassName,
  jobCodeOptions,
  jobCodeOptionsLoading,
  trailingControl,
  autoOpen,
  onAutoOpenComplete,
  onEmptyPickerClose,
  hideTrigger,
  ariaLabel,
  onSearchChange,
  serverSideFiltering,
}: JobCodeFieldRowProps) {
  const shouldAutoOpen = Boolean(autoOpen && !disabled);
  const [isPickerOpen, setIsPickerOpen] = useState(shouldAutoOpen);
  const [filterValue, setFilterValue] = useState('');
  const [pickerViewportStyle, setPickerViewportStyle] = useState<CSSProperties>(() =>
    shouldAutoOpen ? getKeyboardAwarePickerStyle() : {}
  );
  const didSelectDuringOpenRef = useRef(false);
  const normalizedValue = normalizeJobNumberInput(value || '');
  const buttonLabel = normalizedValue || 'Select';
  const isFilterReady = getFilterLength(filterValue) >= JOB_CODE_FILTER_MIN_LENGTH;
  const filteredOptions = useMemo(
    () => isFilterReady
      ? serverSideFiltering
        ? jobCodeOptions
        : jobCodeOptions.filter((option) => optionMatchesFilter(option, filterValue))
      : [],
    [filterValue, isFilterReady, jobCodeOptions, serverSideFiltering]
  );

  function handlePickerOpenChange(open: boolean) {
    if (open) {
      didSelectDuringOpenRef.current = false;
      setPickerViewportStyle(getKeyboardAwarePickerStyle());
    }

    setIsPickerOpen(open);
    if (!open) {
      setFilterValue('');
      setPickerViewportStyle({});
      if (!didSelectDuringOpenRef.current && !normalizedValue) {
        onEmptyPickerClose?.(index);
      }
      didSelectDuringOpenRef.current = false;
    }
  }

  function openPicker() {
    setPickerViewportStyle(getKeyboardAwarePickerStyle());
    setIsPickerOpen(true);
  }

  useEffect(() => {
    if (!isPickerOpen || typeof window === 'undefined') return;

    let animationFrame = 0;
    const visualViewport = window.visualViewport;
    const syncPickerViewport = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        setPickerViewportStyle(getKeyboardAwarePickerStyle());
      });
    };

    syncPickerViewport();
    visualViewport?.addEventListener('resize', syncPickerViewport);
    visualViewport?.addEventListener('scroll', syncPickerViewport);
    window.addEventListener('resize', syncPickerViewport);
    window.addEventListener('orientationchange', syncPickerViewport);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      visualViewport?.removeEventListener('resize', syncPickerViewport);
      visualViewport?.removeEventListener('scroll', syncPickerViewport);
      window.removeEventListener('resize', syncPickerViewport);
      window.removeEventListener('orientationchange', syncPickerViewport);
    };
  }, [isPickerOpen]);

  useEffect(() => {
    if (!autoOpen || disabled) return;
    onAutoOpenComplete?.();
  }, [autoOpen, disabled, onAutoOpenComplete]);

  useEffect(() => {
    onSearchChange?.(filterValue);
  }, [filterValue, onSearchChange]);

  const pickerDialog = (
    <Dialog open={isPickerOpen} onOpenChange={handlePickerOpenChange}>
      <DialogContent
        hideCloseButton
        className="left-2 right-2 top-[calc(env(safe-area-inset-top,0px)+0.5rem)] flex max-h-[calc(100dvh-1rem)] w-auto max-w-none translate-x-0 translate-y-0 flex-col gap-3 overflow-hidden rounded-xl border border-slate-700 bg-slate-950 p-4 text-white sm:left-1/2 sm:right-auto sm:top-4 sm:w-[calc(100vw-2rem)] sm:max-w-xl sm:-translate-x-1/2"
        style={pickerViewportStyle}
      >
        <DialogTitle className="sr-only">Choose job code</DialogTitle>
        <div className="shrink-0 space-y-3 pt-2">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={filterValue}
                onChange={(event) => setFilterValue(event.target.value)}
                placeholder="Search code, customer, or name"
                autoFocus
                className="min-h-12 rounded-lg border-slate-700 bg-slate-900 py-3 pl-11 pr-4 text-base text-white placeholder:text-slate-400"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => handlePickerOpenChange(false)}
              aria-label="Close job code search"
              className="h-12 w-12 shrink-0 rounded-lg border border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
          <p className="px-1 text-xs text-slate-400">
            Type at least 3 characters to show matching job codes.
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {jobCodeOptionsLoading ? (
            <p className="px-2 py-3 text-center text-sm text-slate-300">Loading job codes...</p>
          ) : !isFilterReady ? (
            <p className="rounded-lg border border-dashed border-slate-700 px-4 py-6 text-center text-sm text-slate-300">
              Start typing a job code, customer, or quote name to filter the list.
            </p>
          ) : filteredOptions.length > 0 ? (
            filteredOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className="flex min-h-16 w-full items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-left text-white hover:bg-slate-800"
                onClick={() => {
                  didSelectDuringOpenRef.current = true;
                  onChange(index, option.value);
                  handlePickerOpenChange(false);
                }}
              >
                <span className="min-w-0">
                  <span className="block truncate font-mono text-lg font-semibold">{option.label}</span>
                  <span className="block truncate text-sm text-slate-400">{getOptionDescription(option)}</span>
                </span>
                {normalizedValue === option.value && <Check className="h-5 w-5 shrink-0" />}
              </button>
            ))
          ) : (
            <p className="rounded-lg border border-dashed border-slate-700 px-4 py-6 text-center text-sm text-slate-300">
              No matching job codes found.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );

  if (hideTrigger) return pickerDialog;

  if (disabled) {
    return (
      <div className="relative min-w-0 flex-1">
        <Input
          value={value || ''}
          onChange={(event) => onChange(index, event.target.value)}
          placeholder={placeholder}
          maxLength={JOB_NUMBER_MAX_LENGTH}
          disabled={disabled}
          className={cn(trailingControl && !disabled ? 'pr-11' : '', inputClassName)}
        />
        {trailingControl}
      </div>
    );
  }

  return (
    <div className="relative min-w-0 flex-1">
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel || (normalizedValue ? `Selected job code ${normalizedValue}` : 'Select job code')}
        onClick={openPicker}
        className={cn(
          'flex h-9 w-full items-center justify-center rounded-md border border-input bg-transparent px-3 py-2 text-center text-sm shadow-sm ring-offset-background transition-colors focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          trailingControl ? 'pr-11' : '',
          normalizedValue ? 'text-foreground' : 'text-muted-foreground',
          inputClassName
        )}
      >
        <span className="min-w-0 flex-1 truncate">{buttonLabel}</span>
      </button>

      {pickerDialog}
      {trailingControl}
    </div>
  );
}

export function JobCodePicker({
  value,
  onChange,
  disabled = false,
  placeholder,
  inputClassName,
  jobCodeOptions = [],
  jobCodeOptionsLoading = false,
  ariaLabel,
  onSearchChange,
  serverSideFiltering = false,
}: JobCodePickerProps) {
  return (
    <JobCodeFieldRow
      index={0}
      value={value}
      onChange={(_, nextValue) => onChange(nextValue)}
      placeholder={placeholder}
      disabled={disabled}
      inputClassName={inputClassName}
      jobCodeOptions={jobCodeOptions}
      jobCodeOptionsLoading={jobCodeOptionsLoading}
      ariaLabel={ariaLabel}
      onSearchChange={onSearchChange}
      serverSideFiltering={serverSideFiltering}
    />
  );
}

export function JobCodeFields({
  values,
  onChange,
  onRemove,
  disabled = false,
  placeholder,
  inputClassName,
  extraInputClassName,
  containerClassName,
  rowsClassName,
  jobCodeOptions = [],
  jobCodeOptionsLoading = false,
}: JobCodeFieldsProps) {
  const displayValues = values.length > 0 ? values : [''];
  const hasPrimaryJobCode = normalizeJobNumberInput(displayValues[0] || '').length > 0;
  const [pendingAddIndex, setPendingAddIndex] = useState<number | null>(null);

  function handleAddJobCode() {
    setPendingAddIndex(displayValues.length);
  }

  function handlePendingJobCodeChange(index: number, value: string) {
    onChange(index, value);
    setPendingAddIndex(null);
  }

  function renderRowControls(index: number, value: string) {
    if (disabled) return null;

    const hasJobCode = normalizeJobNumberInput(value || '').length > 0;
    if (!hasJobCode) return null;

    const isLastRow = index === displayValues.length - 1;

    return (
      <>
        <button
          type="button"
          onClick={() => onRemove(index)}
          className="flex h-16 w-12 shrink-0 items-center justify-center rounded-lg border-2 border-slate-700 bg-slate-800/30 text-muted-foreground transition-all hover:border-red-500 hover:bg-red-500/10 hover:text-red-400 md:h-10 md:w-10 disabled:cursor-not-allowed disabled:opacity-30"
          aria-label={`Remove job code ${index + 1}`}
        >
          <Trash2 className="h-5 w-5" />
        </button>
        {isLastRow && (
          <button
            type="button"
            onClick={handleAddJobCode}
            className="flex h-16 w-12 shrink-0 items-center justify-center rounded-lg border-2 border-slate-700 bg-slate-800/30 text-muted-foreground transition-all hover:bg-slate-800/50 hover:text-foreground md:h-10 md:w-10 disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="Add another job code"
          >
            <Plus className="h-5 w-5" />
          </button>
        )}
      </>
    );
  }

  return (
    <div className={cn('space-y-2', containerClassName)}>
      <div className="flex items-end gap-3">
        <JobCodeFieldRow
          index={0}
          value={displayValues[0] || ''}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          inputClassName={inputClassName}
          jobCodeOptions={jobCodeOptions}
          jobCodeOptionsLoading={jobCodeOptionsLoading}
        />
        {hasPrimaryJobCode && renderRowControls(0, displayValues[0] || '')}
      </div>

      {displayValues.slice(1).map((value, index) => {
        const actualIndex = index + 1;
        return (
          <div key={actualIndex} className={cn('flex items-end gap-3', rowsClassName)}>
            <JobCodeFieldRow
              index={actualIndex}
              value={value}
              onChange={onChange}
              placeholder={placeholder}
              disabled={disabled}
              inputClassName={cn('flex-1', extraInputClassName || inputClassName)}
              jobCodeOptions={jobCodeOptions}
              jobCodeOptionsLoading={jobCodeOptionsLoading}
              autoOpen={false}
              onEmptyPickerClose={onRemove}
            />
            {renderRowControls(actualIndex, value)}
          </div>
        );
      })}
      {pendingAddIndex !== null && !disabled && (
        <JobCodeFieldRow
          index={pendingAddIndex}
          value=""
          onChange={handlePendingJobCodeChange}
          placeholder={placeholder}
          disabled={false}
          inputClassName={extraInputClassName || inputClassName}
          jobCodeOptions={jobCodeOptions}
          jobCodeOptionsLoading={jobCodeOptionsLoading}
          autoOpen
          hideTrigger
          onEmptyPickerClose={() => setPendingAddIndex(null)}
        />
      )}
    </div>
  );
}
