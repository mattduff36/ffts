export const MOBILE_TEXT_SIZE_STORAGE_KEY = 'mobile-text-size-step';
export const MOBILE_TEXT_SIZE_CHANGED_EVENT = 'mobile-text-size-changed';
export const MOBILE_TEXT_SIZE_DEFAULT_STEP = 2;
export const MOBILE_TEXT_SIZE_STEPS = [1, 2, 3, 4, 5] as const;

export type MobileTextSizeStep = (typeof MOBILE_TEXT_SIZE_STEPS)[number];

export const MOBILE_TEXT_SIZE_LABELS: Record<MobileTextSizeStep, string> = {
  1: 'Smallest',
  2: 'Small',
  3: 'Normal',
  4: 'Large',
  5: 'Largest',
};

export interface MobileTextSizeChangedDetail {
  step: MobileTextSizeStep;
}

export function normalizeMobileTextSizeStep(value: unknown): MobileTextSizeStep {
  const numericValue = typeof value === 'number' ? value : Number(value);

  if (MOBILE_TEXT_SIZE_STEPS.includes(numericValue as MobileTextSizeStep)) {
    return numericValue as MobileTextSizeStep;
  }

  return MOBILE_TEXT_SIZE_DEFAULT_STEP;
}

export function readMobileTextSizePreference(): MobileTextSizeStep {
  if (typeof window === 'undefined') return MOBILE_TEXT_SIZE_DEFAULT_STEP;

  try {
    return normalizeMobileTextSizeStep(localStorage.getItem(MOBILE_TEXT_SIZE_STORAGE_KEY));
  } catch {
    return MOBILE_TEXT_SIZE_DEFAULT_STEP;
  }
}

export function writeMobileTextSizePreference(step: MobileTextSizeStep): void {
  if (typeof window === 'undefined') return;

  const normalizedStep = normalizeMobileTextSizeStep(step);

  try {
    localStorage.setItem(MOBILE_TEXT_SIZE_STORAGE_KEY, String(normalizedStep));
    window.dispatchEvent(
      new CustomEvent<MobileTextSizeChangedDetail>(MOBILE_TEXT_SIZE_CHANGED_EVENT, {
        detail: { step: normalizedStep },
      })
    );
  } catch {
    // Ignore localStorage access failures.
  }
}

export function applyMobileTextSizePreference(
  step: MobileTextSizeStep,
  target: HTMLElement = document.documentElement
): void {
  target.dataset.mobileTextSize = String(normalizeMobileTextSizeStep(step));
}
