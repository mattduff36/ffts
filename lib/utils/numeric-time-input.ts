import { roundTimeToNearestQuarterHour } from '@/lib/utils/time-calculations';

const TIME_VALUE_PATTERN = /^(\d{2}):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/;

export function formatTimeForNumericInput(value: string | null | undefined): string {
  const match = (value || '').match(TIME_VALUE_PATTERN);
  if (!match) return '';
  return `${match[1]}:${match[2]}`;
}

export function getNumericTimeInputDigits(value: string): string {
  return value.replace(/\D/gu, '').slice(0, 4);
}

export function formatNumericTimeDraft(value: string): string {
  const digits = getNumericTimeInputDigits(value);
  if (digits.length <= 2) return digits;
  if (digits.length === 3) {
    const possibleTwoDigitHour = Number(digits.slice(0, 2));
    if (possibleTwoDigitHour <= 23) return `${digits.slice(0, 2)}:${digits.slice(2)}`;
    return `${digits.slice(0, 1)}:${digits.slice(1)}`;
  }
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

export function normalizeNumericTimeInput(value: string): string | null {
  const digits = getNumericTimeInputDigits(value);
  if (!digits) return '';

  if (digits.length === 3 && Number(digits.slice(0, 2)) <= 23) {
    return null;
  }

  const hoursText = digits.length <= 2 ? digits : digits.slice(0, digits.length - 2);
  const minutesText = digits.length <= 2 ? '00' : digits.slice(-2);
  const hours = Number(hoursText);
  const minutes = Number(minutesText);

  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function shouldCommitNumericTimeInput(value: string): boolean {
  const digits = getNumericTimeInputDigits(value);
  if (digits.length < 3) return false;
  return normalizeNumericTimeInput(digits) !== null;
}

export function normalizeAndRoundNumericTimeInput(value: string): string | null {
  const normalized = normalizeNumericTimeInput(value);
  if (normalized === null || normalized === '') return normalized;
  return roundTimeToNearestQuarterHour(normalized);
}
