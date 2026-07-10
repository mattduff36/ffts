'use client';

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import {
  formatNumericTimeDraft,
  formatTimeForNumericInput,
  getNumericTimeInputDigits,
  normalizeAndRoundNumericTimeInput,
  normalizeNumericTimeInput,
  shouldCommitNumericTimeInput,
} from '@/lib/utils/numeric-time-input';

interface MobileNumericTimeInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel: string;
}

export function MobileNumericTimeInput({
  value,
  onChange,
  disabled,
  className,
  ariaLabel,
}: MobileNumericTimeInputProps) {
  const [draftValue, setDraftValue] = useState(() => formatTimeForNumericInput(value));

  useEffect(() => {
    setDraftValue(formatTimeForNumericInput(value));
  }, [value]);

  function handleChange(nextValue: string) {
    const digits = getNumericTimeInputDigits(nextValue);
    setDraftValue(formatNumericTimeDraft(digits));

    if (!digits) {
      onChange('');
      return;
    }

    if (shouldCommitNumericTimeInput(digits)) {
      const normalized = normalizeNumericTimeInput(digits);
      if (normalized !== null) onChange(normalized);
    }
  }

  function handleBlur() {
    const normalized = normalizeAndRoundNumericTimeInput(draftValue);
    if (normalized === null) {
      setDraftValue(formatTimeForNumericInput(value));
      return;
    }

    onChange(normalized);
    setDraftValue(formatTimeForNumericInput(normalized));
  }

  return (
    <Input
      type="text"
      inputMode="numeric"
      pattern="[0-9:]*"
      maxLength={5}
      enterKeyHint="next"
      value={draftValue}
      onChange={(event) => handleChange(event.target.value)}
      onBlur={handleBlur}
      onFocus={() => setDraftValue(formatTimeForNumericInput(value))}
      disabled={disabled}
      aria-label={ariaLabel}
      placeholder="08:00"
      className={className}
    />
  );
}
